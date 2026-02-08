import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { episodeExists, getEpisodeById, updateEpisodeScript } from '@/lib/repos/episodes';
import { ensurePhase91Schema } from '@/lib/schema';

type EpisodeIdContext = {
  params: Promise<{ episodeId: string }>;
};

const updateEpisodeInput = z.object({
  script: z.string().max(200_000).optional(),
  context: z.string().max(200_000).optional(),
});

export async function GET(_request: NextRequest, context: EpisodeIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const { episodeId } = await context.params;
    const episode = await getEpisodeById(episodeId);
    if (!episode) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${episodeId}`);
    }
    return NextResponse.json({ episode });
  });
}

export async function PATCH(request: NextRequest, context: EpisodeIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = updateEpisodeInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }
    const { episodeId } = await context.params;
    const exists = await episodeExists(episodeId);
    if (!exists) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${episodeId}`);
    }

    const next = await updateEpisodeScript({
      episodeId,
      script: parsed.data.script ?? '',
      context: parsed.data.context ?? '',
    });
    if (!next) {
      return jsonError(500, 'UPDATE_FAILED', 'Failed to update episode');
    }
    return NextResponse.json({ episode: next });
  });
}
