import { NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { getTaskById } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

type TaskIdContext = {
  params: Promise<{ taskId: string }>;
};

export async function GET(_request: NextRequest, context: TaskIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const { taskId } = await context.params;
    const task = await getTaskById(taskId);
    if (!task) {
      return jsonError(404, 'TASK_NOT_FOUND', `Task not found: ${taskId}`);
    }
    return NextResponse.json({ task });
  });
}
