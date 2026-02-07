export type EpisodeRecord = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ShotRecord = {
  id: string;
  episode_id: string;
  order_index: number;
  original_text: string;
  visual_translation: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AssetType = 'character' | 'scene' | 'prop';

export type AssetRecord = {
  id: string;
  episode_id: string;
  type: AssetType;
  name: string;
  description: string;
  media_key: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskType = 'LLM' | 'IMAGE' | 'VIDEO' | 'EXPORT' | 'SYSTEM';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskRecord = {
  id: string;
  episode_id: string;
  shot_id: string | null;
  type: TaskType;
  job_kind: string;
  status: TaskStatus;
  progress: number | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  trace_id: string;
  idempotency_key: string | null;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  error_context_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type TaskDeadLetterRecord = {
  id: string;
  task_id: string;
  episode_id: string;
  shot_id: string | null;
  type: TaskType;
  job_kind: string;
  attempts: number;
  max_attempts: number;
  trace_id: string;
  dead_reason: string;
  error_code: string | null;
  error_message: string | null;
  error_context_json: Record<string, unknown> | null;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  created_at: string;
};

export type TaskAuditLogRecord = {
  id: string;
  batch_id: string | null;
  task_id: string | null;
  episode_id: string | null;
  trace_id: string | null;
  job_kind: string | null;
  action: string;
  actor: string;
  message: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
};
