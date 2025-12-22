import type { GlobalConfig, PromptOptimization, ScriptBreakdownResponse, Shot, VideoGenerationParams } from './types';

export const IPC_CHANNELS = {
  ping: 'app:ping',
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
