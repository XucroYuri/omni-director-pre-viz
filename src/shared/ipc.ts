import type {
  EpisodeData,
  ExportOptions,
  ExportResult,
  GlobalConfig,
  ProjectSummary,
  EpisodeSummary,
  PromptOptimization,
  ScriptBreakdownResponse,
  Shot,
  VideoGenerationParams,
  DBTask,
} from './types';

export const IPC_CHANNELS = {
  ping: 'app:ping',
  app: {
    exportEpisode: 'app:exportEpisode',
    project: {
      list: 'app:project:list',
      create: 'app:project:create',
      createEpisode: 'app:project:createEpisode',
    },
    media: {
      putBytes: 'app:media:putBytes',
    },
    db: {
      saveEpisode: 'app:db:saveEpisode',
      loadEpisode: 'app:db:loadEpisode',
    },
    task: {
      submit: 'app:task:submit',
      list: 'app:task:list',
      update: 'app:task:update',
      cancel: 'app:task:cancel',
      retry: 'app:task:retry',
    },
  },
  ai: {
    breakdownScript: 'ai:breakdownScript',
    recommendAssets: 'ai:recommendAssets',
    generateMatrixPrompts: 'ai:generateMatrixPrompts',
    optimizePrompts: 'ai:optimizePrompts',
    generateGridImage: 'ai:generateGridImage',
    generateShotVideo: 'ai:generateShotVideo',
    enhanceAssetDescription: 'ai:enhanceAssetDescription',
    generateAssetImage: 'ai:generateAssetImage',
    discoverMissingAssets: 'ai:discoverMissingAssets',
  },
} as const;

export type RecommendAssetsResult = { characterIds: string[]; sceneIds: string[]; propIds: string[] };
export type MissingAssetCandidate = { name: string; description: string };
export type DiscoverMissingAssetsResult = {
  characters: MissingAssetCandidate[];
  scenes: MissingAssetCandidate[];
  props: MissingAssetCandidate[];
};

export type PreloadApi = {
  ping: () => Promise<string>;
  app: {
    exportEpisode: (options: ExportOptions) => Promise<ExportResult>;
    project: {
      list: () => Promise<ProjectSummary[]>;
      create: (input: { name: string; description?: string }) => Promise<ProjectSummary>;
      createEpisode: (input: { projectId: string; title?: string }) => Promise<EpisodeSummary>;
    };
    media: {
      putBytes: (input: { bytes: Uint8Array; mimeType: string; relativeBase: string }) => Promise<string>;
    };
    db: {
      saveEpisode: (data: EpisodeData) => Promise<void>;
      loadEpisode: (episodeId: string) => Promise<EpisodeData | null>;
    };
    task: {
      submit: (task: DBTask) => Promise<void>;
      list: () => Promise<DBTask[]>;
      cancel: (taskId: string) => Promise<void>;
      retry: (taskId: string) => Promise<void>;
      onUpdate: (callback: (task: DBTask) => void) => void;
      offUpdate: (callback: (task: DBTask) => void) => void;
    };
  };
  ai: {
    breakdownScript: (script: string, config: GlobalConfig) => Promise<ScriptBreakdownResponse>;
    recommendAssets: (shot: Shot, config: GlobalConfig) => Promise<RecommendAssetsResult>;
    generateMatrixPrompts: (shot: Shot, config: GlobalConfig) => Promise<string[]>;
    optimizePrompts: (shot: Shot, config: GlobalConfig) => Promise<PromptOptimization>;
    generateGridImage: (shot: Shot, config: GlobalConfig) => Promise<string>;
    generateShotVideo: (params: VideoGenerationParams, config: GlobalConfig) => Promise<string>;
    enhanceAssetDescription: (name: string, currentDesc: string) => Promise<string>;
    generateAssetImage: (name: string, description: string, config: GlobalConfig) => Promise<string>;
    discoverMissingAssets: (shot: Shot, config: GlobalConfig) => Promise<DiscoverMissingAssetsResult>;
  };
};
