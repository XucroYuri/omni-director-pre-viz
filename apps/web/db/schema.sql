CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  original_text TEXT NOT NULL DEFAULT '',
  visual_translation TEXT NOT NULL DEFAULT '',
  matrix_prompts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  matrix_image_key TEXT,
  split_image_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('character', 'scene', 'prop')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  media_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  shot_id TEXT REFERENCES shots(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress REAL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  trace_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  error_context_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_dead_letters (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL,
  shot_id TEXT,
  type TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 0,
  trace_id TEXT NOT NULL,
  dead_reason TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  error_context_json JSONB,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_audit_logs (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  episode_id TEXT,
  trace_id TEXT,
  job_kind TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION enforce_task_shot_episode_consistency()
RETURNS trigger AS $$
BEGIN
  IF NEW.shot_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM shots s
    WHERE s.id = NEW.shot_id
      AND s.episode_id = NEW.episode_id
  ) THEN
    RAISE EXCEPTION 'task shot_id % does not belong to episode_id %', NEW.shot_id, NEW.episode_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_episode_shot_consistency ON tasks;
CREATE TRIGGER trg_tasks_episode_shot_consistency
BEFORE INSERT OR UPDATE OF episode_id, shot_id
ON tasks
FOR EACH ROW
EXECUTE FUNCTION enforce_task_shot_episode_consistency();

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trace_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
UPDATE tasks SET trace_id = id WHERE trace_id IS NULL OR trace_id = '';

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS script TEXT NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS context TEXT NOT NULL DEFAULT '';

ALTER TABLE shots ADD COLUMN IF NOT EXISTS matrix_prompts_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS matrix_image_key TEXT;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS split_image_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb;

WITH ordered_shots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY episode_id
      ORDER BY order_index ASC, created_at ASC, id ASC
    ) AS normalized_order_index
  FROM shots
)
UPDATE shots AS s
SET order_index = ordered_shots.normalized_order_index
FROM ordered_shots
WHERE s.id = ordered_shots.id
  AND s.order_index <> ordered_shots.normalized_order_index;

CREATE INDEX IF NOT EXISTS idx_shots_episode_id ON shots (episode_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shots_episode_order ON shots (episode_id, order_index);
CREATE INDEX IF NOT EXISTS idx_assets_episode_id ON assets (episode_id);
CREATE INDEX IF NOT EXISTS idx_tasks_episode_id ON tasks (episode_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_next_attempt_at ON tasks (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_running_kind_lease ON tasks (job_kind, lease_expires_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_tasks_kind_last_attempt ON tasks (job_kind, last_attempt_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks (episode_id, job_kind, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_task_dead_letters_created_at ON task_dead_letters (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_audit_logs_created_at ON task_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_audit_logs_batch_id ON task_audit_logs (batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_audit_logs_task_id ON task_audit_logs (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_audit_logs_trace_id ON task_audit_logs (trace_id, created_at DESC);
