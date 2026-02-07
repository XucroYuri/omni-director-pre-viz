import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runApi, readJsonBody } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { createEpisode, listEpisodes } from '@/lib/repos/episodes';
import { ensurePhase91Schema } from '@/lib/schema';

const createEpisodeInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function GET() {
  return runApi(async () => {
    await ensurePhase91Schema();
    const episodes = await listEpisodes();
    return NextResponse.json({ episodes });
  });
}

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const authError = requireRole(request, 'editor');
    if (authError) return authError;
    const parsed = createEpisodeInput.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }
    const episode = await createEpisode(parsed.data.title);
    return NextResponse.json({ episode }, { status: 201 });
  });
}
