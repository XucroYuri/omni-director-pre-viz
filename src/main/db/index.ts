import * as path from 'node:path';
import { app } from 'electron';
import Database = require('better-sqlite3');

const SCHEMA_VERSION = '1.0.0';

let dbInstance: Database.Database | null = null;

function getDbPath() {
  return path.join(app.getPath('userData'), 'omni-director.db');
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  title TEXT,
  script TEXT,
  context TEXT,
  config_json TEXT NOT NULL,
  tags_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  original_text TEXT,
  visual_translation TEXT,
  context_tag TEXT,
  shot_kind TEXT,
  matrix_prompts_json TEXT,
  generated_image_path TEXT,
  split_images_json TEXT,
  video_urls_json TEXT,
  animatic_video_path TEXT,
  asset_video_path TEXT,
  status TEXT,
  video_status_json TEXT,
  progress REAL,
  history_json TEXT,
  optimization_json TEXT,
  character_ids_json TEXT,
  scene_ids_json TEXT,
  prop_ids_json TEXT,
  linked_shot_ids_json TEXT,
  last_accessed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  ref_image_path TEXT,
  tags_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  shot_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL,
  payload_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots(episode_id);
CREATE INDEX IF NOT EXISTS idx_assets_episode ON assets(episode_id);
CREATE INDEX IF NOT EXISTS idx_tasks_episode ON tasks(episode_id);
CREATE INDEX IF NOT EXISTS idx_tasks_shot ON tasks(shot_id);
`;

export function initDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);

  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);

  dbInstance = db;
  return dbInstance;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}
