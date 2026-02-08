import { randomUUID } from 'node:crypto';
import type { TaskAuditLogRecord, TaskDeadLetterRecord, TaskRecord, TaskStatus, TaskType } from '../models';
import { queryRows, withClient } from '../db';

export type CreateTaskInput = {
  episodeId: string;
  shotId?: string | null;
  type: TaskType;
  jobKind: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  traceId?: string;
  idempotencyKey?: string | null;
};

export type TaskReportInput = {
  status: TaskStatus;
  progress?: number | null;
  result?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorContext?: Record<string, unknown> | null;
};

export type ClaimTaskInput = {
  leaseToken: string;
  leaseMs: number;
  kindConcurrency?: Record<string, number>;
  defaultKindConcurrency: number;
  kindMinIntervalMs?: Record<string, number>;
  defaultKindMinIntervalMs: number;
};

export type SettleTaskFailureInput = {
  leaseToken: string;
  errorCode: string;
  errorMessage: string;
  errorContext?: Record<string, unknown>;
  retryable: boolean;
  backoffMs: number;
};

export type SettleTaskFailureResult = {
  task: TaskRecord | null;
  outcome: 'stale' | 'retried' | 'failed';
  deadLettered: boolean;
};

export type RecoverExpiredRunningInput = {
  limit: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
};

export type RecoverExpiredRunningResult = {
  processed: number;
  requeued: number;
  failed: number;
};

export type TaskQueueMetrics = {
  queuedTotal: number;
  queuedReady: number;
  queuedDelayed: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  deadLetterCount: number;
};

export type TaskKindOpsSummary = {
  job_kind: string;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  dead_letter: number;
};

export type TaskOpsSnapshot = {
  summaryByKind: TaskKindOpsSummary[];
  recentFailedTasks: TaskRecord[];
  recentDeadLetters: TaskDeadLetterRecord[];
  recentAuditLogs: TaskAuditLogRecord[];
  auditPagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

export type TaskOpsSnapshotFilters = {
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  limit?: number;
  auditAction?: string;
  auditActor?: string;
  auditPage?: number;
  auditPageSize?: number;
};

export type TaskAuditQueryFilters = {
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  auditAction?: string;
  auditActor?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
};

export type TaskAuditAction =
  | 'TASK_RETRY_SINGLE'
  | 'TASK_RETRY_BATCH_ITEM'
  | 'TASK_RETRY_BATCH_SUMMARY'
  | 'TASK_RETRY_BATCH_SKIPPED'
  | 'TASK_AUDIT_PRUNE_SUMMARY';

export type TaskAuditInput = {
  batchId?: string | null;
  taskId?: string | null;
  episodeId?: string | null;
  traceId?: string | null;
  jobKind?: string | null;
  action: TaskAuditAction;
  actor: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type RetryTaskInput = {
  actor?: string;
  reason?: string;
  batchId?: string | null;
  metadata?: Record<string, unknown>;
};

export type PruneTaskAuditLogsInput = {
  olderThanDays?: number;
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  auditAction?: string;
  auditActor?: string;
  batchId?: string;
  limit?: number;
  actor?: string;
  reason?: string;
  dryRun?: boolean;
};

export type PruneTaskAuditLogsResult = {
  mode: 'dry_run' | 'executed';
  batchId: string;
  cutoffAt: string;
  matched: number;
  selected: number;
  deleted: number;
  sampleIds: string[];
};

export type BulkRetryDeadLettersInput = {
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  deadReason?: string;
  errorCode?: string;
  taskIds?: string[];
  limit?: number;
  actor?: string;
  reason?: string;
  dryRun?: boolean;
};

export type PreviewDeadLetterMatchesInput = {
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  deadReason?: string;
  errorCode?: string;
  page?: number;
  pageSize?: number;
};

export type PreviewDeadLetterMatchesResult = {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  taskIds: string[];
};

export type BulkRetryDeadLettersResult = {
  mode: 'dry_run' | 'executed';
  batchId: string;
  selected: number;
  retried: number;
  skipped: number;
  selectedTaskIds: string[];
  retriedTaskIds: string[];
};

export type BreakdownShotInput = {
  orderIndex: number;
  originalText: string;
  visualTranslation: string;
};

export type EnsureEpisodeBreakdownInput = {
  episodeId: string;
  traceId?: string;
  maxAttempts?: number;
  shots: BreakdownShotInput[];
};

export type EnsureEpisodeBreakdownResult = {
  shotIds: string[];
  matrixTaskIds: string[];
};

function normalizeMaxAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.round(value as number)));
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function computeBackoffMs(attemptCount: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const delay = baseMs * 2 ** exponent;
  return Math.min(maxMs, delay);
}

