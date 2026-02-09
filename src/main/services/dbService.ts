import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { episodeRepo, type DBEpisode } from '../db/repos/episodeRepo';
import { projectRepo, type DBProject } from '../db/repos/projectRepo';
import { shotRepo, type DBShot } from '../db/repos/shotRepo';
import { assetRepo, type DBAsset } from '../db/repos/assetRepo';
import type {
  EpisodeData,
  EpisodeSummary,
  ProjectSummary,
  Shot,
  Character,
  Scene,
  Prop,
  ShotHistoryItem,
} from '../../shared/types';
import {
  ensurePromptListLength,
  getGridCellCount,
  normalizeGridLayout,
  normalizeIndexedList,
  parseMatrixPromptPayload,
  serializeMatrixPromptPayload,
} from '../../shared/utils';
import { keyFromPath, resolveUrlToPath, urlFromPath, readFileAsDataUri } from './mediaService';

const DEFAULT_PROJECT_ID = 'project_default';
const DEFAULT_PROJECT_NAME = '默认项目';

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
  if (value.startsWith('omni-media://')) {
    const srcPath = resolveUrlToPath(value);
    try {
      return keyFromPath(srcPath);
    } catch {
      const ext = path.extname(srcPath);
      return copyFileTo(`${relativeBase}${ext}`, srcPath);
    }
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

async function readMediaUrl(storedPath: string | null) {
  if (!storedPath) return undefined;
  if (storedPath.startsWith('omni-media://')) return storedPath;
  if (storedPath.startsWith('data:')) {
    const hash = createHash('sha1').update(storedPath).digest('hex').slice(0, 12);
    const relativePath = await writeDataUriFile(storedPath, path.join('legacy', 'inline', hash));
    const absPath = path.join(getMediaRoot(), relativePath);
    return urlFromPath(absPath);
  }
  const resolvedPath = storedPath.startsWith('file://')
    ? storedPath.replace('file://', '')
    : path.isAbsolute(storedPath)
      ? storedPath
      : path.join(getMediaRoot(), storedPath);
  try {
    await fs.stat(resolvedPath);
    return urlFromPath(resolvedPath);
  } catch {
    return undefined;
  }
}

async function readMediaDataUri(storedPath: string | null) {
  if (!storedPath) return undefined;
  if (storedPath.startsWith('data:')) return storedPath;
  const resolvedPath = storedPath.startsWith('omni-media://')
    ? resolveUrlToPath(storedPath)
    : storedPath.startsWith('file://')
      ? storedPath.replace('file://', '')
      : path.isAbsolute(storedPath)
        ? storedPath
        : path.join(getMediaRoot(), storedPath);
  try {
    return await readFileAsDataUri(resolvedPath);
  } catch {
    return undefined;
  }
}

async function hydrateHistoryEntries(
  rawEntries: ShotHistoryItem[],
  mediaFormat: 'url' | 'dataUri',
  fallbackLayout?: Shot['gridLayout'],
): Promise<ShotHistoryItem[]> {
  const resolveMedia = mediaFormat === 'dataUri' ? readMediaDataUri : readMediaUrl;
  return Promise.all(
    rawEntries.map(async (entry) => {
      const gridLayout = normalizeGridLayout(entry.gridLayout, normalizeGridLayout(fallbackLayout));
      const cellCount = getGridCellCount(gridLayout);
      const imageUrl = (await resolveMedia(entry.imageUrl || null)) || entry.imageUrl;
      const splitImages = await Promise.all(
        normalizeIndexedList<string>(entry.splitImages as string[] | undefined, cellCount, '').map(async (item) => {
          if (!item) return '';
          return (await resolveMedia(item)) || '';
        }),
      );
      const videoUrls = await Promise.all(
        normalizeIndexedList<string | null>(entry.videoUrls, cellCount, null).map(async (item) => {
          if (!item) return null;
          return (await resolveMedia(item)) || null;
        }),
      );
      return {
        ...entry,
        imageUrl: imageUrl || '',
        gridLayout,
        prompts: ensurePromptListLength(entry.prompts, gridLayout),
        splitImages,
        videoUrls,
      };
    }),
  );
}

export const dbService = {
  // --- Episode Operations ---

  ensureDefaultProject(): DBProject {
    const existing = projectRepo.get(DEFAULT_PROJECT_ID);
    if (existing) return existing;
    const now = Date.now();
    const created: DBProject = {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      description: '自动创建的默认项目',
      created_at: now,
      updated_at: now,
    };
    projectRepo.create(created);
    return created;
  },

  listProjects(): ProjectSummary[] {
    const defaultProject = this.ensureDefaultProject();
    const allProjects = projectRepo.getAll();
    const projectMap = new Map<string, DBProject>();
    for (const project of allProjects) {
      projectMap.set(project.id, project);
    }
    if (!projectMap.has(defaultProject.id)) {
      projectMap.set(defaultProject.id, defaultProject);
    }

    const episodes = episodeRepo.getAll();
    const episodesByProject = new Map<string, EpisodeSummary[]>();
    for (const ep of episodes) {
      const projectId = ep.project_id || defaultProject.id;
      if (!projectMap.has(projectId)) continue;
      const shots = shotRepo.getByEpisodeId(ep.id);
      const summary: EpisodeSummary = {
        episodeId: ep.id,
        projectId,
        episodeNo: ep.episode_no || 1,
        title: ep.title || `第 ${ep.episode_no || 1} 集`,
        updatedAt: ep.updated_at,
        shotCount: shots.length,
      };
      const list = episodesByProject.get(projectId) || [];
      list.push(summary);
      episodesByProject.set(projectId, list);
    }

    const projects: ProjectSummary[] = Array.from(projectMap.values()).map((project) => {
      const episodesInProject = (episodesByProject.get(project.id) || []).sort((a, b) =>
        a.episodeNo === b.episodeNo ? b.updatedAt - a.updatedAt : a.episodeNo - b.episodeNo,
      );
      return {
        projectId: project.id,
        name: project.name,
        description: project.description || undefined,
        updatedAt: project.updated_at,
        episodes: episodesInProject,
      };
    });

    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  createProject(input: { name: string; description?: string }): ProjectSummary {
    const now = Date.now();
    const id = `prj_${randomUUID()}`;
    const project: DBProject = {
      id,
      name: input.name.trim() || '未命名项目',
      description: input.description?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    projectRepo.create(project);
    return {
      projectId: project.id,
      name: project.name,
      description: project.description || undefined,
      updatedAt: project.updated_at,
      episodes: [],
    };
  },

  createEpisodeForProject(input: { projectId: string; title?: string }): EpisodeSummary {
    const now = Date.now();
    const project = projectRepo.get(input.projectId) || this.ensureDefaultProject();
    const episodeNo = episodeRepo.getNextEpisodeNo(project.id);
    const episodeId = `ep_${randomUUID()}`;
    const title = input.title?.trim() || `第 ${episodeNo} 集`;
    const episode: DBEpisode = {
      id: episodeId,
      project_id: project.id,
      episode_no: episodeNo,
      title,
      script: '',
      context: '',
      script_overview: '',
      analysis_json: stringifyJson({ sceneTable: [], beatTable: [] }),
      config_json: stringifyJson({
        artStyle: '',
        aspectRatio: '16:9',
        resolution: '2K',
        apiProvider: 'auto',
      }),
      tags_json: null,
      created_at: now,
      updated_at: now,
    };
    episodeRepo.create(episode);
    return {
      episodeId: episode.id,
      projectId: project.id,
      episodeNo: episode.episode_no,
      title: episode.title || `第 ${episode.episode_no} 集`,
      updatedAt: episode.updated_at,
      shotCount: 0,
    };
  },

  async saveEpisodeFull(data: EpisodeData): Promise<void> {
    const now = Date.now();

    // 1. Save Episode Meta
    const baseConfig = {
      artStyle: data.config.artStyle,
      aspectRatio: data.config.aspectRatio,
      resolution: data.config.resolution,
      apiProvider: data.config.apiProvider,
    };

    this.ensureDefaultProject();

    const existing = episodeRepo.get(data.episodeId);
    const resolvedProjectId = data.projectId || existing?.project_id || DEFAULT_PROJECT_ID;
    const project = projectRepo.get(resolvedProjectId) || this.ensureDefaultProject();
    const resolvedEpisodeNo = data.episodeNo || existing?.episode_no || episodeRepo.getNextEpisodeNo(project.id);
    const resolvedTitle = data.title?.trim() || existing?.title || `第 ${resolvedEpisodeNo} 集`;
    const analysisPayload = {
      sceneTable: data.sceneTable || parseJson(existing?.analysis_json || null, { sceneTable: [] }).sceneTable || [],
      beatTable: data.beatTable || parseJson(existing?.analysis_json || null, { beatTable: [] }).beatTable || [],
    };

    const episode: DBEpisode = {
      id: data.episodeId,
      project_id: project.id,
      episode_no: resolvedEpisodeNo,
      title: resolvedTitle,
      script: data.script ?? existing?.script ?? null,
      context: data.context ?? existing?.context ?? null,
      script_overview: data.scriptOverview ?? existing?.script_overview ?? null,
      analysis_json: stringifyJson(analysisPayload),
      config_json: stringifyJson(baseConfig),
      tags_json: existing?.tags_json || null,
      created_at: now,
      updated_at: now,
    };
    
    // Check if exists to preserve created_at
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
        matrix_prompts_json: stringifyJson(serializeMatrixPromptPayload(shot.matrixPrompts, shot.gridLayout)),
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

  async loadEpisode(episodeId: string, options?: { mediaFormat?: 'url' | 'dataUri' }): Promise<EpisodeData | null> {
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
        refImage:
          options?.mediaFormat === 'dataUri'
            ? await readMediaDataUri(a.ref_image_path)
            : await readMediaUrl(a.ref_image_path),
        tags: parseJson<string[]>(a.tags_json, [])
      };
      if (a.type === 'character') characters.push(assetObj);
      else if (a.type === 'scene') scenes.push(assetObj);
      else if (a.type === 'prop') props.push(assetObj);
    }

    // Transform Shots
    const shots: Shot[] = await Promise.all(
      dbShots.map(async (s) => {
        const mediaFormat = options?.mediaFormat === 'dataUri' ? 'dataUri' : 'url';
        const resolveMedia = mediaFormat === 'dataUri' ? readMediaDataUri : readMediaUrl;
        const matrixPayload = parseJson<unknown>(s.matrix_prompts_json, null);
        const parsedMatrix = parseMatrixPromptPayload(matrixPayload);

        const rawHistory = parseJson<ShotHistoryItem[]>(s.history_json, []);
        const hydratedHistory = await hydrateHistoryEntries(rawHistory, mediaFormat, parsedMatrix.gridLayout);
        const historyFallbackLayout = hydratedHistory[0]?.gridLayout;
        const gridLayout = normalizeGridLayout(parsedMatrix.gridLayout, historyFallbackLayout);
        const cellCount = getGridCellCount(gridLayout);

        const matrixPrompts = ensurePromptListLength(parsedMatrix.prompts, gridLayout);

        const splitPaths = normalizeIndexedList<string | null>(
          parseJson<(string | null)[]>(s.split_images_json, []),
          cellCount,
          null,
        );
        const splitImages = await Promise.all(splitPaths.map((p) => (p ? resolveMedia(p) : undefined)));

        const videoPaths = normalizeIndexedList<string | null>(
          parseJson<(string | null)[]>(s.video_urls_json, []),
          cellCount,
          null,
        );
        const videoUrls = await Promise.all(videoPaths.map((p) => (p ? resolveMedia(p) : undefined)));

        const videoStatus = normalizeIndexedList<Shot['videoStatus'][number]>(
          parseJson<Shot['videoStatus']>(s.video_status_json, []),
          cellCount,
          'idle',
        );

        return {
          id: s.id,
          originalText: s.original_text || '',
          visualTranslation: s.visual_translation || '',
          contextTag: s.context_tag || '',
          shotKind: (s.shot_kind as any) || undefined,
          gridLayout,
          matrixPrompts,
          generatedImageUrl: await resolveMedia(s.generated_image_path),
          splitImages: (splitImages.map((v) => v || '') as unknown as string[]),
          videoUrls: (videoUrls.map((v) => v ?? null) as unknown as (string | null)[]),
          animaticVideoUrl: await resolveMedia(s.animatic_video_path),
          assetVideoUrl: await resolveMedia(s.asset_video_path),
          status: (s.status as any) || 'pending',
          videoStatus,
          progress: s.progress || 0,
          history: hydratedHistory,
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
      projectId: ep.project_id || DEFAULT_PROJECT_ID,
      episodeNo: ep.episode_no || 1,
      title: ep.title || `第 ${ep.episode_no || 1} 集`,
      script: ep.script || '',
      context: ep.context || '',
      scriptOverview: ep.script_overview || '',
      sceneTable: parseJson(ep.analysis_json, { sceneTable: [], beatTable: [] }).sceneTable || [],
      beatTable: parseJson(ep.analysis_json, { sceneTable: [], beatTable: [] }).beatTable || [],
      config: {
        ...parseJson(ep.config_json, {
          artStyle: '',
          aspectRatio: '16:9',
          resolution: '2K',
          apiProvider: 'auto',
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
