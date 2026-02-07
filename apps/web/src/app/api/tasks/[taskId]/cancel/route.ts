import { NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { cancelTask } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

type TaskIdContext = {
  params: Promise<{ taskId: string }>;
};

export async function POST(_request: NextRequest, context: TaskIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const { taskId } = await context.params;
    const task = await cancelTask(taskId);
    if (!task) {
      return jsonError(404, 'TASK_NOT_CANCELLABLE', `Task not found or not cancellable: ${taskId}`);
    }
    return NextResponse.json({ task });
  });
}
