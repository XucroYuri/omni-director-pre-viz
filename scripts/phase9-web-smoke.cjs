'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const managedChildren = new Set();
let cleanedUp = false;

function mergeEnv(extra) {
  return {
    ...process.env,
    ...(extra || {}),
  };
}

function parsePortFromBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!url.port) return null;
  const port = Number(url.port);
  if (!Number.isFinite(port) || port <= 0) return null;
  return port;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!port) {
          reject(new Error('Failed to acquire a free port'));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function resolveManagedBaseUrl() {
  const provided = (process.env.WEB_BASE_URL || '').trim();
  if (provided) return provided;
  const port = await getFreePort();
  return `http://127.0.0.1:${port}`;
}

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
      cwd: process.cwd(),
      stdio: options.stdio || 'inherit',
      env: options.env ? mergeEnv(options.env) : process.env,
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
    cwd: process.cwd(),
    env: options.env ? mergeEnv(options.env) : process.env,
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

async function waitForHealth(url, timeoutMs = 90000, options = {}) {
  const startedAt = Date.now();
  const abortChild = options.abortChild || null;
  let childExited = false;
  let childExitCode = null;
  let childExitSignal = null;
  if (abortChild) {
    abortChild.once('exit', (code, signal) => {
      childExited = true;
      childExitCode = code;
      childExitSignal = signal;
    });
  }
  while (Date.now() - startedAt < timeoutMs) {
    if (childExited) {
      throw new Error(`Web process exited before health was ready (code=${childExitCode}, signal=${childExitSignal || 'null'})`);
    }
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

async function main() {
  let webProc;
  let workerProc;
  try {
    await runCommand(['run', 'phase9:web:db:init']);

    const baseUrl = await resolveManagedBaseUrl();
    const port = parsePortFromBaseUrl(baseUrl);
    if (!port) {
      throw new Error(`Invalid WEB_BASE_URL (missing port): ${baseUrl}`);
    }
    const env = { WEB_BASE_URL: baseUrl };

    webProc = startManagedProcess('web', ['--prefix', 'apps/web', 'run', 'dev', '--', '--port', String(port)], { env });
    workerProc = startManagedProcess('worker', ['run', 'phase9:web:worker'], { env });

    await waitForHealth(`${baseUrl}/api/health`, 90000, { abortChild: webProc });
    await runCommand(['--prefix', 'apps/web', 'run', 'smoke:api'], { env });
  } finally {
    stopManagedProcess(webProc);
    stopManagedProcess(workerProc);
    cleanupChildren();
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
