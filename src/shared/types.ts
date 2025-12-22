
export interface Character {
  id: string;
  name: string;
  refImage?: string; // Base64
  description: string;
  tags?: string[];
}

export interface Scene {
  id: string;
  name: string;
  refImage?: string; // Base64
  description: string;
  tags?: string[];
}

export interface Prop {
  id: string;
  name: string;
  refImage?: string; // Base64
  description: string;
  tags?: string[];
}

export interface ShotHistoryItem {
  timestamp: number;
  imageUrl: string; // 3x3 母图
  splitImages?: string[]; // 物理切片后的 9 张子图
  prompts: string[];
  videoUrls?: (string | null)[]; // 对应 9 个机位的视频生成结果
}

export interface PromptOptimization {
  critique: string;
  suggestions: string[];
  optimizedPrompts: string[];
}

export interface Shot {
  id: string;
  originalText: string;
  visualTranslation: string;
  contextTag: string;
  matrixPrompts?: string[]; // 9个机位的提示词 (作为生成母图的参数)
  generatedImageUrl?: string; // 3x3 矩阵母图
  splitImages?: string[]; // 物理切片后的9张图
  videoUrls?: (string | null)[]; // 9个视角对应的视频结果
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoStatus?: ('idle' | 'queued' | 'processing' | 'downloading' | 'completed' | 'failed')[];
  progress?: number; 
  history?: ShotHistoryItem[]; 
  optimization?: PromptOptimization; 
  characterIds?: string[]; 
  sceneIds?: string[]; 
  propIds?: string[]; 
  linkedShotIds?: string[]; 
  lastAccessedAt?: number; 
}

export type ApiProvider = 'aihubmix';

export interface GlobalConfig {
  artStyle: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '1K' | '2K' | '4K';
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  apiProvider: ApiProvider;
}

export interface ScriptBreakdownResponse {
  context: string;
  shots: Shot[];
  characters: { name: string; description: string }[];
}
