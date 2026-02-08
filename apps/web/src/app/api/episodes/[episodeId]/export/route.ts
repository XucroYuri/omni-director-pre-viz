import { NextRequest, NextResponse } from 'next/server';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { runApi } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { createS3MediaStore } from '@/lib/media';
import { getEpisodeById } from '@/lib/repos/episodes';
import { listAssetsByEpisode } from '@/lib/repos/assets';
import { listShotsByEpisode } from '@/lib/repos/shots';
import { ensurePhase91Schema } from '@/lib/schema';

type EpisodeIdContext = {
  params: Promise<{ episodeId: string }>;
};

export async function GET(request: NextRequest, context: EpisodeIdContext) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const authError = requireRole(request, 'viewer');
    if (authError) return authError;
    const { episodeId } = await context.params;
    const episode = await getEpisodeById(episodeId);
    if (!episode) {
      return jsonError(404, 'EPISODE_NOT_FOUND', `Episode not found: ${episodeId}`);
    }
    const [shots, assets] = await Promise.all([listShotsByEpisode(episodeId), listAssetsByEpisode(episodeId)]);
    const manifest = {
      exportedAt: new Date().toISOString(),
      episode,
      shots: shots.map((shot) => ({
        id: shot.id,
        orderIndex: shot.order_index,
        originalText: shot.original_text,
        visualTranslation: shot.visual_translation,
        status: shot.status,
        matrixPrompts: shot.matrix_prompts_json,
        matrixImageKey: shot.matrix_image_key,
        splitImageKeys: shot.split_image_keys_json,
      })),
      assets,
    };

    const store = createS3MediaStore();
    const archive = archiver('zip', { zlib: { level: 9 } });
    const out = new PassThrough();
    const chunks: Buffer[] = [];

    const finished = new Promise<void>((resolve, reject) => {
      out.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      out.on('end', () => resolve());
      out.on('error', reject);
      archive.on('warning', (err) => {
        if ((err as { code?: string }).code === 'ENOENT') return;
        reject(err);
      });
      archive.on('error', reject);
    });

    archive.pipe(out);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    for (const shot of shots) {
      const base = `shots/${String(shot.order_index).padStart(3, '0')}-${shot.id}`;
      if (shot.matrix_image_key) {
        const obj = await store.get(shot.matrix_image_key);
        if (obj) {
          archive.append(obj.bytes, { name: `${base}/matrix/mother.png` });
        }
      }
      const split = Array.isArray(shot.split_image_keys_json) ? shot.split_image_keys_json : [];
      for (let i = 0; i < split.length; i += 1) {
        const key = split[i];
        if (typeof key !== 'string' || !key.trim()) continue;
        const obj = await store.get(key);
        if (obj) {
          archive.append(obj.bytes, { name: `${base}/matrix/split/${i + 1}.png` });
        }
      }
    }

    await archive.finalize();
    await finished;
    const zip = Buffer.concat(chunks);

    return new NextResponse(zip, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="episode-${episodeId}.zip"`,
      },
    });
  });
}
