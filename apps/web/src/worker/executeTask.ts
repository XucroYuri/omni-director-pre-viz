import type { TaskRecord } from '../lib/models';
import { episodeExists, getEpisodeById, getEpisodeSummary } from '../lib/repos/episodes';
import {
  getShotById,
  updateShotMatrixArtifacts,
  updateShotStatus,
  type ShotStatusValue,
} from '../lib/repos/shots';
import { ensureEpisodeBreakdown } from '../lib/repos/tasks';
import { TaskWorkerError } from '../lib/taskErrors';
import { createS3MediaStore, type MediaStore } from '../lib/media';

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

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function splitScriptToShots(script: string): Array<{ originalText: string; visualTranslation: string }> {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const limited = lines.slice(0, 500);
  return limited.map((line) => ({ originalText: line, visualTranslation: '' }));
}

function buildMatrixPrompts(shot: { original_text: string; visual_translation: string }): string[] {
  const base = (shot.visual_translation || shot.original_text || '').trim() || 'Shot';
  const prompts: string[] = [];
  for (let i = 1; i <= 9; i += 1) {
    prompts.push(`(${i}/9) ${base}`);
  }
  return prompts;
}

async function renderMatrixPng(input: { title: string; prompts: string[] }): Promise<Buffer> {
  // Lazy import to keep worker startup light.
  const { default: sharp } = await import('sharp');

  const cell = 512;
  const cols = 3;
  const rows = 3;
  const width = cell * cols;
  const height = cell * rows;
  const palette = ['#0f172a', '#1f2937', '#334155', '#0b3b5a', '#0f4c5c', '#0a4a3f', '#1b4332', '#4a3f1a', '#5a1a0f'];
  const title = input.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const blocks = input.prompts
    .slice(0, 9)
    .map((prompt, i) => {
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      const bg = palette[i % palette.length];
      const text = String(prompt || '')
        .slice(0, 140)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `
        <g>
          <rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${bg}" />
          <rect x="${x + 12}" y="${y + 12}" width="${cell - 24}" height="${cell - 24}" fill="rgba(255,255,255,0.06)" />
          <text x="${x + 28}" y="${y + 64}" fill="rgba(255,255,255,0.9)" font-size="26" font-family="ui-monospace, Menlo, Monaco, monospace">
            <tspan>${text}</tspan>
          </text>
        </g>
      `;
    })
    .join('\n');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#0b1220" />
      ${blocks}
      <g>
        <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="6" />
        <line x1="${cell}" y1="0" x2="${cell}" y2="${height}" stroke="rgba(255,255,255,0.18)" stroke-width="4" />
        <line x1="${cell * 2}" y1="0" x2="${cell * 2}" y2="${height}" stroke="rgba(255,255,255,0.18)" stroke-width="4" />
        <line x1="0" y1="${cell}" x2="${width}" y2="${cell}" stroke="rgba(255,255,255,0.18)" stroke-width="4" />
        <line x1="0" y1="${cell * 2}" x2="${width}" y2="${cell * 2}" stroke="rgba(255,255,255,0.18)" stroke-width="4" />
        <text x="32" y="40" fill="rgba(255,255,255,0.75)" font-size="18" font-family="ui-monospace, Menlo, Monaco, monospace">${title}</text>
      </g>
    </svg>
  `.trim();

  return sharp(Buffer.from(svg)).png().toBuffer();
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

    case 'EPISODE_BREAKDOWN_SCRIPT': {
      const episodeId = parseOptionalString(payload.episodeId) || task.episode_id;
      assert(hasNonEmptyString(episodeId), 'TASK_PAYLOAD_MISSING', 'episodeId is required', { taskId: task.id });
      const episode = await getEpisodeById(episodeId);
      assert(episode, 'TASK_ENTITY_NOT_FOUND', `Episode not found: ${episodeId}`, { taskId: task.id, episodeId });
      assert(hasNonEmptyString(episode.script), 'TASK_PRECONDITION_FAILED', 'episode.script must be set before breakdown', {
        taskId: task.id,
        episodeId,
      });

      const shotInputs = splitScriptToShots(episode.script);
      assert(shotInputs.length > 0, 'TASK_PRECONDITION_FAILED', 'no shots found in script', { taskId: task.id, episodeId });
      const ensured = await ensureEpisodeBreakdown({
        episodeId,
        traceId: task.trace_id,
        shots: shotInputs.map((input, index) => ({
          orderIndex: index + 1,
          originalText: input.originalText,
          visualTranslation: input.visualTranslation,
        })),
      });

      return {
        episodeId,
        shotCount: ensured.shotIds.length,
        shotIds: ensured.shotIds,
        matrixTaskIds: ensured.matrixTaskIds,
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

    case 'SHOT_MATRIX_RENDER': {
      const shotId = parseOptionalString(payload.shotId) || task.shot_id;
      assert(hasNonEmptyString(shotId), 'TASK_PAYLOAD_MISSING', 'shotId is required', { taskId: task.id });
      const shot = await getShotById(shotId);
      assert(shot, 'TASK_ENTITY_NOT_FOUND', `Shot not found: ${shotId}`, { taskId: task.id, shotId });

      if (shot.matrix_image_key) {
        return {
          shotId,
          skipped: true,
          reason: 'already_rendered',
          matrixImageKey: shot.matrix_image_key,
          splitImageKeys: shot.split_image_keys_json,
        };
      }
      await updateShotStatus(shotId, 'processing');

      const prompts = buildMatrixPrompts(shot);
      let png: Buffer;
      try {
        png = await renderMatrixPng({
          title: `episode=${shot.episode_id} shot=${shotId}`,
          prompts,
        });
      } catch (error) {
        fail(
          'TASK_PRECONDITION_FAILED',
          `Matrix rendering requires sharp to be installed: ${error instanceof Error ? error.message : String(error)}`,
          { taskId: task.id, shotId },
        );
      }

      let store: MediaStore;
      try {
        store = createS3MediaStore();
      } catch (error) {
        fail(
          'TASK_PRECONDITION_FAILED',
          `Media store misconfigured: ${error instanceof Error ? error.message : String(error)}`,
          { taskId: task.id, shotId },
        );
      }
      const motherKey = `episodes/${shot.episode_id}/shots/${shotId}/matrix/mother.png`;
      await store.put({ key: motherKey, bytes: png, contentType: 'image/png' });

      const { default: sharp } = await import('sharp');
      const splitKeys: string[] = [];
      const cell = 512;
      for (let i = 0; i < 9; i += 1) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const crop = await sharp(png)
          .extract({ left: col * cell, top: row * cell, width: cell, height: cell })
          .png()
          .toBuffer();
        const key = `episodes/${shot.episode_id}/shots/${shotId}/matrix/split/${i + 1}.png`;
        await store.put({ key, bytes: crop, contentType: 'image/png' });
        splitKeys.push(key);
      }

      const updated = await updateShotMatrixArtifacts({
        shotId,
        status: 'completed',
        matrixPrompts: prompts,
        matrixImageKey: motherKey,
        splitImageKeys: splitKeys,
      });
      assert(updated, 'TASK_EXECUTION_FAILED', 'Failed to update shot matrix artifacts', { taskId: task.id, shotId });

      return {
        shotId,
        matrixImageKey: motherKey,
        splitImageKeys: splitKeys,
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
