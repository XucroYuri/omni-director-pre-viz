import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';

const phase1NotImplemented = (feature: string) => {
  throw new Error(`[Phase 1] ${feature} is not wired yet. Start Phase 2 provider integration before using generation features.`);
};

let registered = false;

export function registerIpcHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle(IPC_CHANNELS.ping, async () => {
    return 'pong';
  });

  ipcMain.handle(IPC_CHANNELS.ai.breakdownScript, async () => phase1NotImplemented('breakdownScript'));
  ipcMain.handle(IPC_CHANNELS.ai.recommendAssets, async () => phase1NotImplemented('recommendAssets'));
  ipcMain.handle(IPC_CHANNELS.ai.generateMatrixPrompts, async () => phase1NotImplemented('generateMatrixPrompts'));
  ipcMain.handle(IPC_CHANNELS.ai.optimizePrompts, async () => phase1NotImplemented('optimizePrompts'));
  ipcMain.handle(IPC_CHANNELS.ai.generateGridImage, async () => phase1NotImplemented('generateGridImage'));
  ipcMain.handle(IPC_CHANNELS.ai.generateShotVideo, async () => phase1NotImplemented('generateShotVideo'));
  ipcMain.handle(IPC_CHANNELS.ai.enhanceAssetDescription, async () => phase1NotImplemented('enhanceAssetDescription'));
  ipcMain.handle(IPC_CHANNELS.ai.generateAssetImage, async () => phase1NotImplemented('generateAssetImage'));
  ipcMain.handle(IPC_CHANNELS.ai.discoverMissingAssets, async () => phase1NotImplemented('discoverMissingAssets'));
}
