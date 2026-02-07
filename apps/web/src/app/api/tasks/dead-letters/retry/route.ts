import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { bulkRetryDeadLetters, hasRecentTaskAuditAction } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeActor(value: string | undefined): string {
  const trimmed = (value || '').trim();
  return trimmed || 'ops-console';
}

const bulkRetryInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  jobKind: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  deadReason: z.string().trim().min(1).optional(),
  errorCode: z.string().trim().min(1).optional(),
  taskIds: z.array(z.string().trim().min(1)).min(1).max(500).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  actor: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(300).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = bulkRetryInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const dryRun = parsed.data.dryRun === true;
    const actor = normalizeActor(parsed.data.actor);
    const hasTaskIds = Array.isArray(parsed.data.taskIds) && parsed.data.taskIds.length > 0;
    const maxExecuted = clampInt(Number(process.env.TASK_BULK_RETRY_MAX_EXECUTED || 50), 1, 500);
    const rateLimitMs = clampInt(Number(process.env.TASK_BULK_RETRY_RATE_LIMIT_MS || 5_000), 0, 3_600_000);

    if (!dryRun && !hasTaskIds) {
      return jsonError(400, 'DRY_RUN_REQUIRED', 'dryRun must be true unless taskIds is provided');
    }
    if (!dryRun) {
      const desiredLimit = parsed.data.limit ?? (parsed.data.taskIds?.length || 0);
      if (desiredLimit > maxExecuted) {
        return jsonError(400, 'LIMIT_EXCEEDED', `limit must be <= ${maxExecuted} when executing bulk retry`);
      }
      if ((parsed.data.taskIds?.length || 0) > maxExecuted) {
        return jsonError(400, 'TASK_IDS_EXCEEDED', `taskIds length must be <= ${maxExecuted} when executing bulk retry`);
      }
      if (rateLimitMs > 0) {
        const limited = await hasRecentTaskAuditAction({
          actor,
          action: 'TASK_RETRY_BATCH_SUMMARY',
          withinMs: rateLimitMs,
        });
        if (limited) {
          return jsonError(429, 'RATE_LIMITED', `Bulk retry rate limited. Try again later.`);
        }
      }
    }

    const result = await bulkRetryDeadLetters({
      ...parsed.data,
      actor,
    });
    return NextResponse.json({ result });
  });
}
