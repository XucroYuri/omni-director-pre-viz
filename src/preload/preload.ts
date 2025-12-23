import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type PreloadApi } from '../shared/ipc';

const api: PreloadApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  app: {
    exportEpisode: (options) => ipcRenderer.invoke(IPC_CHANNELS.app.exportEpisode, options),
  },
  ai: {
    breakdownScript: (script, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.breakdownScript, script, config),
    recommendAssets: (shot, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.recommendAssets, shot, config),
    generateMatrixPrompts: (shot, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.generateMatrixPrompts, shot, config),
    optimizePrompts: (shot, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.optimizePrompts, shot, config),
    generateGridImage: (shot, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.generateGridImage, shot, config),
    generateShotVideo: (params, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.generateShotVideo, params, config),
    enhanceAssetDescription: (name, currentDesc) => ipcRenderer.invoke(IPC_CHANNELS.ai.enhanceAssetDescription, name, currentDesc),
    generateAssetImage: (name, description, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.generateAssetImage, name, description, config),
    discoverMissingAssets: (shot, config) => ipcRenderer.invoke(IPC_CHANNELS.ai.discoverMissingAssets, shot, config),
  },
};

contextBridge.exposeInMainWorld('api', api);
