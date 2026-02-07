import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { createAsset, listAssetsByEpisode } from '@/lib/repos/assets';
import { episodeExists } from '@/lib/repos/episodes';
import { ensurePhase91Schema } from '@/lib/schema';

const createAssetInput = z.object({
  episodeId: z.string().trim().min(1),
  type: z.enum(['character', 'scene', 'prop']),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  mediaKey: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const episodeId = request.nextUrl.searchParams.get('episodeId');
    if (!episodeId) {
      return jsonError(400, 'EPISODE_ID_REQUIRED', 'episodeId query parameter is required');
    }
    const assets = await listAssetsByEpisode(episodeId);
    return NextResponse.json({ assets });
  });
}

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const authError = requireRole(request, 'editor');
    if (authError) return authError;
    const parsed = createAssetInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const input = parsed.data;
    const exists = await episodeExists(input.episodeId);
    if (!exists) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${input.episodeId}`);
    }
    const asset = await createAsset(input);
    return NextResponse.json({ asset }, { status: 201 });
  });
}
