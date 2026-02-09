import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type PreloadApi } from '../shared/ipc';
import type { DBTask } from '../shared/types';

type TaskUpdateCallback = (task: DBTask) => void;
const taskUpdateHandlers = new Map<TaskUpdateCallback, (event: IpcRendererEvent, task: DBTask) => void>();

const api: PreloadApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  app: {
    exportEpisode: (options) => ipcRenderer.invoke(IPC_CHANNELS.app.exportEpisode, options),
    project: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.app.project.list),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.app.project.create, input),
      createEpisode: (input) => ipcRenderer.invoke(IPC_CHANNELS.app.project.createEpisode, input),
    },
    media: {
      putBytes: (input) => ipcRenderer.invoke(IPC_CHANNELS.app.media.putBytes, input),
    },
    db: {
      saveEpisode: (data) => ipcRenderer.invoke(IPC_CHANNELS.app.db.saveEpisode, data),
      loadEpisode: (episodeId) => ipcRenderer.invoke(IPC_CHANNELS.app.db.loadEpisode, episodeId),
    },
    settings: {
      getRuntimeEnv: () => ipcRenderer.invoke(IPC_CHANNELS.app.settings.getRuntimeEnv),
      saveRuntimeEnv: (input) => ipcRenderer.invoke(IPC_CHANNELS.app.settings.saveRuntimeEnv, input),
    },
    task: {
      submit: (task) => ipcRenderer.invoke(IPC_CHANNELS.app.task.submit, task),
      list: () => ipcRenderer.invoke(IPC_CHANNELS.app.task.list),
      cancel: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.app.task.cancel, taskId),
      retry: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.app.task.retry, taskId),
      onUpdate: (callback) => {
        const existing = taskUpdateHandlers.get(callback);
        if (existing) {
          ipcRenderer.off(IPC_CHANNELS.app.task.update, existing);
        }
        const handler = (_event: IpcRendererEvent, task: DBTask) => callback(task);
        taskUpdateHandlers.set(callback, handler);
        ipcRenderer.on(IPC_CHANNELS.app.task.update, handler);
      },
      offUpdate: (callback) => {
        const handler = taskUpdateHandlers.get(callback);
        if (!handler) return;
        ipcRenderer.off(IPC_CHANNELS.app.task.update, handler);
        taskUpdateHandlers.delete(callback);
      },
    },
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
