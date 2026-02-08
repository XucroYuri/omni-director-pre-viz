import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { getShotById } from '@/lib/repos/shots';
import { createTask } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

type ShotIdContext = {
  params: Promise<{ shotId: string }>;
};

const matrixInput = z.object({
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: NextRequest, context: ShotIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = matrixInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }
    const { shotId } = await context.params;
    const shot = await getShotById(shotId);
    if (!shot) {
      return jsonError(404, 'SHOT_NOT_FOUND', `Shot not found: ${shotId}`);
    }

    const task = await createTask({
      episodeId: shot.episode_id,
      shotId,
      type: 'IMAGE',
      jobKind: 'SHOT_MATRIX_RENDER',
      payload: {},
      idempotencyKey: parsed.data.idempotencyKey ?? shotId,
    });
    return NextResponse.json({ task }, { status: 201 });
  });
}
