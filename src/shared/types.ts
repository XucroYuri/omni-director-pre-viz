
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

export interface GridLayout {
  rows: number;
  cols: number;
}

export interface ShotHistoryItem {
  timestamp: number;
  imageUrl: string; // 网格母图
  gridLayout?: GridLayout;
  splitImages?: string[]; // 基于网格切片的子图
  prompts: string[];
  videoUrls?: (string | null)[]; // 对应各机位的视频生成结果
}

export interface PromptOptimization {
  critique: string;
  suggestions: string[];
  optimizedPrompts: string[];
}

export type VideoInputMode = 'TEXT_ONLY' | 'IMAGE_FIRST_FRAME' | 'IMAGE_FIRST_LAST' | 'MATRIX_FRAME' | 'ASSET_COLLAGE';

export interface Shot {
  id: string;
  originalText: string;
  visualTranslation: string;
  contextTag: string;
  shotKind?: 'CHAR' | 'ENV' | 'POV' | 'INSERT' | 'MIXED';
  gridLayout?: GridLayout;
  matrixPrompts?: string[]; // 网格机位提示词（rows*cols）
  generatedImageUrl?: string; // 网格母图
  splitImages?: string[]; // 基于网格切片后的子图
  videoUrls?: (string | null)[]; // 视角对应的视频结果
  animaticVideoUrl?: string; // 基于网格母图生成的动态分镜视频 (Matrix Video)
  assetVideoUrl?: string; // 基于资产拼贴图生成的视频 (Asset Video)
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

export interface VideoGenerationParams {
  inputMode: VideoInputMode;
  shot: Shot;
  prompt?: string;
  imageUri?: string;
  angleIndex?: number;
}

export interface ExportOptions {
  episodeId: string;
  shots: Shot[];
  config: GlobalConfig;
  includeVideos: boolean;
  createZip: boolean;
  outputDir?: string;
}

export interface ManifestShot {
  shotId: string;
  visualTranslation: string;
  matrixImage: string;
  slices: string[];
  videos: (string | null)[];
  animaticVideo: string | null;
  assetVideo: string | null;
  prompts: string[];
  assets: {
    characters: string[];
    scenes: string[];
    props: string[];
  };
}

export interface Manifest {
  version: string;
  episodeId: string;
  generatedAt: string;
  totalShots: number;
  shots: ManifestShot[];
}

export interface ExportResult {
  success: boolean;
  outputPath: string;
  zipPath?: string;
  error?: string;
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

export interface EpisodeData {
  episodeId: string;
  config: GlobalConfig;
  shots: Shot[];
  assets: {
    characters: Character[];
    scenes: Scene[];
    props: Prop[];
  };
}

export type TaskType = 'LLM' | 'IMAGE' | 'VIDEO' | 'EXPORT';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type JobKind =
  | 'MATRIX_GEN'
  | 'MATRIX_SLICE'
  | 'VIDEO_GEN'
  | 'ASSET_GEN'
  | 'EXPORT_EPISODE';

export type TaskPayload =
  | { jobKind: 'MATRIX_GEN'; [key: string]: unknown }
  | { jobKind: 'MATRIX_SLICE'; [key: string]: unknown }
  | { jobKind: 'VIDEO_GEN'; [key: string]: unknown }
  | { jobKind: 'ASSET_GEN'; [key: string]: unknown }
  | { jobKind: 'EXPORT_EPISODE'; [key: string]: unknown };

export type TaskResult = { outputPath?: string; [key: string]: unknown };

export interface DBTask {
  id: string;
  episode_id: string;
  shot_id: string | null;
  type: TaskType;
  status: TaskStatus;
  progress: number | null;
  payload_json: string;
  result_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}