function normalizeFilterString(value: string | undefined): string | undefined {
  const trimmed = (value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeActor(value: string | undefined): string {
  const trimmed = (value || '').trim();
  return trimmed || 'ops-console';
}

function normalizeReason(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed || fallback;
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function normalizeTaskIds(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const taskIds: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    taskIds.push(trimmed);
    if (taskIds.length >= 500) break;
  }
  return taskIds;
}

type TxClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

async function insertTaskAuditLogTx(
  client: TxClient,
  input: TaskAuditInput,
): Promise<void> {
  await client.query(
    `
      INSERT INTO task_audit_logs (
        id,
        batch_id,
        task_id,
        episode_id,
        trace_id,
        job_kind,
        action,
        actor,
        message,
        metadata_json,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
    `,
    [
      randomUUID(),
      input.batchId || null,
      input.taskId || null,
      input.episodeId || null,
      input.traceId || null,
      input.jobKind || null,
      input.action,
      input.actor,
      input.message,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

async function assertShotBelongsToEpisode(input: { shotId: string; episodeId: string }): Promise<void> {
  const rows = await queryRows<{ episode_id: string }>(
    `
      SELECT episode_id
      FROM shots
      WHERE id = $1
      LIMIT 1
    `,
    [input.shotId],
  );
  const shot = rows[0];
  if (!shot) {
    throw new Error(`SHOT_NOT_FOUND:${input.shotId}`);
  }
  if (shot.episode_id !== input.episodeId) {
    throw new Error(`SHOT_EPISODE_MISMATCH:${input.shotId}`);
  }
}

function buildTaskWhere(filters: TaskOpsSnapshotFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const episodeId = normalizeFilterString(filters.episodeId);
  const jobKind = normalizeFilterString(filters.jobKind);
  const traceId = normalizeFilterString(filters.traceId);
  if (episodeId) {
    params.push(episodeId);
    where.push(`episode_id = $${params.length}`);
  }
  if (jobKind) {
    params.push(jobKind);
    where.push(`job_kind = $${params.length}`);
  }
  if (traceId) {
    params.push(`%${traceId}%`);
    where.push(`trace_id ILIKE $${params.length}`);
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function buildDeadLetterWhere(filters: TaskOpsSnapshotFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const episodeId = normalizeFilterString(filters.episodeId);
  const jobKind = normalizeFilterString(filters.jobKind);
  const traceId = normalizeFilterString(filters.traceId);
  if (episodeId) {
    params.push(episodeId);
    where.push(`episode_id = $${params.length}`);
  }
  if (jobKind) {
    params.push(jobKind);
    where.push(`job_kind = $${params.length}`);
  }
  if (traceId) {
    params.push(`%${traceId}%`);
    where.push(`trace_id ILIKE $${params.length}`);
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function buildAuditWhere(filters: TaskAuditQueryFilters): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const episodeId = normalizeFilterString(filters.episodeId);
  const jobKind = normalizeFilterString(filters.jobKind);
  const traceId = normalizeFilterString(filters.traceId);
  const auditAction = normalizeFilterString(filters.auditAction);
  const auditActor = normalizeFilterString(filters.auditActor);
  const batchId = normalizeFilterString(filters.batchId);
  if (episodeId) {
    params.push(episodeId);
    where.push(`episode_id = $${params.length}`);
  }
  if (jobKind) {
    params.push(jobKind);
    where.push(`job_kind = $${params.length}`);
  }
  if (traceId) {
    params.push(`%${traceId}%`);
    where.push(`trace_id ILIKE $${params.length}`);
  }
  if (auditAction) {
    params.push(auditAction);
    where.push(`action = $${params.length}`);
  }
  if (auditActor) {
    params.push(`%${auditActor}%`);
    where.push(`actor ILIKE $${params.length}`);
  }
  if (batchId) {
    params.push(batchId);
    where.push(`batch_id = $${params.length}`);
  }
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function buildBulkDeadLetterWhere(filters: BulkRetryDeadLettersInput): { whereSql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const episodeId = normalizeFilterString(filters.episodeId);
  const jobKind = normalizeFilterString(filters.jobKind);
  const traceId = normalizeFilterString(filters.traceId);
  const deadReason = normalizeFilterString(filters.deadReason);
  const errorCode = normalizeFilterString(filters.errorCode);
  const taskIds = normalizeTaskIds(filters.taskIds);
  if (episodeId) {
    params.push(episodeId);
    where.push(`d.episode_id = $${params.length}`);
  }
  if (jobKind) {
    params.push(jobKind);
    where.push(`d.job_kind = $${params.length}`);
  }
  if (traceId) {
    params.push(`%${traceId}%`);
    where.push(`d.trace_id ILIKE $${params.length}`);
  }
  if (deadReason) {
    params.push(deadReason);
    where.push(`d.dead_reason = $${params.length}`);
  }
  if (errorCode) {
    params.push(errorCode);
    where.push(`d.error_code = $${params.length}`);
  }
  if (taskIds.length > 0) {
    params.push(taskIds);
    where.push(`d.task_id = ANY($${params.length}::text[])`);
  }
  return {
    whereSql: where.length > 0 ? `AND ${where.join(' AND ')}` : '',
    params,
  };
}

export async function previewDeadLetterMatches(input: PreviewDeadLetterMatchesInput): Promise<PreviewDeadLetterMatchesResult> {
  const pageSize = normalizeLimit(input.pageSize, 100, 1, 500);
  const page = normalizeLimit(input.page, 1, 1, 5000);
  const offset = (page - 1) * pageSize;
  const where = buildBulkDeadLetterWhere({
    episodeId: input.episodeId,
    jobKind: input.jobKind,
    traceId: input.traceId,
    deadReason: input.deadReason,
    errorCode: input.errorCode,
  });

  const [totalRows, taskRows] = await Promise.all([
    queryRows<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM task_dead_letters d
        INNER JOIN tasks t ON t.id = d.task_id
        WHERE t.status IN ('failed', 'cancelled')
        ${where.whereSql}
      `,
      where.params,
    ),
    queryRows<{ task_id: string }>(
      `
        SELECT d.task_id
        FROM task_dead_letters d
        INNER JOIN tasks t ON t.id = d.task_id
        WHERE t.status IN ('failed', 'cancelled')
        ${where.whereSql}
        ORDER BY d.created_at ASC
        LIMIT $${where.params.length + 1}
        OFFSET $${where.params.length + 2}
      `,
      [...where.params, pageSize, offset],
    ),
  ]);

  const total = totalRows[0]?.total || 0;
  const taskIds = taskRows.map((row) => row.task_id);
  return {
    total,
    page,
    pageSize,
    hasMore: offset + taskIds.length < total,
    taskIds,
  };
}

export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const taskId = randomUUID();
  const traceId = (input.traceId || '').trim() || randomUUID();
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const shotId = normalizeFilterString(input.shotId || undefined) || null;

  if (shotId) {
    await assertShotBelongsToEpisode({ shotId, episodeId: input.episodeId });
  }

  const created = await queryRows<TaskRecord>(
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
        trace_id,
        idempotency_key,
        payload_json,
        result_json,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        'queued', NULL, 0, $6, NOW(),
        $7, $8, $9::jsonb, '{}'::jsonb, NOW(), NOW()
      )
      ON CONFLICT (episode_id, job_kind, idempotency_key)
      DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING *
    `,
    [
      taskId,
      input.episodeId,
      shotId,
      input.type,
      input.jobKind,
      maxAttempts,
      traceId,
      idempotencyKey,
      JSON.stringify(input.payload || {}),
    ],
  );
  return created[0];
}

export async function ensureEpisodeBreakdown(input: EnsureEpisodeBreakdownInput): Promise<EnsureEpisodeBreakdownResult> {
  const normalizedShots = input.shots
    .map((shot, index) => ({
      orderIndex: normalizeLimit(shot.orderIndex, index + 1, 1, 10_000),
      originalText: (shot.originalText || '').trim(),
      visualTranslation: (shot.visualTranslation || '').trim(),
    }))
    .filter((shot) => shot.originalText.length > 0 || shot.visualTranslation.length > 0);
  if (normalizedShots.length === 0) {
    return {
      shotIds: [],
      matrixTaskIds: [],
    };
  }

  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const traceId = normalizeFilterString(input.traceId) || randomUUID();

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const episodeRows = await client.query<{ id: string }>(
        `
          SELECT id
          FROM episodes
          WHERE id = $1
          FOR UPDATE
        `,
        [input.episodeId],
      );
      if (episodeRows.rows.length === 0) {
        throw new Error(`EPISODE_NOT_FOUND:${input.episodeId}`);
      }

      const shotIds: string[] = [];
      const matrixTaskIds: string[] = [];

      for (const shot of normalizedShots) {
        const upsertedShot = await client.query<{ id: string }>(
          `
            INSERT INTO shots (
              id,
              episode_id,
              order_index,
              original_text,
              visual_translation,
              status,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())
            ON CONFLICT (episode_id, order_index)
            DO UPDATE SET updated_at = shots.updated_at
            RETURNING id
          `,
          [randomUUID(), input.episodeId, shot.orderIndex, shot.originalText, shot.visualTranslation],
        );
        const shotId = upsertedShot.rows[0]?.id;
        if (!shotId) {
          throw new Error(`BREAKDOWN_SHOT_UPSERT_FAILED:${input.episodeId}:${shot.orderIndex}`);
        }
        shotIds.push(shotId);

        const matrixTask = await client.query<{ id: string }>(
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
              trace_id,
              idempotency_key,
              payload_json,
              result_json,
              created_at,
              updated_at
            )
            VALUES (
              $1, $2, $3, 'IMAGE', 'SHOT_MATRIX_RENDER',
              'queued', NULL, 0, $4, NOW(),
              $5, $6, '{}'::jsonb, '{}'::jsonb, NOW(), NOW()
            )
            ON CONFLICT (episode_id, job_kind, idempotency_key)
            DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
            RETURNING id
          `,
          [randomUUID(), input.episodeId, shotId, maxAttempts, traceId, shotId],
        );
        const matrixTaskId = matrixTask.rows[0]?.id;
        if (!matrixTaskId) {
          throw new Error(`BREAKDOWN_TASK_UPSERT_FAILED:${shotId}`);
        }
        matrixTaskIds.push(matrixTaskId);
      }

      await client.query('COMMIT');
      return {
        shotIds,
        matrixTaskIds,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function listTasks(filters: { episodeId?: string; status?: TaskStatus }): Promise<TaskRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.episodeId) {
    params.push(filters.episodeId);
    where.push(`episode_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return queryRows<TaskRecord>(
    `
      SELECT *
      FROM tasks
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT 500
    `,
    params,
  );
}

export async function listTaskDeadLetters(filters: TaskOpsSnapshotFilters): Promise<TaskDeadLetterRecord[]> {
  const deadWhere = buildDeadLetterWhere(filters);
  const limit = normalizeLimit(filters.limit, 500, 1, 500);
  return queryRows<TaskDeadLetterRecord>(
    `
      SELECT *
      FROM task_dead_letters
      ${deadWhere.whereSql}
      ORDER BY created_at DESC
      LIMIT $${deadWhere.params.length + 1}
    `,
    [...deadWhere.params, limit],
  );
}

export async function countTaskAuditLogs(filters: TaskAuditQueryFilters): Promise<number> {
  const auditWhere = buildAuditWhere(filters);
  const rows = await queryRows<{ total: number }>(
    `
      SELECT COUNT(*)::int AS total
      FROM task_audit_logs
      ${auditWhere.whereSql}
    `,
    auditWhere.params,
  );
  return rows[0]?.total || 0;
}

export async function listTaskAuditLogs(filters: TaskAuditQueryFilters): Promise<TaskAuditLogRecord[]> {
  const auditWhere = buildAuditWhere(filters);
  const limit = normalizeLimit(filters.limit, 50, 1, 5000);
  const offset = normalizeLimit(filters.offset, 0, 0, 1000000);
  return queryRows<TaskAuditLogRecord>(
    `
      SELECT *
      FROM task_audit_logs
      ${auditWhere.whereSql}
      ORDER BY created_at DESC
      LIMIT $${auditWhere.params.length + 1}
      OFFSET $${auditWhere.params.length + 2}
    `,
    [...auditWhere.params, limit, offset],
  );
}

export async function pruneTaskAuditLogs(input: PruneTaskAuditLogsInput): Promise<PruneTaskAuditLogsResult> {
  const olderThanDays = normalizeLimit(input.olderThanDays, 30, 0, 3650);
  const cutoffAt = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const limit = normalizeLimit(input.limit, 500, 1, 5000);
  const actor = normalizeActor(input.actor);
  const reason = normalizeReason(input.reason, 'audit_log_retention');
  const dryRun = Boolean(input.dryRun);
  const batchId = randomUUID();

  const auditFilters: TaskAuditQueryFilters = {
    episodeId: input.episodeId,
    jobKind: input.jobKind,
    traceId: input.traceId,
    auditAction: input.auditAction,
    auditActor: input.auditActor,
    batchId: input.batchId,
  };
  const auditWhere = buildAuditWhere(auditFilters);
  const whereSql = auditWhere.whereSql
    ? `${auditWhere.whereSql} AND created_at < $${auditWhere.params.length + 1}`
    : `WHERE created_at < $${auditWhere.params.length + 1}`;
  const baseParams = [...auditWhere.params, cutoffAt];

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const totalRows = await client.query<{ total: number }>(
        `
          SELECT COUNT(*)::int AS total
          FROM task_audit_logs
          ${whereSql}
        `,
        baseParams,
      );
      const matched = totalRows.rows[0]?.total || 0;
      const selectedRows = await client.query<{ id: string }>(
        `
          SELECT id
          FROM task_audit_logs
          ${whereSql}
          ORDER BY created_at ASC
          LIMIT $${baseParams.length + 1}
          FOR UPDATE SKIP LOCKED
        `,
        [...baseParams, limit],
      );
      const selectedIds = selectedRows.rows.map((row) => row.id);
      if (dryRun) {
        await client.query('COMMIT');
        return {
          mode: 'dry_run',
          batchId,
          cutoffAt,
          matched,
          selected: selectedIds.length,
          deleted: 0,
          sampleIds: selectedIds.slice(0, 20),
        };
      }

      let deleted = 0;
      if (selectedIds.length > 0) {
        const deletedRows = await client.query<{ id: string }>(
          `
            DELETE FROM task_audit_logs
            WHERE id = ANY($1::text[])
            RETURNING id
          `,
          [selectedIds],
        );
        deleted = deletedRows.rows.length;
      }

      await insertTaskAuditLogTx(client, {
        batchId,
        episodeId: normalizeFilterString(input.episodeId) || null,
        traceId: normalizeFilterString(input.traceId) || null,
        jobKind: normalizeFilterString(input.jobKind) || null,
        action: 'TASK_AUDIT_PRUNE_SUMMARY',
        actor,
        message: deleted > 0 ? 'Task audit logs pruned' : 'Task audit prune executed with no matched rows',
        metadata: {
          reason,
          olderThanDays,
          cutoffAt,
          matched,
          selected: selectedIds.length,
          deleted,
          filters: {
            episodeId: input.episodeId || null,
            jobKind: input.jobKind || null,
            traceId: input.traceId || null,
            auditAction: input.auditAction || null,
            auditActor: input.auditActor || null,
            batchId: input.batchId || null,
            limit,
          },
        },
      });

      await client.query('COMMIT');
      return {
        mode: 'executed',
        batchId,
        cutoffAt,
        matched,
        selected: selectedIds.length,
        deleted,
        sampleIds: selectedIds.slice(0, 20),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getTaskQueueMetrics(): Promise<TaskQueueMetrics> {
  const rows = await queryRows<TaskQueueMetrics>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS "queuedTotal",
        COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= NOW())::int AS "queuedReady",
        COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at > NOW())::int AS "queuedDelayed",
        COUNT(*) FILTER (WHERE status = 'running')::int AS "running",
        COUNT(*) FILTER (WHERE status = 'completed')::int AS "completed",
        COUNT(*) FILTER (WHERE status = 'failed')::int AS "failed",
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS "cancelled",
        COALESCE((SELECT COUNT(*)::int FROM task_dead_letters), 0) AS "deadLetterCount"
      FROM tasks
    `,
  );
  return (
    rows[0] || {
      queuedTotal: 0,
      queuedReady: 0,
      queuedDelayed: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      deadLetterCount: 0,
    }
  );
}

export async function getTaskOpsSnapshot(filters: TaskOpsSnapshotFilters): Promise<TaskOpsSnapshot> {
  const limit = normalizeLimit(filters.limit, 50, 1, 200);
  const auditPageSize = normalizeLimit(filters.auditPageSize, limit, 1, 200);
  const auditPage = normalizeLimit(filters.auditPage, 1, 1, 5000);
  const auditOffset = (auditPage - 1) * auditPageSize;
  const taskWhere = buildTaskWhere(filters);
  const deadWhere = buildDeadLetterWhere(filters);
  const auditFilters: TaskAuditQueryFilters = {
    episodeId: filters.episodeId,
    jobKind: filters.jobKind,
    traceId: filters.traceId,
    auditAction: filters.auditAction,
    auditActor: filters.auditActor,
    limit: auditPageSize,
    offset: auditOffset,
  };

  const [taskCounts, deadCounts, recentFailedTasks, recentDeadLetters, auditTotal, recentAuditLogs] = await Promise.all([
    queryRows<{
      job_kind: string;
      queued: number;
      running: number;
      completed: number;
      failed: number;
      cancelled: number;
    }>(
      `
        SELECT
          job_kind,
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
          COUNT(*) FILTER (WHERE status = 'running')::int AS running,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
        FROM tasks
        ${taskWhere.whereSql}
        GROUP BY job_kind
      `,
      taskWhere.params,
    ),
    queryRows<{ job_kind: string; dead_letter: number }>(
      `
        SELECT
          job_kind,
          COUNT(*)::int AS dead_letter
        FROM task_dead_letters
        ${deadWhere.whereSql}
        GROUP BY job_kind
      `,
      deadWhere.params,
    ),
    queryRows<TaskRecord>(
      `
        SELECT *
        FROM tasks
        ${taskWhere.whereSql ? `${taskWhere.whereSql} AND status = 'failed'` : `WHERE status = 'failed'`}
        ORDER BY updated_at DESC
        LIMIT $${taskWhere.params.length + 1}
      `,
      [...taskWhere.params, limit],
    ),
    queryRows<TaskDeadLetterRecord>(
      `
        SELECT *
        FROM task_dead_letters
        ${deadWhere.whereSql}
        ORDER BY created_at DESC
        LIMIT $${deadWhere.params.length + 1}
      `,
      [...deadWhere.params, limit],
    ),
    countTaskAuditLogs(auditFilters),
    listTaskAuditLogs(auditFilters),
  ]);

  const byKind = new Map<string, TaskKindOpsSummary>();
  for (const row of taskCounts) {
    byKind.set(row.job_kind, {
      job_kind: row.job_kind,
      queued: row.queued || 0,
      running: row.running || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      cancelled: row.cancelled || 0,
      dead_letter: 0,
    });
  }
  for (const row of deadCounts) {
    const existing = byKind.get(row.job_kind);
    if (existing) {
      existing.dead_letter = row.dead_letter || 0;
      continue;
    }
    byKind.set(row.job_kind, {
      job_kind: row.job_kind,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      dead_letter: row.dead_letter || 0,
    });
  }

  return {
    summaryByKind: Array.from(byKind.values()).sort((a, b) => a.job_kind.localeCompare(b.job_kind)),
    recentFailedTasks,
    recentDeadLetters,
    recentAuditLogs,
    auditPagination: {
      page: auditPage,
      pageSize: auditPageSize,
      total: auditTotal,
      hasMore: auditOffset + recentAuditLogs.length < auditTotal,
    },
  };
}

export async function getTaskById(taskId: string): Promise<TaskRecord | null> {
  const rows = await queryRows<TaskRecord>(
    `
      SELECT *
      FROM tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId],
  );
  return rows[0] || null;
}

export async function updateTaskReport(taskId: string, input: TaskReportInput): Promise<TaskRecord | null> {
  const updated = await queryRows<TaskRecord>(
    `
      UPDATE tasks
      SET
        status = $2,
        progress = $3,
        result_json = COALESCE($4::jsonb, result_json),
        error_code = $5,
        error_message = $6,
        error_context_json = $7::jsonb,
        lease_token = CASE WHEN $2 IN ('queued', 'completed', 'failed', 'cancelled') THEN NULL ELSE lease_token END,
        lease_expires_at = CASE WHEN $2 IN ('queued', 'completed', 'failed', 'cancelled') THEN NULL ELSE lease_expires_at END,
        next_attempt_at = CASE WHEN $2 = 'queued' THEN NOW() ELSE next_attempt_at END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      taskId,
      input.status,
      input.progress ?? null,
      input.result ? JSON.stringify(input.result) : null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.errorContext ? JSON.stringify(input.errorContext) : null,
    ],
  );
  return updated[0] || null;
}

export async function cancelTask(taskId: string): Promise<TaskRecord | null> {
  const updated = await queryRows<TaskRecord>(
    `
      UPDATE tasks
      SET
        status = 'cancelled',
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'running')
      RETURNING *
    `,
    [taskId],
  );
  return updated[0] || null;
}

export async function retryTask(taskId: string, input?: RetryTaskInput): Promise<TaskRecord | null> {
  const actor = normalizeActor(input?.actor);
  const reason = normalizeReason(input?.reason, 'manual_retry');
  const batchId = input?.batchId || null;

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const before = await client.query<TaskRecord>(
        `
          SELECT *
          FROM tasks
          WHERE id = $1
          FOR UPDATE
        `,
        [taskId],
      );
      const previous = before.rows[0] || null;
      if (!previous || !['failed', 'cancelled'].includes(previous.status)) {
        await client.query('COMMIT');
        return null;
      }

      const updated = await client.query<TaskRecord>(
        `
          UPDATE tasks
          SET
            status = 'queued',
            progress = NULL,
            attempt_count = 0,
            next_attempt_at = NOW(),
            last_attempt_at = NULL,
            result_json = '{}'::jsonb,
            error_code = NULL,
            error_message = NULL,
            error_context_json = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $1 AND status IN ('failed', 'cancelled')
          RETURNING *
        `,
        [taskId],
      );
      const task = updated.rows[0] || null;
      if (task) {
        const deletedDeadLetters = await client.query<{ task_id: string }>(
          `
            DELETE FROM task_dead_letters
            WHERE task_id = $1
            RETURNING task_id
          `,
          [taskId],
        );
        await insertTaskAuditLogTx(client, {
          batchId,
          taskId: task.id,
          episodeId: task.episode_id,
          traceId: task.trace_id,
          jobKind: task.job_kind,
          action: 'TASK_RETRY_SINGLE',
          actor,
          message: 'Task retried from failed/cancelled state',
          metadata: {
            reason,
            previousStatus: previous.status,
            hadDeadLetter: deletedDeadLetters.rows.length > 0,
            previousAttemptCount: previous.attempt_count,
            previousMaxAttempts: previous.max_attempts,
            ...input?.metadata,
          },
        });
      }
      await client.query('COMMIT');
      return task;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function bulkRetryDeadLetters(input: BulkRetryDeadLettersInput): Promise<BulkRetryDeadLettersResult> {
  const batchId = randomUUID();
  const actor = normalizeActor(input.actor);
  const reason = normalizeReason(input.reason, 'manual_bulk_retry');
  const taskIds = normalizeTaskIds(input.taskIds);
  const defaultLimit = taskIds.length > 0 ? taskIds.length : 100;
  const limit = normalizeLimit(input.limit, defaultLimit, 1, 500);
  const dryRun = Boolean(input.dryRun);
  const scopeEpisodeId = normalizeFilterString(input.episodeId);
  const scopeJobKind = normalizeFilterString(input.jobKind);
  const scopeTraceId = normalizeFilterString(input.traceId);
  const where = buildBulkDeadLetterWhere({
    ...input,
    taskIds,
  });

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const selected = await client.query<
        TaskDeadLetterRecord & {
          task_status: string;
        }
      >(
        `
          SELECT
            d.*,
            t.status AS task_status
          FROM task_dead_letters d
          INNER JOIN tasks t ON t.id = d.task_id
          WHERE t.status IN ('failed', 'cancelled')
          ${where.whereSql}
          ORDER BY d.created_at ASC
          LIMIT $${where.params.length + 1}
          FOR UPDATE OF d, t SKIP LOCKED
        `,
        [...where.params, limit],
      );

      let retried = 0;
      let skipped = 0;
      const selectedTaskIds = selected.rows.map((item) => item.task_id);
      const retriedTaskIds: string[] = [];
      if (dryRun) {
        await client.query('COMMIT');
        return {
          mode: 'dry_run',
          batchId,
          selected: selected.rows.length,
          retried: 0,
          skipped: 0,
          selectedTaskIds,
          retriedTaskIds,
        };
      }
      for (const candidate of selected.rows) {
        const updated = await client.query<TaskRecord>(
          `
            UPDATE tasks
            SET
              status = 'queued',
              progress = NULL,
              attempt_count = 0,
              next_attempt_at = NOW(),
              last_attempt_at = NULL,
              result_json = '{}'::jsonb,
              error_code = NULL,
              error_message = NULL,
              error_context_json = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
            WHERE id = $1 AND status IN ('failed', 'cancelled')
            RETURNING *
          `,
          [candidate.task_id],
        );
        const task = updated.rows[0] || null;
        if (!task) {
          skipped += 1;
          await insertTaskAuditLogTx(client, {
            batchId,
            taskId: candidate.task_id,
            episodeId: candidate.episode_id,
            traceId: candidate.trace_id,
            jobKind: candidate.job_kind,
            action: 'TASK_RETRY_BATCH_SKIPPED',
            actor,
            message: 'Task skipped during dead-letter bulk retry',
            metadata: {
              reason,
              deadReason: candidate.dead_reason,
              errorCode: candidate.error_code,
            },
          });
          continue;
        }

        await client.query(
          `
            DELETE FROM task_dead_letters
            WHERE task_id = $1
          `,
          [task.id],
        );
        retried += 1;
        retriedTaskIds.push(task.id);
        await insertTaskAuditLogTx(client, {
          batchId,
          taskId: task.id,
          episodeId: task.episode_id,
          traceId: task.trace_id,
          jobKind: task.job_kind,
          action: 'TASK_RETRY_BATCH_ITEM',
          actor,
          message: 'Task retried from dead-letter batch',
          metadata: {
            reason,
            deadReason: candidate.dead_reason,
            errorCode: candidate.error_code,
            attempts: candidate.attempts,
            maxAttempts: candidate.max_attempts,
          },
        });
      }

      await insertTaskAuditLogTx(client, {
        batchId,
        episodeId: scopeEpisodeId || null,
        traceId: scopeTraceId || null,
        jobKind: scopeJobKind || null,
        action: 'TASK_RETRY_BATCH_SUMMARY',
        actor,
        message: 'Dead-letter bulk retry finished',
        metadata: {
          reason,
          selected: selected.rows.length,
          retried,
          skipped,
          filters: {
            episodeId: input.episodeId || null,
            jobKind: input.jobKind || null,
            traceId: input.traceId || null,
            deadReason: input.deadReason || null,
            errorCode: input.errorCode || null,
            taskIdsCount: taskIds.length,
            taskIdsSample: taskIds.length > 0 ? taskIds.slice(0, 20) : null,
            limit,
          },
        },
      });

      await client.query('COMMIT');
      return {
        mode: 'executed',
        batchId,
        selected: selected.rows.length,
        retried,
        skipped,
        selectedTaskIds,
        retriedTaskIds,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function claimNextQueuedTask(input: ClaimTaskInput): Promise<TaskRecord | null> {
  const kindConcurrency = JSON.stringify(input.kindConcurrency || {});
  const defaultKindConcurrency = Math.max(1, Math.round(input.defaultKindConcurrency));
  const kindMinIntervalMs = JSON.stringify(input.kindMinIntervalMs || {});
  const defaultKindMinIntervalMs = Math.max(0, Math.round(input.defaultKindMinIntervalMs));

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const claimed = await client.query<TaskRecord>(
        `
          WITH candidate AS (
            SELECT t.id
            FROM tasks t
            CROSS JOIN LATERAL (
              SELECT pg_try_advisory_xact_lock(hashtext(t.job_kind)) AS kind_lock_acquired
            ) lk
            WHERE t.status = 'queued'
              AND t.next_attempt_at <= NOW()
              AND lk.kind_lock_acquired
              AND (
                SELECT COUNT(*)::int
                FROM tasks r
                WHERE r.status = 'running'
                  AND r.job_kind = t.job_kind
                  AND r.lease_expires_at IS NOT NULL
                  AND r.lease_expires_at > NOW()
              ) < GREATEST(
                1,
                COALESCE(($3::jsonb ->> t.job_kind)::int, $4::int)
              )
              AND (
                COALESCE(($5::jsonb ->> t.job_kind)::int, $6::int) <= 0
                OR NOT EXISTS (
                  SELECT 1
                  FROM tasks recent
                  WHERE recent.job_kind = t.job_kind
                    AND recent.last_attempt_at IS NOT NULL
                    AND recent.last_attempt_at > NOW() - (COALESCE(($5::jsonb ->> t.job_kind)::int, $6::int) * INTERVAL '1 millisecond')
                )
              )
            ORDER BY t.next_attempt_at ASC, t.created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE tasks AS t
          SET
            status = 'running',
            progress = 0,
            attempt_count = COALESCE(t.attempt_count, 0) + 1,
            last_attempt_at = NOW(),
            lease_token = $1,
            lease_expires_at = NOW() + ($2::int * INTERVAL '1 millisecond'),
            updated_at = NOW()
          FROM candidate
          WHERE t.id = candidate.id
          RETURNING t.*
        `,
        [
          input.leaseToken,
          input.leaseMs,
          kindConcurrency,
          defaultKindConcurrency,
          kindMinIntervalMs,
          defaultKindMinIntervalMs,
        ],
      );
      await client.query('COMMIT');
      return claimed.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function extendTaskLease(taskId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
  const updated = await queryRows<{ id: string }>(
    `
      UPDATE tasks
      SET
        lease_expires_at = NOW() + ($3::int * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND lease_token = $2 AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()
      RETURNING id
    `,
    [taskId, leaseToken, leaseMs],
  );
  return updated.length > 0;
}

export async function markTaskCompleted(
  taskId: string,
  leaseToken: string,
  result: Record<string, unknown>,
): Promise<TaskRecord | null> {
  const updated = await queryRows<TaskRecord>(
    `
      UPDATE tasks
      SET
        status = 'completed',
        progress = 1,
        result_json = $3::jsonb,
        error_code = NULL,
        error_message = NULL,
        error_context_json = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND lease_token = $2 AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()
      RETURNING *
    `,
    [taskId, leaseToken, JSON.stringify(result)],
  );
  return updated[0] || null;
}

export async function recoverExpiredRunningTasks(input: RecoverExpiredRunningInput): Promise<RecoverExpiredRunningResult> {
  const limit = Math.max(1, Math.min(200, Math.round(input.limit)));
  const baseMs = Math.max(100, Math.round(input.backoffBaseMs));
  const maxMs = Math.max(baseMs, Math.round(input.backoffMaxMs));

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const selected = await client.query<TaskRecord>(
        `
          SELECT *
          FROM tasks
          WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()
          ORDER BY lease_expires_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        `,
        [limit],
      );

      let requeued = 0;
      let failed = 0;
      for (const task of selected.rows) {
        const attempts = Math.max(1, Number(task.attempt_count) || 1);
        const maxAttempts = Math.max(1, Number(task.max_attempts) || 1);
        const context = {
          reason: 'lease_expired',
          traceId: task.trace_id,
          attempt: attempts,
          maxAttempts,
        };

        if (attempts < maxAttempts) {
          const backoffMs = computeBackoffMs(attempts, baseMs, maxMs);
          await client.query(
            `
              UPDATE tasks
              SET
                status = 'queued',
                progress = NULL,
                error_code = 'TASK_EXECUTION_FAILED',
                error_message = 'Worker lease expired before completion',
                error_context_json = $2::jsonb,
                next_attempt_at = NOW() + ($3::int * INTERVAL '1 millisecond'),
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
              WHERE id = $1
            `,
            [task.id, JSON.stringify(context), backoffMs],
          );
          requeued += 1;
          continue;
        }

        await client.query(
          `
            UPDATE tasks
            SET
              status = 'failed',
              progress = 1,
              error_code = 'TASK_EXECUTION_FAILED',
              error_message = 'Worker lease expired and max attempts reached',
              error_context_json = $2::jsonb,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
            WHERE id = $1
          `,
          [task.id, JSON.stringify(context)],
        );
        await client.query(
          `
            INSERT INTO task_dead_letters (
              id,
              task_id,
              episode_id,
              shot_id,
              type,
              job_kind,
              attempts,
              max_attempts,
              trace_id,
              dead_reason,
              error_code,
              error_message,
              error_context_json,
              payload_json,
              result_json,
              created_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, 'lease_expired_max_attempts', 'TASK_EXECUTION_FAILED',
              'Worker lease expired and max attempts reached', $10::jsonb, $11::jsonb, $12::jsonb, NOW()
            )
            ON CONFLICT (task_id)
            DO UPDATE SET
              attempts = EXCLUDED.attempts,
              max_attempts = EXCLUDED.max_attempts,
              dead_reason = EXCLUDED.dead_reason,
              error_code = EXCLUDED.error_code,
              error_message = EXCLUDED.error_message,
              error_context_json = EXCLUDED.error_context_json,
              payload_json = EXCLUDED.payload_json,
              result_json = EXCLUDED.result_json,
              created_at = EXCLUDED.created_at
          `,
          [
            randomUUID(),
            task.id,
            task.episode_id,
            task.shot_id,
            task.type,
            task.job_kind,
            attempts,
            maxAttempts,
            task.trace_id,
            JSON.stringify(context),
            JSON.stringify(task.payload_json || {}),
            JSON.stringify(task.result_json || {}),
          ],
        );
        failed += 1;
      }

      await client.query('COMMIT');
      return {
        processed: selected.rows.length,
        requeued,
        failed,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function settleTaskFailure(taskId: string, input: SettleTaskFailureInput): Promise<SettleTaskFailureResult> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const selected = await client.query<TaskRecord>(
        `
          SELECT *
          FROM tasks
          WHERE id = $1 AND status = 'running' AND lease_token = $2 AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()
          FOR UPDATE
        `,
        [taskId, input.leaseToken],
      );
      const active = selected.rows[0] || null;
      if (!active) {
        await client.query('COMMIT');
        return {
          task: null,
          outcome: 'stale',
          deadLettered: false,
        };
      }

      const attempts = Math.max(1, Number(active.attempt_count) || 1);
      const maxAttempts = Math.max(1, Number(active.max_attempts) || 1);
      const canRetry = input.retryable && attempts < maxAttempts;
      if (canRetry) {
        const requeued = await client.query<TaskRecord>(
          `
            UPDATE tasks
            SET
              status = 'queued',
              progress = NULL,
              error_code = $3,
              error_message = $4,
              error_context_json = $5::jsonb,
              next_attempt_at = NOW() + ($6::int * INTERVAL '1 millisecond'),
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
            WHERE id = $1 AND lease_token = $2
            RETURNING *
          `,
          [
            taskId,
            input.leaseToken,
            input.errorCode,
            input.errorMessage,
            input.errorContext ? JSON.stringify(input.errorContext) : null,
            Math.max(0, Math.round(input.backoffMs)),
          ],
        );
        await client.query('COMMIT');
        return {
          task: requeued.rows[0] || null,
          outcome: 'retried',
          deadLettered: false,
        };
      }

      const failed = await client.query<TaskRecord>(
        `
          UPDATE tasks
          SET
            status = 'failed',
            progress = 1,
            error_code = $3,
            error_message = $4,
            error_context_json = $5::jsonb,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $1 AND lease_token = $2
          RETURNING *
        `,
        [taskId, input.leaseToken, input.errorCode, input.errorMessage, input.errorContext ? JSON.stringify(input.errorContext) : null],
      );
      const failedTask = failed.rows[0] || null;
      if (failedTask) {
        const deadReason = input.retryable ? 'max_attempts_exceeded' : 'non_retryable';
        await client.query(
          `
            INSERT INTO task_dead_letters (
              id,
              task_id,
              episode_id,
              shot_id,
              type,
              job_kind,
              attempts,
              max_attempts,
              trace_id,
              dead_reason,
              error_code,
              error_message,
              error_context_json,
              payload_json,
              result_json,
              created_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, NOW()
            )
            ON CONFLICT (task_id)
            DO UPDATE SET
              attempts = EXCLUDED.attempts,
              max_attempts = EXCLUDED.max_attempts,
              dead_reason = EXCLUDED.dead_reason,
              error_code = EXCLUDED.error_code,
              error_message = EXCLUDED.error_message,
              error_context_json = EXCLUDED.error_context_json,
              payload_json = EXCLUDED.payload_json,
              result_json = EXCLUDED.result_json,
              created_at = EXCLUDED.created_at
          `,
          [
            randomUUID(),
            failedTask.id,
            failedTask.episode_id,
            failedTask.shot_id,
            failedTask.type,
            failedTask.job_kind,
            attempts,
            maxAttempts,
            failedTask.trace_id,
            deadReason,
            input.errorCode,
            input.errorMessage,
            input.errorContext ? JSON.stringify(input.errorContext) : null,
            JSON.stringify(failedTask.payload_json || {}),
            JSON.stringify(failedTask.result_json || {}),
          ],
        );
      }

      await client.query('COMMIT');
      return {
        task: failedTask,
        outcome: 'failed',
        deadLettered: !!failedTask,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
