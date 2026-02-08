import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { episodeExists } from '@/lib/repos/episodes';
import { createTask } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

type EpisodeIdContext = {
  params: Promise<{ episodeId: string }>;
};

const breakdownInput = z.object({
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: NextRequest, context: EpisodeIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = breakdownInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const { episodeId } = await context.params;
    const exists = await episodeExists(episodeId);
    if (!exists) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${episodeId}`);
    }

    const task = await createTask({
      episodeId,
      shotId: null,
      type: 'LLM',
      jobKind: 'EPISODE_BREAKDOWN_SCRIPT',
      payload: {},
      idempotencyKey: parsed.data.idempotencyKey ?? episodeId,
    });
    return NextResponse.json({ task }, { status: 201 });
  });
}
