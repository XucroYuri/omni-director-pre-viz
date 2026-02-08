import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPool } from './db';

const SCHEMA_LOCK_KEY_1 = 1869440617;
const SCHEMA_LOCK_KEY_2 = 1882272000;

async function loadSchemaSql(): Promise<string> {
  const candidates = [path.join(process.cwd(), 'db', 'schema.sql'), path.join(process.cwd(), 'apps', 'web', 'db', 'schema.sql')];
  for (const filePath of candidates) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('Unable to locate apps/web/db/schema.sql');
}

let readyPromise: Promise<void> | null = null;
let cachedSchemaSql: string | null = null;

export async function ensurePhase91Schema(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const sql = cachedSchemaSql || (await loadSchemaSql());
      cachedSchemaSql = sql;
      const client = await getPool().connect();
      try {
        await client.query('SELECT pg_advisory_lock($1, $2)', [SCHEMA_LOCK_KEY_1, SCHEMA_LOCK_KEY_2]);
        try {
          await client.query(sql);
        } finally {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [SCHEMA_LOCK_KEY_1, SCHEMA_LOCK_KEY_2]);
        }
      } finally {
        client.release();
      }
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function getPhase91SchemaSql(): Promise<string> {
  if (!cachedSchemaSql) {
    cachedSchemaSql = await loadSchemaSql();
  }
  return cachedSchemaSql;
}
