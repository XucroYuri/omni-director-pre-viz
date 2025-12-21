import type { GlobalConfig, PromptOptimization, ScriptBreakdownResponse, Shot } from '@shared/types';
import type { DiscoverMissingAssetsResult, RecommendAssetsResult } from '@shared/ipc';

const requireApi = () => {
  if (!window.api) {
    throw new Error('This feature requires the Electron app runtime (window.api is not available). Use `npm run dev` to start Electron.');
  }
  return window.api;
};

export const breakdownScript = async (script: string, config: GlobalConfig): Promise<ScriptBreakdownResponse> => {
  return requireApi().ai.breakdownScript(script, config);
};

export const recommendAssets = async (
  shot: Shot,
  config: GlobalConfig,
): Promise<RecommendAssetsResult> => {
  return requireApi().ai.recommendAssets(shot, config);
};

export const generateMatrixPrompts = async (shot: Shot, config: GlobalConfig): Promise<string[]> => {
  return requireApi().ai.generateMatrixPrompts(shot, config);
};

export const optimizePrompts = async (shot: Shot, config: GlobalConfig): Promise<PromptOptimization> => {
  return requireApi().ai.optimizePrompts(shot, config);
};

export const generateGridImage = async (shot: Shot, config: GlobalConfig): Promise<string> => {
  return requireApi().ai.generateGridImage(shot, config);
};

export const generateShotVideo = async (imageUri: string, prompt: string, config: GlobalConfig): Promise<string> => {
  return requireApi().ai.generateShotVideo(imageUri, prompt, config);
};

export const enhanceAssetDescription = async (name: string, currentDesc: string): Promise<string> => {
  return requireApi().ai.enhanceAssetDescription(name, currentDesc);
};

export const generateAssetImage = async (name: string, description: string, config: GlobalConfig): Promise<string> => {
  return requireApi().ai.generateAssetImage(name, description, config);
};

export const discoverMissingAssets = async (
  shot: Shot,
  config: GlobalConfig,
): Promise<DiscoverMissingAssetsResult> => {
  return requireApi().ai.discoverMissingAssets(shot, config);
};
