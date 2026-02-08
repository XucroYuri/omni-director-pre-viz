import { ipcMain } from 'electron';
import { IPC_CHANNELS, type DiscoverMissingAssetsResult } from '../shared/ipc';
import { limiters } from './providers/limiters';
import {
  breakdownScript,
  discoverMissingAssets,
  enhanceAssetDescription,
  generateAssetImage,
  generateGridImage,
  generateMatrixPrompts,
  optimizePrompts,
  recommendAssets,
} from './providers/aihubmix/gemini';
import { isMissingAihubmixApiKeyError } from './providers/aihubmix/env';
import { generateShotVideo } from './providers/aihubmix/sora2';
import { dbService } from './services/dbService';
import { exportEpisode } from './services/exportService';
import { readFileAsDataUri, resolveMediaRefToFilePath, writeBytesToMedia, urlFromPath } from './services/mediaService';

async function hydrateConfigRefImages(config: any) {
  if (!config) return config;
  const hydrate = async (value: unknown) => {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('omni-media://')) return value;
    const filePath = resolveMediaRefToFilePath(value);
    if (!filePath) return value;
    return readFileAsDataUri(filePath);
  };

  const next = { ...config };
  if (Array.isArray(next.characters)) {
    next.characters = await Promise.all(next.characters.map(async (c: any) => ({ ...c, refImage: await hydrate(c.refImage) })));
  }
  if (Array.isArray(next.scenes)) {
    next.scenes = await Promise.all(next.scenes.map(async (s: any) => ({ ...s, refImage: await hydrate(s.refImage) })));
  }
  if (Array.isArray(next.props)) {
    next.props = await Promise.all(next.props.map(async (p: any) => ({ ...p, refImage: await hydrate(p.refImage) })));
  }
  return next;
}

async function hydrateParamsImageUri(params: any) {
  if (!params || typeof params !== 'object') return params;
  const uri = (params as any).imageUri;
  if (typeof uri !== 'string' || !uri.startsWith('omni-media://')) return params;
  const filePath = resolveMediaRefToFilePath(uri);
  if (!filePath) return params;
  return { ...(params as any), imageUri: await readFileAsDataUri(filePath) };
}
import { taskQueue } from './queue/TaskQueue';

let registered = false;
let hasWarnedMissingAihubmixApiKeyForDiscovery = false;

function emptyDiscoverMissingAssetsResult(): DiscoverMissingAssetsResult {
  return {
    characters: [],
    scenes: [],
    props: [],
  };
}

export function registerIpcHandlers() {
  if (registered) return;
  registered = true;
  taskQueue.restore();

  ipcMain.handle(IPC_CHANNELS.ping, async () => {
    return 'pong';
  });

  ipcMain.handle(IPC_CHANNELS.app.exportEpisode, async (_evt, options) => exportEpisode(options));
  ipcMain.handle(IPC_CHANNELS.app.project.list, async () => dbService.listProjects());
  ipcMain.handle(IPC_CHANNELS.app.project.create, async (_evt, input) => dbService.createProject(input));
  ipcMain.handle(IPC_CHANNELS.app.project.createEpisode, async (_evt, input) =>
    dbService.createEpisodeForProject(input),
  );
  ipcMain.handle(IPC_CHANNELS.app.media.putBytes, async (_evt, input) => {
    const bytes = input?.bytes as Uint8Array | undefined;
    const mimeType = input?.mimeType as string | undefined;
    const relativeBase = input?.relativeBase as string | undefined;
    const trimmedMimeType = typeof mimeType === 'string' ? mimeType.trim() : '';
    const trimmedRelativeBase = typeof relativeBase === 'string' ? relativeBase.trim() : '';
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || !trimmedMimeType || !trimmedRelativeBase) {
      throw new Error('media.putBytes requires non-empty bytes, mimeType, relativeBase');
    }
    const { url } = await writeBytesToMedia({ bytes, mimeType: trimmedMimeType, relativeBase: trimmedRelativeBase });
    return url;
  });
  ipcMain.handle(IPC_CHANNELS.app.db.saveEpisode, async (_evt, data) => dbService.saveEpisodeFull(data));
  ipcMain.handle(IPC_CHANNELS.app.db.loadEpisode, async (_evt, episodeId) => dbService.loadEpisode(episodeId));
  ipcMain.handle(IPC_CHANNELS.app.task.submit, async (_evt, task) => taskQueue.enqueue(task));
  ipcMain.handle(IPC_CHANNELS.app.task.list, async () => taskQueue.list());
  ipcMain.handle(IPC_CHANNELS.app.task.cancel, async (_evt, taskId) => taskQueue.cancelTask(taskId));
  ipcMain.handle(IPC_CHANNELS.app.task.retry, async (_evt, taskId) => taskQueue.retryTask(taskId));

  ipcMain.handle(IPC_CHANNELS.ai.breakdownScript, async (_evt, script, config) => limiters.llm(() => breakdownScript(script, config)));
  ipcMain.handle(IPC_CHANNELS.ai.recommendAssets, async (_evt, shot, config) => limiters.llm(() => recommendAssets(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateMatrixPrompts, async (_evt, shot, config) =>
    limiters.llm(() => generateMatrixPrompts(shot, config)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.optimizePrompts, async (_evt, shot, config) => limiters.llm(() => optimizePrompts(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateGridImage, async (_evt, shot, config) =>
    limiters.image(async () => {
      const hydratedConfig = await hydrateConfigRefImages(config);
      const { path } = await generateGridImage(shot, hydratedConfig);
      return urlFromPath(path);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.ai.generateShotVideo, async (_evt, params, config) =>
    limiters.video(async () => {
      const hydratedConfig = await hydrateConfigRefImages(config);
      const hydratedParams = await hydrateParamsImageUri(params);
      const { path } = await generateShotVideo(hydratedParams, hydratedConfig);
      return urlFromPath(path);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.ai.enhanceAssetDescription, async (_evt, name, currentDesc) =>
    limiters.llm(() => enhanceAssetDescription(name, currentDesc)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.generateAssetImage, async (_evt, name, description, config) =>
    limiters.image(async () => {
      const { path } = await generateAssetImage(name, description, config);
      return urlFromPath(path);
    }),
  );
  ipcMain.handle(IPC_CHANNELS.ai.discoverMissingAssets, async (_evt, shot, config) =>
    limiters.llm(async () => {
      try {
        return await discoverMissingAssets(shot, config);
      } catch (error) {
        if (!isMissingAihubmixApiKeyError(error)) {
          throw error;
        }
        if (!hasWarnedMissingAihubmixApiKeyForDiscovery) {
          hasWarnedMissingAihubmixApiKeyForDiscovery = true;
          console.warn('AIHUBMIX_API_KEY is not configured; discoverMissingAssets returns empty results.');
        }
        return emptyDiscoverMissingAssetsResult();
      }
    }),
  );
}
