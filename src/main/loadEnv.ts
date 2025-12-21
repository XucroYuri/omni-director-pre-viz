import * as fs from 'node:fs';
import * as path from 'node:path';

function parseEnvFile(content: string) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadLocalEnvFiles() {
  const cwd = process.cwd();
  const candidates = ['.env.local', '.env'];
  for (const name of candidates) {
    const filePath = path.join(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      parseEnvFile(content);
    } catch {
      // ignore
    }
  }
}
