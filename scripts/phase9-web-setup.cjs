'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = process.cwd();
const webDir = path.join(repoRoot, 'apps', 'web');
const envFile = path.join(webDir, '.env.local');
const envExample = path.join(webDir, '.env.local.example');

function run(cmd, args, stepName) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    if (stepName === 'db:init') {
      console.error('\nDB init failed. Ensure local infra is up: npm run phase9:infra:up');
    }
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(envFile)) {
  fs.copyFileSync(envExample, envFile);
  console.log('Created apps/web/.env.local from template');
}

run('npm', ['--prefix', 'apps/web', 'install'], 'install');
run('npm', ['--prefix', 'apps/web', 'run', 'db:init'], 'db:init');

console.log('Phase9 web setup complete');
