import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { episodeExists } from '@/lib/repos/episodes';
import { createTask, listTasks } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

const taskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);

const createTaskInput = z.object({
  episodeId: z.string().trim().min(1),
  shotId: z.string().trim().min(1).nullable().optional(),
  type: z.enum(['LLM', 'IMAGE', 'VIDEO', 'EXPORT', 'SYSTEM']),
  jobKind: z.string().trim().min(1).max(120),
  payload: z.record(z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  traceId: z.string().trim().min(1).max(120).optional(),
  idempotencyKey: z.string().trim().min(1).max(120).nullable().optional(),
});

export async function GET(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const episodeId = request.nextUrl.searchParams.get('episodeId') || undefined;
    const statusRaw = request.nextUrl.searchParams.get('status');
    const statusParsed = taskStatusSchema.safeParse(statusRaw);
    if (statusRaw !== null && !statusParsed.success) {
      return jsonError(400, 'INVALID_QUERY', statusParsed.error.issues[0]?.message || 'Invalid status query');
    }
    const status = statusParsed.success ? statusParsed.data : undefined;
    const tasks = await listTasks({ episodeId, status });
    return NextResponse.json({ tasks });
  });
}

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = createTaskInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }
    const input = parsed.data;
    const exists = await episodeExists(input.episodeId);
    if (!exists) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${input.episodeId}`);
    }
    const task = await createTask(input);
    return NextResponse.json({ task }, { status: 201 });
  });
}
