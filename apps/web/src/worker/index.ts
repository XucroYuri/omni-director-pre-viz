import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensurePhase91Schema } from '../lib/schema';
import {
  claimNextQueuedTask,
  extendTaskLease,
  markTaskCompleted,
  pruneTaskAuditLogs,
  recoverExpiredRunningTasks,
  settleTaskFailure,
} from '../lib/repos/tasks';
import { isRetryableTaskErrorCode, toTaskWorkerError } from '../lib/taskErrors';
import { executeTask } from './executeTask';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function logWorker(
  level: 'info' | 'warn' | 'error',
  event: string,
  workerId: string,
  detail: Record<string, unknown>,
) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    workerId,
    ...detail,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function computeBackoffMs(attemptCount: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const delay = baseMs * 2 ** exponent;
  return Math.min(maxMs, delay);
}

function parseIntMapEnv(value: string | undefined, min: number, max: number): Record<string, number> {
  if (!value || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      if (typeof rawKey !== 'string') continue;
      const key = rawKey.trim();
      if (!key) continue;
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue;
      result[key] = clampInt(rawValue, min, max);
    }
    return result;
  } catch {
    return {};
  }
}

async function loadEnvLocal() {
  const candidates = [path.join(process.cwd(), '.env.local'), path.join(process.cwd(), 'apps', 'web', '.env.local')];
  for (const envPath of candidates) {
    try {
      const text = await fs.readFile(envPath, 'utf8');
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

type WorkerConfig = {
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  recoveryIntervalMs: number;
  recoveryBatchSize: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  defaultKindConcurrency: number;
  defaultKindMinIntervalMs: number;
  kindConcurrency: Record<string, number>;
  kindMinIntervalMs: Record<string, number>;
  auditLogTtlDays: number;
  auditPruneIntervalMs: number;
  auditPruneBatchSize: number;
};

async function processOneTask(config: WorkerConfig, slot: number): Promise<boolean> {
  const leaseToken = randomUUID();
  const task = await claimNextQueuedTask({
    leaseToken,
    leaseMs: config.leaseMs,
    kindConcurrency: config.kindConcurrency,
    defaultKindConcurrency: config.defaultKindConcurrency,
    kindMinIntervalMs: config.kindMinIntervalMs,
    defaultKindMinIntervalMs: config.defaultKindMinIntervalMs,
  });
  if (!task) return false;
  const startedAt = Date.now();
  logWorker('info', 'task.claimed', config.workerId, {
    slot,
    taskId: task.id,
    traceId: task.trace_id,
    episodeId: task.episode_id,
    shotId: task.shot_id,
    jobKind: task.job_kind,
    attempt: task.attempt_count,
    maxAttempts: task.max_attempts,
  });
  let heartbeatStale = false;
  let heartbeatBusy = false;
  const heartbeatHandle = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void extendTaskLease(task.id, leaseToken, config.leaseMs)
      .then((ok) => {
        if (!ok) {
          heartbeatStale = true;
          clearInterval(heartbeatHandle);
          logWorker('warn', 'task.lease_stale', config.workerId, {
            slot,
            taskId: task.id,
            traceId: task.trace_id,
            attempt: task.attempt_count,
          });
        }
      })
      .catch((error) => {
        logWorker('error', 'task.heartbeat_error', config.workerId, {
          slot,
          taskId: task.id,
          traceId: task.trace_id,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        heartbeatBusy = false;
      });
  }, config.heartbeatMs);
  if (typeof (heartbeatHandle as { unref?: () => void }).unref === 'function') {
    (heartbeatHandle as { unref: () => void }).unref();
  }

  try {
    const result = await executeTask(task);
    const completed = await markTaskCompleted(task.id, leaseToken, result);
    if (!completed) {
      logWorker('warn', 'task.completed_stale', config.workerId, {
        slot,
        taskId: task.id,
        traceId: task.trace_id,
        attempt: task.attempt_count,
        leaseStale: heartbeatStale,
      });
      return true;
    }
    logWorker('info', 'task.completed', config.workerId, {
      slot,
      taskId: task.id,
      traceId: task.trace_id,
      jobKind: task.job_kind,
      durationMs: Date.now() - startedAt,
      attempt: task.attempt_count,
    });
  } catch (error) {
    const normalized = toTaskWorkerError(error, 'Unknown task execution failure', {
      taskId: task.id,
      jobKind: task.job_kind,
      traceId: task.trace_id,
      attempt: task.attempt_count,
      maxAttempts: task.max_attempts,
      slot,
      leaseStale: heartbeatStale,
    });
    const retryable = isRetryableTaskErrorCode(normalized.code);
    const backoffMs = computeBackoffMs(task.attempt_count, config.backoffBaseMs, config.backoffMaxMs);
    const settled = await settleTaskFailure(task.id, {
      leaseToken,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      errorContext: normalized.context,
      retryable,
      backoffMs,
    });
    if (settled.outcome === 'stale') {
      logWorker('warn', 'task.failed_stale', config.workerId, {
        slot,
        taskId: task.id,
        traceId: task.trace_id,
        code: normalized.code,
      });
      return true;
    }
    if (settled.outcome === 'retried') {
      logWorker('warn', 'task.requeued', config.workerId, {
        slot,
        taskId: task.id,
        traceId: task.trace_id,
        code: normalized.code,
        retryable,
        nextAttemptAt: settled.task?.next_attempt_at || null,
        backoffMs,
        durationMs: Date.now() - startedAt,
        attempt: task.attempt_count,
        maxAttempts: task.max_attempts,
        leaseStale: heartbeatStale,
      });
      return true;
    }
    logWorker('error', 'task.failed', config.workerId, {
      slot,
      taskId: task.id,
      traceId: task.trace_id,
      code: normalized.code,
      message: normalized.message,
      retryable,
      deadLettered: settled.deadLettered,
      durationMs: Date.now() - startedAt,
      attempt: task.attempt_count,
      maxAttempts: task.max_attempts,
      leaseStale: heartbeatStale,
    });
  } finally {
    clearInterval(heartbeatHandle);
  }

  return true;
}

async function run() {
  await loadEnvLocal();
  await ensurePhase91Schema();

  const once = process.argv.includes('--once');
  const intervalMs = clampInt(Number(process.env.TASK_WORKER_INTERVAL_MS || 1500), 50, 30_000);
  const leaseMs = clampInt(Number(process.env.TASK_WORKER_LEASE_MS || 600_000), 5_000, 7_200_000);
  const heartbeatMs = clampInt(
    Number(process.env.TASK_WORKER_HEARTBEAT_MS || Math.floor(leaseMs / 3)),
    1_000,
    Math.max(1_000, leaseMs - 500),
  );
  const recoveryIntervalMs = clampInt(Number(process.env.TASK_WORKER_RECOVERY_INTERVAL_MS || intervalMs), 250, 120_000);
  const recoveryBatchSize = clampInt(Number(process.env.TASK_WORKER_RECOVERY_BATCH_SIZE || 50), 1, 500);
  const concurrency = clampInt(Number(process.env.TASK_WORKER_CONCURRENCY || 1), 1, 16);
  const backoffBaseMs = clampInt(Number(process.env.TASK_WORKER_BACKOFF_BASE_MS || 2_000), 100, 60_000);
  const backoffMaxMs = clampInt(Number(process.env.TASK_WORKER_BACKOFF_MAX_MS || 60_000), backoffBaseMs, 3_600_000);
  const defaultKindConcurrency = clampInt(
    Number(process.env.TASK_WORKER_DEFAULT_KIND_CONCURRENCY || concurrency),
    1,
    Math.max(1, concurrency),
  );
  const defaultKindMinIntervalMs = clampInt(Number(process.env.TASK_WORKER_DEFAULT_KIND_RATE_LIMIT_MS || 0), 0, 3_600_000);
  const kindConcurrency = parseIntMapEnv(
    process.env.TASK_WORKER_KIND_CONCURRENCY,
    1,
    Math.max(1, concurrency),
  );
  const kindMinIntervalMs = parseIntMapEnv(process.env.TASK_WORKER_KIND_RATE_LIMIT_MS, 0, 3_600_000);
  const auditLogTtlDays = clampInt(Number(process.env.TASK_AUDIT_LOG_TTL_DAYS || 30), 0, 3650);
  const auditPruneIntervalMs = clampInt(Number(process.env.TASK_AUDIT_PRUNE_INTERVAL_MS || 60_000), 1_000, 3_600_000);
  const auditPruneBatchSize = clampInt(Number(process.env.TASK_AUDIT_PRUNE_BATCH_SIZE || 500), 1, 5000);
  const workerId = process.env.TASK_WORKER_ID?.trim() || `${process.pid}-${randomUUID().slice(0, 8)}`;
  const config: WorkerConfig = {
    workerId,
    leaseMs,
    heartbeatMs,
    recoveryIntervalMs,
    recoveryBatchSize,
    backoffBaseMs,
    backoffMaxMs,
    defaultKindConcurrency,
    defaultKindMinIntervalMs,
    kindConcurrency,
    kindMinIntervalMs,
    auditLogTtlDays,
    auditPruneIntervalMs,
    auditPruneBatchSize,
  };
  let stopped = false;

  const stop = () => {
    stopped = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (once) {
    let handled = 0;
    while (true) {
      const batch = await Promise.all(Array.from({ length: concurrency }, (_value, index) => processOneTask(config, index)));
      const count = batch.filter(Boolean).length;
      if (count === 0) break;
      handled += count;
    }
    logWorker('info', 'worker.once_finished', workerId, { handled, concurrency });
    return;
  }

  logWorker('info', 'worker.started', workerId, {
    intervalMs,
    leaseMs,
    heartbeatMs,
    recoveryIntervalMs,
    recoveryBatchSize,
    concurrency,
    backoffBaseMs,
    backoffMaxMs,
    defaultKindConcurrency,
    defaultKindMinIntervalMs,
    kindConcurrency,
    kindMinIntervalMs,
    auditLogTtlDays,
    auditPruneIntervalMs,
    auditPruneBatchSize,
  });

  const loop = async (slot: number) => {
    while (!stopped) {
      try {
        const handled = await processOneTask(config, slot);
        if (!handled) {
          await sleep(intervalMs);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWorker('error', 'worker.slot_error', workerId, {
          slot,
          message,
        });
        await sleep(intervalMs);
      }
    }
  };

  const recoveryLoop = async () => {
    while (!stopped) {
      try {
        const recovered = await recoverExpiredRunningTasks({
          limit: config.recoveryBatchSize,
          backoffBaseMs: config.backoffBaseMs,
          backoffMaxMs: config.backoffMaxMs,
        });
        if (recovered.processed > 0) {
          logWorker('warn', 'worker.recovered_expired', workerId, {
            processed: recovered.processed,
            requeued: recovered.requeued,
            failed: recovered.failed,
          });
        }
      } catch (error) {
        logWorker('error', 'worker.recovery_error', workerId, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(config.recoveryIntervalMs);
    }
  };

  const auditPruneLoop = async () => {
    if (config.auditLogTtlDays <= 0) {
      logWorker('info', 'worker.audit_prune_disabled', workerId, { auditLogTtlDays: config.auditLogTtlDays });
      return;
    }
    while (!stopped) {
      try {
        const pruned = await pruneTaskAuditLogs({
          olderThanDays: config.auditLogTtlDays,
          limit: config.auditPruneBatchSize,
          actor: 'task-worker',
          reason: 'worker_audit_retention',
        });
        if (pruned.deleted > 0) {
          logWorker('warn', 'worker.audit_pruned', workerId, {
            cutoffAt: pruned.cutoffAt,
            matched: pruned.matched,
            selected: pruned.selected,
            deleted: pruned.deleted,
            sampleIds: pruned.sampleIds,
          });
        }
      } catch (error) {
        logWorker('error', 'worker.audit_prune_error', workerId, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(config.auditPruneIntervalMs);
    }
  };

  await Promise.all([recoveryLoop(), auditPruneLoop(), ...Array.from({ length: concurrency }, (_value, index) => loop(index))]);
  logWorker('info', 'worker.stopped', workerId, { concurrency });
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'worker.fatal', message }));
  process.exitCode = 1;
});
