#!/usr/bin/env node
/* eslint-disable no-console */
const { existsSync } = require('fs');
const { resolve } = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const gitDir = resolve(root, '.git');
const hooksDir = resolve(root, '.githooks');

if (!existsSync(gitDir)) {
  console.log('[setup:githooks] skip: .git not found');
  process.exit(0);
}

if (!existsSync(hooksDir)) {
  console.log('[setup:githooks] skip: .githooks not found');
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log('[setup:githooks] configured core.hooksPath=.githooks');
