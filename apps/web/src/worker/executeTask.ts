import type { TaskRecord } from '../lib/models';
import { episodeExists, getEpisodeSummary } from '../lib/repos/episodes';
import { getShotById, updateShotStatus, type ShotStatusValue } from '../lib/repos/shots';
import { TaskWorkerError } from '../lib/taskErrors';

type TaskPayload = Record<string, unknown>;

const SHOT_STATUS_VALUES: ShotStatusValue[] = ['pending', 'processing', 'completed', 'failed'];

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(code: TaskWorkerError['code'], message: string, context?: Record<string, unknown>): never {
  throw new TaskWorkerError(code, message, context);
}

function assert(
  condition: unknown,
  code: TaskWorkerError['code'],
  message: string,
  context?: Record<string, unknown>,
): asserts condition {
  if (!condition) fail(code, message, context);
}

function parsePayload(task: TaskRecord): TaskPayload {
  if (isRecord(task.payload_json)) return task.payload_json;
  fail('TASK_PAYLOAD_INVALID', 'payload_json must be an object', { taskId: task.id, jobKind: task.job_kind });
}

export async function executeTask(task: TaskRecord): Promise<Record<string, unknown>> {
  const payload = parsePayload(task);

  switch (task.job_kind) {
    case 'SYSTEM_HEALTH_CHECK': {
      return {
        ok: true,
        worker: 'phase9.2',
        timestamp: new Date().toISOString(),
      };
    }

    case 'EPISODE_SUMMARY': {
      const episodeId = hasNonEmptyString(payload.episodeId) ? payload.episodeId : task.episode_id;
      assert(hasNonEmptyString(episodeId), 'TASK_PAYLOAD_MISSING', 'episodeId is required', { taskId: task.id });
      const exists = await episodeExists(episodeId);
      assert(exists, 'TASK_ENTITY_NOT_FOUND', `Episode not found: ${episodeId}`, { taskId: task.id, episodeId });
      const summary = await getEpisodeSummary(episodeId);
      return {
        episode: summary,
      };
    }

    case 'SHOT_SET_STATUS': {
      assert(hasNonEmptyString(task.shot_id), 'TASK_PAYLOAD_MISSING', 'shot_id is required for SHOT_SET_STATUS', {
        taskId: task.id,
      });
      const nextStatus = payload.status;
      assert(
        typeof nextStatus === 'string' && SHOT_STATUS_VALUES.includes(nextStatus as ShotStatusValue),
        'TASK_PAYLOAD_INVALID',
        `status must be one of ${SHOT_STATUS_VALUES.join(', ')}`,
        { taskId: task.id, status: nextStatus },
      );
      const shot = await getShotById(task.shot_id);
      assert(shot, 'TASK_ENTITY_NOT_FOUND', `Shot not found: ${task.shot_id}`, { taskId: task.id, shotId: task.shot_id });
      const updated = await updateShotStatus(task.shot_id, nextStatus as ShotStatusValue);
      assert(updated, 'TASK_EXECUTION_FAILED', `Failed to update shot status: ${task.shot_id}`, {
        taskId: task.id,
        shotId: task.shot_id,
      });
      return {
        shotId: updated.id,
        status: updated.status,
      };
    }

    case 'NOOP': {
      return {
        ok: true,
        payload,
      };
    }

    case 'SYSTEM_SLEEP': {
      const ms = payload.ms;
      assert(
        typeof ms === 'number' && Number.isFinite(ms) && ms >= 1 && ms <= 120_000,
        'TASK_PAYLOAD_INVALID',
        'SYSTEM_SLEEP payload.ms must be number in [1, 120000]',
        { taskId: task.id, ms },
      );
      await sleep(Math.round(ms));
      return {
        ok: true,
        sleptMs: Math.round(ms),
      };
    }

    case 'SYSTEM_FAIL_ALWAYS': {
      fail('TASK_EXECUTION_FAILED', 'Forced failure for retry/dead-letter validation', {
        taskId: task.id,
      });
    }

    default:
      fail('TASK_PAYLOAD_UNSUPPORTED', `Unsupported jobKind: ${task.job_kind}`, {
        taskId: task.id,
        jobKind: task.job_kind,
      });
  }
}
