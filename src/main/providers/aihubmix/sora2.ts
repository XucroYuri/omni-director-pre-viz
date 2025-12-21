import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GlobalConfig } from '../../../shared/types';
import { getAihubmixEnv } from './env';

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

export async function generateShotVideo(imageUri: string, prompt: string, config: GlobalConfig): Promise<string> {
  const env = getAihubmixEnv();
  const size = mapVideoSize(config.aspectRatio);

  const body: any = {
    model: 'sora-2',
    prompt: `${VIDEO_PRESET_PREFIX}\n${prompt}`,
    size,
    duration: '4s',
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
