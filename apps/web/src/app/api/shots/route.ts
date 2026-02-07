import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { episodeExists } from '@/lib/repos/episodes';
import { createShot, listShotsByEpisode } from '@/lib/repos/shots';
import { ensurePhase91Schema } from '@/lib/schema';

const createShotInput = z.object({
  episodeId: z.string().trim().min(1),
  orderIndex: z.number().int().nonnegative().optional(),
  originalText: z.string().optional(),
  visualTranslation: z.string().optional(),
});

export async function GET(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const episodeId = request.nextUrl.searchParams.get('episodeId');
    if (!episodeId) {
      return jsonError(400, 'EPISODE_ID_REQUIRED', 'episodeId query parameter is required');
    }
    const shots = await listShotsByEpisode(episodeId);
    return NextResponse.json({ shots });
  });
}

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = createShotInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const input = parsed.data;
    const exists = await episodeExists(input.episodeId);
    if (!exists) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${input.episodeId}`);
    }
    const shot = await createShot(input);
    return NextResponse.json({ shot }, { status: 201 });
  });
}
