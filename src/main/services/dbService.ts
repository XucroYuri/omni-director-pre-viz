import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { episodeRepo, type DBEpisode } from '../db/repos/episodeRepo';
import { shotRepo, type DBShot } from '../db/repos/shotRepo';
import { assetRepo, type DBAsset } from '../db/repos/assetRepo';
import type { EpisodeData, Shot, Character, Scene, Prop } from '../../shared/types';

// Helper to parse JSON safely
function parseJson<T>(jsonStr: string | null, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    console.warn('JSON Parse Error:', e);
    return fallback;
  }
}

// Helper to stringify JSON safely
function stringifyJson(obj: any): string {
  return JSON.stringify(obj ?? null);
}

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  return { mimeType: match[1], base64: match[2] };
}

function extFromMime(mimeType: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'video/mp4') return '.mp4';
  return '';
}

function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
}

function getMediaRoot() {
  return process.env.OMNI_OUTPUT_DIR?.trim() || path.join(app.getPath('userData'), 'output');
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

async function ensureDirForFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeDataUriFile(dataUri: string, relativeBase: string) {
  const { mimeType, base64 } = parseDataUri(dataUri);
  const ext = extFromMime(mimeType);
  const relativePath = `${relativeBase}${ext}`;
  const absPath = path.join(getMediaRoot(), relativePath);
  await ensureDirForFile(absPath);
  await fs.writeFile(absPath, Buffer.from(base64, 'base64'));
  return relativePath;
}

async function copyFileTo(relativePath: string, sourcePath: string) {
  const absPath = path.join(getMediaRoot(), relativePath);
  await ensureDirForFile(absPath);
  await fs.copyFile(sourcePath, absPath);
  return relativePath;
}

async function persistMedia(value: string | undefined, relativeBase: string) {
  if (!value) return null;
  if (value.startsWith('data:')) {
    return writeDataUriFile(value, relativeBase);
  }
  if (value.startsWith('file://')) {
    const srcPath = value.replace('file://', '');
    const ext = path.extname(srcPath);
    return copyFileTo(`${relativeBase}${ext}`, srcPath);
  }
  if (!value.includes('://')) {
    return value;
  }
  return null;
}

async function readMedia(relativePath: string | null) {
  if (!relativePath) return undefined;
  if (relativePath.startsWith('data:')) return relativePath;
  const resolvedPath = relativePath.startsWith('file://')
    ? relativePath.replace('file://', '')
    : path.join(getMediaRoot(), relativePath);
  try {
    const buf = await fs.readFile(resolvedPath);
    const mimeType = mimeFromPath(resolvedPath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export const dbService = {
  // --- Episode Operations ---

  async saveEpisodeFull(data: EpisodeData): Promise<void> {
    const now = Date.now();

    // 1. Save Episode Meta
    const baseConfig = {
      artStyle: data.config.artStyle,
      aspectRatio: data.config.aspectRatio,
      resolution: data.config.resolution,
      apiProvider: data.config.apiProvider,
    };

    const episode: DBEpisode = {
      id: data.episodeId,
      title: 'Untitled Episode', // Todo: Add title field in frontend
      script: null,
      context: null,
      config_json: stringifyJson(baseConfig),
      tags_json: null,
      created_at: now, // Should query existing created_at if update, but simplified for now
      updated_at: now,
    };
    
    // Check if exists to preserve created_at
    const existing = episodeRepo.get(data.episodeId);
    if (existing) {
      episode.created_at = existing.created_at;
      episodeRepo.update(episode);
    } else {
      episodeRepo.create(episode);
    }

    // 2. Save Assets
    // We assume asset IDs are globally unique or at least unique per episode
    const allAssets = [
      ...data.assets.characters.map(c => ({ ...c, type: 'character' })),
      ...data.assets.scenes.map(s => ({ ...s, type: 'scene' })),
      ...data.assets.props.map(p => ({ ...p, type: 'prop' }))
    ];

    for (const asset of allAssets) {
      const assetBase = path.join('episodes', data.episodeId, 'assets', asset.id);
      const refImagePath = await persistMedia(asset.refImage, assetBase);

      const dbAsset: DBAsset = {
        id: asset.id,
        episode_id: data.episodeId,
        type: asset.type,
        name: asset.name,
        description: asset.description,
        ref_image_path: refImagePath,
        tags_json: stringifyJson(asset.tags || []),
        created_at: now,
        updated_at: now
      };
      
      // Upsert logic for assets (simplified: delete then insert, or check exist)
      // Since better-sqlite3 is sync and fast, we can just use upsert logic if we had it,
      // or check existence. For assets, we'll try update, if 0 changes then create.
      // Actually assetRepo doesn't have upsert yet, let's just do a simple check.
      // Ideally we should add upsert to assetRepo, but let's stick to current repo API.
      // Wait, assetRepo has create/update/delete.
      // Let's implement a simple check.
      // A better way for batch save is: delete all assets for episode -> insert all. 
      // BUT that breaks foreign keys if we had them strict. 
      // Let's do check-and-write.
      
      // To save perf, we might assume UI sends all assets. 
      // Let's rely on `INSERT OR REPLACE` logic if we modify repo, 
      // but strictly following Repo API:
      // (For this MVP, we will rely on frontend IDs stability)
      try {
        assetRepo.create(dbAsset);
      } catch (e: any) {
        if (e.message.includes('UNIQUE constraint failed')) {
            assetRepo.update(dbAsset);
        } else {
            throw e;
        }
      }
    }

    // 3. Save Shots
    for (const [index, shot] of data.shots.entries()) {
      const shotBase = path.join('episodes', data.episodeId, 'shots', shot.id);
      const matrixPath = await persistMedia(shot.generatedImageUrl, path.join(shotBase, 'matrix'));
      const splitPaths: (string | null)[] = [];
      if (shot.splitImages && shot.splitImages.length > 0) {
        for (let i = 0; i < shot.splitImages.length; i += 1) {
          const relativeBase = path.join(shotBase, `angle_${pad2(i + 1)}`);
          splitPaths.push(await persistMedia(shot.splitImages[i], relativeBase));
        }
      }
      const videoPaths: (string | null)[] = [];
      if (shot.videoUrls && shot.videoUrls.length > 0) {
        for (let i = 0; i < shot.videoUrls.length; i += 1) {
          const relativeBase = path.join(shotBase, 'videos', `angle_${pad2(i + 1)}`);
          videoPaths.push(await persistMedia(shot.videoUrls[i] || undefined, relativeBase));
        }
      }
      const animaticPath = await persistMedia(shot.animaticVideoUrl, path.join(shotBase, 'videos', 'animatic'));
      const assetVideoPath = await persistMedia(shot.assetVideoUrl, path.join(shotBase, 'videos', 'asset'));

      const dbShot: DBShot = {
        id: shot.id,
        episode_id: data.episodeId,
        order_index: index,
        original_text: shot.originalText,
        visual_translation: shot.visualTranslation,
        context_tag: shot.contextTag,
        shot_kind: shot.shotKind || null,
        matrix_prompts_json: stringifyJson(shot.matrixPrompts),
        generated_image_path: matrixPath,
        split_images_json: stringifyJson(splitPaths),
        video_urls_json: stringifyJson(videoPaths),
        animatic_video_path: animaticPath,
        asset_video_path: assetVideoPath,
        status: shot.status,
        video_status_json: stringifyJson(shot.videoStatus),
        progress: shot.progress || 0,
        history_json: stringifyJson(shot.history),
        optimization_json: stringifyJson(shot.optimization),
        character_ids_json: stringifyJson(shot.characterIds),
        scene_ids_json: stringifyJson(shot.sceneIds),
        prop_ids_json: stringifyJson(shot.propIds),
        linked_shot_ids_json: stringifyJson(shot.linkedShotIds),
        last_accessed_at: shot.lastAccessedAt || now,
        created_at: now, // Should preserve if exists
        updated_at: now
      };

      shotRepo.upsert(dbShot);
    }
  },

  async loadEpisode(episodeId: string): Promise<EpisodeData | null> {
    const ep = episodeRepo.get(episodeId);
    if (!ep) return null;

    const dbAssets = assetRepo.getByEpisodeId(episodeId);
    const dbShots = shotRepo.getByEpisodeId(episodeId);

    // Transform Assets
    const characters: Character[] = [];
    const scenes: Scene[] = [];
    const props: Prop[] = [];

    for (const a of dbAssets) {
      const assetObj = {
        id: a.id,
        name: a.name,
        description: a.description || '',
        refImage: await readMedia(a.ref_image_path),
        tags: parseJson<string[]>(a.tags_json, [])
      };
      if (a.type === 'character') characters.push(assetObj);
      else if (a.type === 'scene') scenes.push(assetObj);
      else if (a.type === 'prop') props.push(assetObj);
    }

    // Transform Shots
    const shots: Shot[] = await Promise.all(
      dbShots.map(async (s) => {
        const splitPaths = parseJson<string[]>(s.split_images_json, []);
        const splitImages = await Promise.all(splitPaths.map((p) => readMedia(p)));
        const videoPaths = parseJson<(string | null)[]>(s.video_urls_json, []);
        const videoUrls = await Promise.all(videoPaths.map((p) => readMedia(p)));

        return {
          id: s.id,
          originalText: s.original_text || '',
          visualTranslation: s.visual_translation || '',
          contextTag: s.context_tag || '',
          shotKind: (s.shot_kind as any) || undefined,
          matrixPrompts: parseJson(s.matrix_prompts_json, []),
          generatedImageUrl: await readMedia(s.generated_image_path),
          splitImages,
          videoUrls,
          animaticVideoUrl: await readMedia(s.animatic_video_path),
          assetVideoUrl: await readMedia(s.asset_video_path),
          status: (s.status as any) || 'pending',
          videoStatus: parseJson(s.video_status_json, []),
          progress: s.progress || 0,
          history: parseJson(s.history_json, []),
          optimization: parseJson(s.optimization_json, undefined),
          characterIds: parseJson(s.character_ids_json, []),
          sceneIds: parseJson(s.scene_ids_json, []),
          propIds: parseJson(s.prop_ids_json, []),
          linkedShotIds: parseJson(s.linked_shot_ids_json, []),
          lastAccessedAt: s.last_accessed_at || undefined,
        };
      }),
    );

    return {
      episodeId: ep.id,
      config: {
        ...parseJson(ep.config_json, {
          artStyle: '',
          aspectRatio: '16:9',
          resolution: '2K',
          apiProvider: 'aihubmix',
        }),
        characters,
        scenes,
        props,
      },
      shots,
      assets: { characters, scenes, props },
    };
  }
};
