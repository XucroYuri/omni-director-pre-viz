'use strict';

const { spawn } = require('node:child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const baseUrl = process.env.WEB_BASE_URL || 'http://127.0.0.1:3100';
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
      cwd: process.cwd(),
      stdio: options.stdio || 'inherit',
      env: process.env,
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

function startManagedProcess(name, args) {
  const child = spawn(npmCmd, args, {
    cwd: process.cwd(),
    env: process.env,
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

async function main() {
  let webProc;
  let workerProc;
  try {
    await runCommand(['run', 'phase9:web:db:init']);

    webProc = startManagedProcess('web', ['run', 'phase9:web:dev']);
    workerProc = startManagedProcess('worker', ['run', 'phase9:web:worker']);

    await waitForHealth(`${baseUrl}/api/health`);
    await runCommand(['--prefix', 'apps/web', 'run', 'smoke:api']);
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
