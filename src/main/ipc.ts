import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
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
import { generateShotVideo } from './providers/aihubmix/sora2';
import { dbService } from './services/dbService';
import { exportEpisode } from './services/exportService';

let registered = false;

export function registerIpcHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle(IPC_CHANNELS.ping, async () => {
    return 'pong';
  });

  ipcMain.handle(IPC_CHANNELS.app.exportEpisode, async (_evt, options) => exportEpisode(options));
  ipcMain.handle(IPC_CHANNELS.app.db.saveEpisode, async (_evt, data) => dbService.saveEpisodeFull(data));
  ipcMain.handle(IPC_CHANNELS.app.db.loadEpisode, async (_evt, episodeId) => dbService.loadEpisode(episodeId));

  ipcMain.handle(IPC_CHANNELS.ai.breakdownScript, async (_evt, script, config) => limiters.llm(() => breakdownScript(script, config)));
  ipcMain.handle(IPC_CHANNELS.ai.recommendAssets, async (_evt, shot, config) => limiters.llm(() => recommendAssets(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateMatrixPrompts, async (_evt, shot, config) =>
    limiters.llm(() => generateMatrixPrompts(shot, config)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.optimizePrompts, async (_evt, shot, config) => limiters.llm(() => optimizePrompts(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateGridImage, async (_evt, shot, config) => limiters.image(() => generateGridImage(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateShotVideo, async (_evt, params, config) =>
    limiters.video(() => generateShotVideo(params, config)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.enhanceAssetDescription, async (_evt, name, currentDesc) =>
    limiters.llm(() => enhanceAssetDescription(name, currentDesc)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.generateAssetImage, async (_evt, name, description, config) =>
    limiters.image(() => generateAssetImage(name, description, config)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.discoverMissingAssets, async (_evt, shot, config) =>
    limiters.llm(() => discoverMissingAssets(shot, config)),
  );
}
