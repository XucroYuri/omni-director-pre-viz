import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

async function loadEnvLocal(baseDir) {
  const envPath = path.join(baseDir, '.env.local');
  try {
    const content = await fs.readFile(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // No local env file; keep defaults from process.env.
  }
}

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error('DATABASE_URL is required');
  }
  return value;
}

async function main() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const webDir = path.join(currentDir, '..');
  await loadEnvLocal(webDir);
  const schemaPath = path.join(currentDir, '..', 'db', 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');

  const pool = new Pool({
    connectionString: getDatabaseUrl(),
  });

  try {
    await pool.query(schemaSql);
    console.log('Phase 9.1 schema initialized successfully');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to initialize schema:', error);
  process.exitCode = 1;
});
