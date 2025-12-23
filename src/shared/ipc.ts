import type {
  EpisodeData,
  ExportOptions,
  ExportResult,
  GlobalConfig,
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
    db: {
      saveEpisode: 'app:db:saveEpisode',
      loadEpisode: 'app:db:loadEpisode',
    },
    task: {
      submit: 'app:task:submit',
      list: 'app:task:list',
      update: 'app:task:update',
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
    db: {
      saveEpisode: (data: EpisodeData) => Promise<void>;
      loadEpisode: (episodeId: string) => Promise<EpisodeData | null>;
    };
    task: {
      submit: (task: DBTask) => Promise<void>;
      list: () => Promise<DBTask[]>;
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
