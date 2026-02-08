'use strict';

const fs = require('node:fs');
const path = require('node:path');

const Database = require('better-sqlite3');
const { Pool } = require('pg');

function readArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function loadEnvLocal() {
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), 'apps', 'web', '.env.local'),
  ];
  for (const envPath of candidates) {
    try {
      const text = fs.readFileSync(envPath, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (!(key in process.env)) process.env[key] = value;
      }
      return;
    } catch {
      // Try next candidate.
    }
  }
}

function requireEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function toIsoFromEpochMs(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return new Date().toISOString();
  return new Date(num).toISOString();
}

function safeJsonParse(text) {
  if (text === null || text === undefined) return null;
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

function normalizeAssetType(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (trimmed === 'character' || trimmed === 'scene' || trimmed === 'prop') return trimmed;
  return 'prop';
}

function normalizeTaskStatus(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (trimmed === 'queued' || trimmed === 'running' || trimmed === 'completed' || trimmed === 'failed' || trimmed === 'cancelled') {
    return trimmed;
  }
  if (trimmed === 'canceled') return 'cancelled';
  if (trimmed === 'done' || trimmed === 'success' || trimmed === 'succeeded') return 'completed';
  if (trimmed === 'error' || trimmed === 'failure') return 'failed';
  return 'failed';
}

function normalizeTaskType(value) {
  const trimmed = String(value || '').trim().toUpperCase();
  if (trimmed === 'LLM' || trimmed === 'IMAGE' || trimmed === 'VIDEO' || trimmed === 'EXPORT' || trimmed === 'SYSTEM') {
    return trimmed;
  }
  return 'SYSTEM';
}

async function ensureSchema(pool) {
  const schemaPath = path.join(process.cwd(), 'apps', 'web', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS legacy_episode_data (
        id TEXT PRIMARY KEY,
        legacy_json JSONB NOT NULL,
        migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS legacy_shot_data (
        id TEXT PRIMARY KEY,
        legacy_json JSONB NOT NULL,
        migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS legacy_asset_data (
        id TEXT PRIMARY KEY,
        legacy_json JSONB NOT NULL,
        migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS legacy_task_data (
        id TEXT PRIMARY KEY,
        legacy_json JSONB NOT NULL,
        migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  );
}

async function migrateEpisodes(db, pool, report) {
  const rows = db.prepare('SELECT * FROM episodes').all();
  report.sqlite.episodes = rows.length;
  let migrated = 0;
  await pool.query('BEGIN');
  try {
    for (const row of rows) {
      const id = String(row.id);
      const title = String(row.title || 'Untitled Episode');
      const createdAt = toIsoFromEpochMs(row.created_at);
      const updatedAt = toIsoFromEpochMs(row.updated_at);
      await pool.query(
        `
          INSERT INTO episodes (id, title, created_at, updated_at)
          VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
          ON CONFLICT (id)
          DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at
        `,
        [id, title, createdAt, updatedAt],
      );

      const legacy = {
        script: row.script ?? null,
        context: row.context ?? null,
        config_json: safeJsonParse(row.config_json),
        tags_json: safeJsonParse(row.tags_json),
      };
      await pool.query(
        `
          INSERT INTO legacy_episode_data (id, legacy_json)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (id)
          DO UPDATE SET legacy_json = EXCLUDED.legacy_json
        `,
        [id, JSON.stringify(legacy)],
      );
      migrated += 1;
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  report.postgres.episodes = migrated;
}

async function migrateShots(db, pool, report) {
  const rows = db.prepare('SELECT * FROM shots').all();
  report.sqlite.shots = rows.length;
  let migrated = 0;
  await pool.query('BEGIN');
  try {
    for (const row of rows) {
      const id = String(row.id);
      const episodeId = String(row.episode_id);
      const orderIndex = Number.isFinite(Number(row.order_index)) ? Math.max(0, Math.round(Number(row.order_index))) : 0;
      const originalText = String(row.original_text || '');
      const visualTranslation = String(row.visual_translation || '');
      const status = String(row.status || 'pending');
      const createdAt = toIsoFromEpochMs(row.created_at);
      const updatedAt = toIsoFromEpochMs(row.updated_at);

      await pool.query(
        `
          INSERT INTO shots (
            id, episode_id, order_index, original_text, visual_translation, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
          ON CONFLICT (id)
          DO UPDATE SET
            order_index = EXCLUDED.order_index,
            original_text = EXCLUDED.original_text,
            visual_translation = EXCLUDED.visual_translation,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        `,
        [id, episodeId, orderIndex, originalText, visualTranslation, status, createdAt, updatedAt],
      );

      await pool.query(
        `
          INSERT INTO legacy_shot_data (id, legacy_json)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (id)
          DO UPDATE SET legacy_json = EXCLUDED.legacy_json
        `,
        [id, JSON.stringify(row)],
      );
      migrated += 1;
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  report.postgres.shots = migrated;
}

async function migrateAssets(db, pool, report) {
  const rows = db.prepare('SELECT * FROM assets').all();
  report.sqlite.assets = rows.length;
  let migrated = 0;
  await pool.query('BEGIN');
  try {
    for (const row of rows) {
      const id = String(row.id);
      const episodeId = String(row.episode_id);
      const type = normalizeAssetType(row.type);
      const name = String(row.name || 'Untitled Asset');
      const description = String(row.description || '');
      const createdAt = toIsoFromEpochMs(row.created_at);
      const updatedAt = toIsoFromEpochMs(row.updated_at);

      await pool.query(
        `
          INSERT INTO assets (
            id, episode_id, type, name, description, media_key, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, NULL, $6::timestamptz, $7::timestamptz)
          ON CONFLICT (id)
          DO UPDATE SET
            type = EXCLUDED.type,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = EXCLUDED.updated_at
        `,
        [id, episodeId, type, name, description, createdAt, updatedAt],
      );

      const legacy = {
        ...row,
        normalized_type: type,
        ref_image_path: row.ref_image_path ?? null,
        tags_json: safeJsonParse(row.tags_json),
      };
      await pool.query(
        `
          INSERT INTO legacy_asset_data (id, legacy_json)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (id)
          DO UPDATE SET legacy_json = EXCLUDED.legacy_json
        `,
        [id, JSON.stringify(legacy)],
      );
      migrated += 1;
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  report.postgres.assets = migrated;
}

async function migrateTasks(db, pool, report) {
  const rows = db.prepare('SELECT * FROM tasks').all();
  report.sqlite.tasks = rows.length;
  let migrated = 0;
  await pool.query('BEGIN');
  try {
    for (const row of rows) {
      const id = String(row.id);
      const episodeId = String(row.episode_id);
      const shotId = row.shot_id ? String(row.shot_id) : null;
      const legacyKind = String(row.type || 'LEGACY');
      const type = normalizeTaskType(row.type);
      const jobKind = legacyKind.trim() ? legacyKind.trim() : 'LEGACY';
      const status = normalizeTaskStatus(row.status);
      const progress = Number.isFinite(Number(row.progress)) ? Math.max(0, Math.min(1, Number(row.progress))) : null;
      const payload = safeJsonParse(row.payload_json) || {};
      const result = safeJsonParse(row.result_json) || {};
      const legacyError = row.error ? String(row.error) : null;
      const errorCode = legacyError ? 'TASK_EXECUTION_FAILED' : null;
      const errorMessage = legacyError;
      const errorContext = legacyError
        ? {
            legacy: true,
            legacyStatus: row.status ?? null,
          }
        : null;
      const createdAt = toIsoFromEpochMs(row.created_at);
      const updatedAt = toIsoFromEpochMs(row.updated_at);

      await pool.query(
        `
          INSERT INTO tasks (
            id,
            episode_id,
            shot_id,
            type,
            job_kind,
            status,
            progress,
            attempt_count,
            max_attempts,
            next_attempt_at,
            last_attempt_at,
            lease_token,
            lease_expires_at,
            trace_id,
            idempotency_key,
            payload_json,
            result_json,
            error_code,
            error_message,
            error_context_json,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            0,
            3,
            NOW(),
            NULL,
            NULL,
            NULL,
            $8,
            NULL,
            $9::jsonb,
            $10::jsonb,
            $11,
            $12,
            $13::jsonb,
            $14::timestamptz,
            $15::timestamptz
          )
          ON CONFLICT (id)
          DO UPDATE SET
            status = EXCLUDED.status,
            progress = EXCLUDED.progress,
            payload_json = EXCLUDED.payload_json,
            result_json = EXCLUDED.result_json,
            error_code = EXCLUDED.error_code,
            error_message = EXCLUDED.error_message,
            error_context_json = EXCLUDED.error_context_json,
            updated_at = EXCLUDED.updated_at
        `,
        [
          id,
          episodeId,
          shotId,
          type,
          jobKind,
          status,
          progress,
          id,
          JSON.stringify(payload),
          JSON.stringify(result),
          errorCode,
          errorMessage,
          errorContext ? JSON.stringify(errorContext) : null,
          createdAt,
          updatedAt,
        ],
      );

      await pool.query(
        `
          INSERT INTO legacy_task_data (id, legacy_json)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (id)
          DO UPDATE SET legacy_json = EXCLUDED.legacy_json
        `,
        [id, JSON.stringify(row)],
      );
      migrated += 1;
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  report.postgres.tasks = migrated;
}

async function countPostgres(pool, table) {
  const rows = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
  return rows.rows[0]?.total || 0;
}

async function main() {
  loadEnvLocal();
  const sqlitePath =
    readArg('--db') ||
    (process.env.OMNI_SQLITE_DB_PATH ? String(process.env.OMNI_SQLITE_DB_PATH).trim() : '') ||
    null;
  if (!sqlitePath) {
    throw new Error('SQLite path required. Provide --db <path> or OMNI_SQLITE_DB_PATH.');
  }

  const resolvedSqlitePath = path.isAbsolute(sqlitePath) ? sqlitePath : path.join(process.cwd(), sqlitePath);
  if (!fs.existsSync(resolvedSqlitePath)) {
    throw new Error(`SQLite db not found: ${resolvedSqlitePath}`);
  }

  const databaseUrl = requireEnv('DATABASE_URL');
  const reportPath =
    readArg('--report') ||
    (process.env.OMNI_MIGRATION_REPORT_PATH ? String(process.env.OMNI_MIGRATION_REPORT_PATH).trim() : '') ||
    `migration-report-${Date.now()}.json`;
  const resolvedReportPath = path.isAbsolute(reportPath) ? reportPath : path.join(process.cwd(), reportPath);

  const report = {
    ts: new Date().toISOString(),
    sqlitePath: resolvedSqlitePath,
    reportPath: resolvedReportPath,
    sqlite: { episodes: 0, shots: 0, assets: 0, tasks: 0 },
    postgres: { episodes: 0, shots: 0, assets: 0, tasks: 0 },
    totalsAfter: {},
  };

  const sqlite = new Database(resolvedSqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await ensureSchema(pool);

    await migrateEpisodes(sqlite, pool, report);
    await migrateShots(sqlite, pool, report);
    await migrateAssets(sqlite, pool, report);
    await migrateTasks(sqlite, pool, report);

    report.totalsAfter = {
      episodes: await countPostgres(pool, 'episodes'),
      shots: await countPostgres(pool, 'shots'),
      assets: await countPostgres(pool, 'assets'),
      tasks: await countPostgres(pool, 'tasks'),
      legacy_episode_data: await countPostgres(pool, 'legacy_episode_data'),
      legacy_shot_data: await countPostgres(pool, 'legacy_shot_data'),
      legacy_asset_data: await countPostgres(pool, 'legacy_asset_data'),
      legacy_task_data: await countPostgres(pool, 'legacy_task_data'),
    };
  } finally {
    try {
      sqlite.close();
    } catch {
      // ignore
    }
    await pool.end();
  }

  fs.writeFileSync(resolvedReportPath, JSON.stringify(report, null, 2));
  console.log('Migration finished', report);
}

main().catch((error) => {
  console.error('Migration failed', error);
  process.exitCode = 1;
});
