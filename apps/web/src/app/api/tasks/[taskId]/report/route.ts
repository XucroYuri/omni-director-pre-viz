import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { updateTaskReport } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

type TaskIdContext = {
  params: Promise<{ taskId: string }>;
};

const reportInputSchema = z.object({
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().min(0).max(1).nullable().optional(),
  result: z.record(z.unknown()).optional(),
  errorCode: z.string().trim().min(1).max(120).nullable().optional(),
  errorMessage: z.string().trim().min(1).max(2000).nullable().optional(),
  errorContext: z.record(z.unknown()).nullable().optional(),
});

export async function POST(request: NextRequest, context: TaskIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = reportInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const { taskId } = await context.params;
    const task = await updateTaskReport(taskId, parsed.data);
    if (!task) {
      return jsonError(404, 'TASK_NOT_FOUND', `Task not found: ${taskId}`);
    }
    return NextResponse.json({ task });
  });
}
