import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { retryTask } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

type TaskIdContext = {
  params: Promise<{ taskId: string }>;
};

const retryInputSchema = z.object({
  actor: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(300).optional(),
});

export async function POST(request: NextRequest, context: TaskIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const authError = requireRole(request, 'editor');
    if (authError) return authError;
    const parsed = retryInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }
    const { taskId } = await context.params;
    const task = await retryTask(taskId, parsed.data);
    if (!task) {
      return jsonError(404, 'TASK_NOT_RETRIABLE', `Task not found or not retriable: ${taskId}`);
    }
    return NextResponse.json({ task });
  });
}
