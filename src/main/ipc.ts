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

let registered = false;

export function registerIpcHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle(IPC_CHANNELS.ping, async () => {
    return 'pong';
  });

  ipcMain.handle(IPC_CHANNELS.ai.breakdownScript, async (_evt, script, config) => limiters.llm(() => breakdownScript(script, config)));
  ipcMain.handle(IPC_CHANNELS.ai.recommendAssets, async (_evt, shot, config) => limiters.llm(() => recommendAssets(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateMatrixPrompts, async (_evt, shot, config) =>
    limiters.llm(() => generateMatrixPrompts(shot, config)),
  );
  ipcMain.handle(IPC_CHANNELS.ai.optimizePrompts, async (_evt, shot, config) => limiters.llm(() => optimizePrompts(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateGridImage, async (_evt, shot, config) => limiters.image(() => generateGridImage(shot, config)));
  ipcMain.handle(IPC_CHANNELS.ai.generateShotVideo, async (_evt, imageUri, prompt, config) =>
    limiters.video(() => generateShotVideo(imageUri, prompt, config)),
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
