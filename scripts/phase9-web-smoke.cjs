'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const DEFAULT_WEB_PORT = 3100;
const WEB_STACK_LOCK_PATH = path.join(process.cwd(), '.tmp', 'phase9-web-stack.lock');
const LOCK_POLL_MS = 1000;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const managedChildren = new Set();
let cleanedUp = false;

function pipeWithPrefix(stream, prefix, target) {
  if (!stream) return;
  stream.on('data', (chunk) => {
    const text = String(chunk);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      target.write(`[${prefix}] ${line}\n`);
    }
  });
}

function runCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCmd, args, {
      cwd: options.cwd || process.cwd(),
      stdio: options.stdio || 'inherit',
      env: options.env || process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${npmCmd} ${args.join(' ')} (exit ${code})`));
    });
  });
}

function startManagedProcess(name, args, options = {}) {
  const child = spawn(npmCmd, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  pipeWithPrefix(child.stdout, name, process.stdout);
  pipeWithPrefix(child.stderr, name, process.stderr);
  managedChildren.add(child);
  child.on('exit', () => {
    managedChildren.delete(child);
  });
  return child;
}

function parsePortFromBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid WEB_BASE_URL: ${baseUrl}`);
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid WEB_BASE_URL port: ${baseUrl}`);
  }
  return port;
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort = DEFAULT_WEB_PORT, endPort = DEFAULT_WEB_PORT + 200) {
  for (let port = startPort; port <= endPort; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await canListenOnPort(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${endPort}`);
}

async function resolveWebTarget() {
  const envBaseUrl = process.env.WEB_BASE_URL?.trim();
  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      webPort: parsePortFromBaseUrl(envBaseUrl),
    };
  }
  const webPort = await findAvailablePort();
  return {
    baseUrl: `http://127.0.0.1:${webPort}`,
    webPort,
  };
}

async function waitForHealth(url, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting health endpoint: ${url}`);
}

function stopManagedProcess(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
      return;
    }
    process.kill(-child.pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Ignore kill errors.
      }
    }, 5000).unref?.();
  } catch {
    // Ignore kill errors.
  }
}

function cleanupChildren() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const child of managedChildren) {
    stopManagedProcess(child);
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function releaseWebStackLock() {
  try {
    const raw = await fs.readFile(WEB_STACK_LOCK_PATH, 'utf8');
    const holder = JSON.parse(raw);
    if (holder?.pid !== process.pid) {
      return;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
  }
  try {
    await fs.unlink(WEB_STACK_LOCK_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function acquireWebStackLock(owner, timeoutMs = LOCK_TIMEOUT_MS) {
  await fs.mkdir(path.dirname(WEB_STACK_LOCK_PATH), { recursive: true });
  const startedAt = Date.now();
  let lastWaitLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await fs.open(WEB_STACK_LOCK_PATH, 'wx');
      try {
        await handle.writeFile(
          JSON.stringify({
            owner,
            pid: process.pid,
            acquiredAt: new Date().toISOString(),
          }),
          'utf8',
        );
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }

    let holderPid = null;
    let holderOwner = 'unknown';
    let hasHolderInfo = false;
    try {
      const raw = await fs.readFile(WEB_STACK_LOCK_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Number.isInteger(parsed?.pid) && parsed.pid > 0) {
        holderPid = parsed.pid;
        hasHolderInfo = true;
      }
      holderOwner = parsed?.owner || holderOwner;
    } catch {
      // Lock file may be in-flight or stale; retry after poll interval.
    }

    if (hasHolderInfo && !isProcessAlive(holderPid)) {
      await fs.unlink(WEB_STACK_LOCK_PATH).catch(() => {});
      continue;
    }

    if (Date.now() - lastWaitLogAt >= 5000) {
      const holderPidLabel = hasHolderInfo ? String(holderPid) : 'unknown';
      console.log(`[${owner}] waiting for lock held by pid=${holderPidLabel} owner=${holderOwner}`);
      lastWaitLogAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }

  throw new Error(`Timed out waiting for lock: ${WEB_STACK_LOCK_PATH}`);
}

async function main() {
  let webProc;
  let workerProc;
  let hasLock = false;
  try {
    await acquireWebStackLock('phase9:web:smoke');
    hasLock = true;

    const { baseUrl, webPort } = await resolveWebTarget();
    const childEnv = {
      ...process.env,
      WEB_BASE_URL: baseUrl,
      WEB_PORT: String(webPort),
    };
    console.log(`[phase9:web:smoke] WEB_BASE_URL=${baseUrl}`);

    await runCommand(['run', 'phase9:web:db:init'], { env: childEnv });

    webProc = startManagedProcess('web', ['exec', '--', 'next', 'dev', '--port', String(webPort)], {
      cwd: 'apps/web',
      env: childEnv,
    });
    workerProc = startManagedProcess('worker', ['--prefix', 'apps/web', 'run', 'worker'], { env: childEnv });

    await waitForHealth(`${baseUrl}/api/health`);
    await runCommand(['--prefix', 'apps/web', 'run', 'smoke:api'], { env: childEnv });
  } finally {
    stopManagedProcess(webProc);
    stopManagedProcess(workerProc);
    cleanupChildren();
    if (hasLock) {
      await releaseWebStackLock();
    }
  }
}

process.once('SIGINT', () => {
  cleanupChildren();
  process.exit(130);
});

process.once('SIGTERM', () => {
  cleanupChildren();
  process.exit(143);
});

process.once('exit', () => {
  cleanupChildren();
});

main().catch((error) => {
  console.error('Web smoke failed', error);
  process.exitCode = 1;
});
