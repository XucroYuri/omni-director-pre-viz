import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GlobalConfig, VideoGenerationParams } from '../../../shared/types';
import { buildAssetInjection } from '../../../shared/utils';
import { getAihubmixEnv } from './env';
import { createAssetCollage } from '../../services/assetCollage';

type SoraVideoStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | string;

type CreateVideoResponse = {
  id: string;
  status: SoraVideoStatus;
};

type RetrieveVideoResponse = {
  id: string;
  status: SoraVideoStatus;
  progress?: number;
  error?: { message?: string };
};

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  return { mimeType: match[1], base64: match[2] };
}

async function httpJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

async function httpBytes(url: string, init: RequestInit): Promise<Uint8Array> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

function mapVideoSize(aspectRatio: GlobalConfig['aspectRatio']): string {
  return aspectRatio === '9:16' ? '720x1280' : '1280x720';
}

const VIDEO_PRESET_PREFIX = `[视频生成约束/不可省略]
- 输出语言默认中文（镜头术语可为英文）
- 需忠实于镜头原文语义，不得擅自改写剧情
- 若提供参考图：把输入图片作为视频第一帧与主体/风格参考，保持角色/场景一致性
`;

function buildMatrixVideoPrompt(params: VideoGenerationParams, config: GlobalConfig): string {
  const prompts = params.shot.matrixPrompts || [];
  const assetInjection = buildAssetInjection(params.shot, config);
  const assetLine = assetInjection ? `资产绑定: ${assetInjection}` : '资产绑定: 无';

  return `[矩阵分镜视频约束]
- 输入为 3x3 母图（九格镜头）
- 输出为连贯的动态分镜（Animatic），保持角色/场景/道具一致性
- 镜头节奏从 Angle_01 到 Angle_09
${assetLine}
镜头描述: ${params.shot.visualTranslation}
Angle_01: ${prompts[0] || ''}
Angle_02: ${prompts[1] || ''}
Angle_03: ${prompts[2] || ''}
Angle_04: ${prompts[3] || ''}
Angle_05: ${prompts[4] || ''}
Angle_06: ${prompts[5] || ''}
Angle_07: ${prompts[6] || ''}
Angle_08: ${prompts[7] || ''}
Angle_09: ${prompts[8] || ''}`.trim();
}

export async function generateShotVideo(params: VideoGenerationParams, config: GlobalConfig): Promise<string> {
  const env = getAihubmixEnv();
  const size = mapVideoSize(config.aspectRatio);

  let prompt = params.prompt?.trim() || '';
  let imageUri = params.imageUri;

  if (params.inputMode === 'MATRIX_FRAME') {
    imageUri = params.imageUri || params.shot.generatedImageUrl;
    if (!imageUri) throw new Error('Matrix video requires generatedImageUrl');
    prompt = buildMatrixVideoPrompt(params, config);
  } else if (params.inputMode === 'IMAGE_FIRST_FRAME') {
    if (!imageUri) throw new Error('Slot video requires input image');
    if (!prompt) prompt = params.shot.visualTranslation;
  } else if (params.inputMode === 'TEXT_ONLY') {
    if (!prompt) prompt = params.shot.visualTranslation;
  } else if (params.inputMode === 'ASSET_COLLAGE') {
    if (!imageUri) {
      const collage = await createAssetCollage(params.shot, config);
      imageUri = `data:image/png;base64,${collage.toString('base64')}`;
    }
    if (!prompt) prompt = params.shot.visualTranslation;
    const assetInjection = buildAssetInjection(params.shot, config);
    if (assetInjection) prompt = `${prompt}\n${assetInjection}`;
  }

  const duration = params.inputMode === 'MATRIX_FRAME' ? '8s' : '4s';

  const body: any = {
    model: 'sora-2',
    prompt: `${VIDEO_PRESET_PREFIX}\n${prompt}`,
    size,
    duration,
  };

  if (imageUri) {
    const { mimeType, base64 } = parseDataUri(imageUri);
    body.image = { imageBytes: base64, mimeType };
  }

  const headers = {
    Authorization: `Bearer ${env.apiKey}`,
    'Content-Type': 'application/json',
  };

  const created = await httpJson<CreateVideoResponse>(`${env.openaiBaseUrl}/videos`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let video: RetrieveVideoResponse = { id: created.id, status: created.status };
  const startedAt = Date.now();
  const timeoutMs = 10 * 60 * 1000;

  while (video.status === 'queued' || video.status === 'in_progress') {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Video generation timed out');
    await new Promise((r) => setTimeout(r, 5000));
    video = await httpJson<RetrieveVideoResponse>(`${env.openaiBaseUrl}/videos/${video.id}`, {
      method: 'GET',
      headers,
    });
  }

  if (video.status !== 'completed') {
    throw new Error(video.error?.message || `Video failed: ${video.status}`);
  }

  const contentUrls = [`${env.openaiBaseUrl}/videos/${video.id}/content`, `${env.openaiBaseUrl}/videos/${video.id}/download`];
  let bytes: Uint8Array | null = null;
  for (const url of contentUrls) {
    try {
      bytes = await httpBytes(url, { method: 'GET', headers });
      break;
    } catch {
      // try next
    }
  }
  if (!bytes) throw new Error('Video download failed');

  await fs.mkdir(path.join(env.outputDir, 'videos'), { recursive: true });
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
  const filePath = path.join(env.outputDir, 'videos', `sora2_${hash}.mp4`);
  await fs.writeFile(filePath, bytes);

  return `data:video/mp4;base64,${Buffer.from(bytes).toString('base64')}`;
}
