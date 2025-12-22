import { GoogleGenAI, Type } from '@google/genai';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GlobalConfig, Shot } from '../../../shared/types';
import type { DiscoverMissingAssetsResult, MissingAssetCandidate, RecommendAssetsResult } from '../../../shared/ipc';
import {
  IMAGE_MODEL,
  SYSTEM_INSTRUCTION_BREAKDOWN,
  SYSTEM_INSTRUCTION_MATRIX,
  SYSTEM_INSTRUCTION_OPTIMIZE,
  TEXT_MODEL,
} from '../../../shared/constants';
import { getAihubmixEnv } from './env';

type Json = Record<string, unknown> | unknown[];

const clientCache = new Map<string, GoogleGenAI>();

function getClient() {
  const env = getAihubmixEnv();
  const cacheKey = `${env.apiKey}@${env.geminiBaseUrl}`;
  const existing = clientCache.get(cacheKey);
  if (existing) return existing;

  const ai = new GoogleGenAI({
    apiKey: env.apiKey,
    httpOptions: {
      baseUrl: env.geminiBaseUrl,
    },
  });
  clientCache.set(cacheKey, ai);
  return ai;
}

function safeJsonParse(text: string): Json | null {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  const mimeType = match[1];
  const base64 = match[2];
  return { mimeType, base64 };
}

function getShotAssetContext(shot: Shot, config: GlobalConfig): string {
  const parts: string[] = [];
  const relevantChars =
    shot.characterIds && shot.characterIds.length > 0
      ? config.characters.filter((c) => shot.characterIds?.includes(c.id))
      : [];
  if (relevantChars.length > 0) parts.push(`角色: ${relevantChars.map((c) => `${c.name}(${c.description})`).join('，')}`);

  const relevantScenes =
    shot.sceneIds && shot.sceneIds.length > 0
      ? config.scenes.filter((s) => shot.sceneIds?.includes(s.id))
      : [];
  if (relevantScenes.length > 0) parts.push(`场景: ${relevantScenes.map((s) => `${s.name}(${s.description})`).join('，')}`);

  const relevantProps =
    shot.propIds && shot.propIds.length > 0 ? config.props.filter((p) => shot.propIds?.includes(p.id)) : [];
  if (relevantProps.length > 0) parts.push(`道具: ${relevantProps.map((p) => `${p.name}(${p.description})`).join('，')}`);

  return parts.join(' | ');
}

export async function breakdownScript(script: string, config: GlobalConfig) {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: script,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_BREAKDOWN,
      thinkingConfig: { thinkingBudget: 1024 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          context: { type: Type.STRING },
          shots: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                originalText: { type: Type.STRING },
                visualTranslation: { type: Type.STRING },
                contextTag: { type: Type.STRING },
              },
              required: ['id', 'originalText', 'visualTranslation', 'contextTag'],
            },
          },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ['name', 'description'],
            },
          },
        },
        required: ['context', 'shots', 'characters'],
      },
    },
  });

  const result = safeJsonParse(response.text || '{}') || {};
  const shots = Array.isArray((result as any).shots) ? (result as any).shots : [];
  return {
    context: (result as any).context || '',
    shots: shots.map((s: any) => ({
      ...s,
      status: 'pending',
      progress: 0,
      characterIds: [],
      sceneIds: [],
      propIds: [],
      videoUrls: Array(9).fill(null),
      videoStatus: Array(9).fill('idle'),
    })),
    characters: Array.isArray((result as any).characters) ? (result as any).characters : [],
  };
}

export async function recommendAssets(shot: Shot, config: GlobalConfig): Promise<RecommendAssetsResult> {
  const ai = getClient();
  const assetLibrary = {
    characters: config.characters.map((c) => ({ id: c.id, name: c.name, description: c.description })),
    scenes: config.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    props: config.props.map((p) => ({ id: p.id, name: p.name, description: p.description })),
  };

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `镜头描述: ${shot.visualTranslation}\n资产库: ${JSON.stringify(assetLibrary)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          characterIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          sceneIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          propIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['characterIds', 'sceneIds', 'propIds'],
      },
    },
  });

  return (safeJsonParse(response.text || '{"characterIds":[],"sceneIds":[],"propIds":[]}') as any) || {
    characterIds: [],
    sceneIds: [],
    propIds: [],
  };
}

export async function generateMatrixPrompts(shot: Shot, config: GlobalConfig): Promise<string[]> {
  const ai = getClient();
  const assetContext = getShotAssetContext(shot, config);
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `全局风格: ${config.artStyle}\n资产上下文: ${assetContext}\n镜头描述: ${shot.visualTranslation}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_MATRIX,
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
  });
  return (safeJsonParse(response.text || '[]') as any) || [];
}

export async function optimizePrompts(shot: Shot, config: GlobalConfig) {
  const ai = getClient();
  const assetContext = getShotAssetContext(shot, config);
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `全局风格: ${config.artStyle}\n资产上下文: ${assetContext}\n镜头描述: ${shot.visualTranslation}\n当前 Prompts: ${JSON.stringify(
      shot.matrixPrompts || [],
    )}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_OPTIMIZE,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          critique: { type: Type.STRING },
          suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          optimizedPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['critique', 'suggestions', 'optimizedPrompts'],
      },
    },
  });
  const result = (safeJsonParse(response.text || '{}') as any) || {};
  return {
    critique: result.critique || '',
    suggestions: result.suggestions || [],
    optimizedPrompts: result.optimizedPrompts || [],
  };
}

const IMAGE_PRESET_PREFIX = `[生成约束/不可省略]
- 输出必须忠实于镜头原文语义，不得擅自改写剧情
- 输出语言默认中文（镜头术语可为英文）
- 若提供参考图：必须理解并保持角色/场景/道具一致性
- 输出为一张 3x3 网格母图（9 格），每格为不同机位 Angle_01..Angle_09
`;

export async function generateGridImage(shot: Shot, config: GlobalConfig): Promise<string> {
  const ai = getClient();
  const prompts = shot.matrixPrompts || [];
  if (prompts.length !== 9) throw new Error('matrixPrompts must have 9 prompts (Angle_01..Angle_09)');

  const compositePrompt = `${IMAGE_PRESET_PREFIX}
全局风格: ${config.artStyle}
一致性: 角色、场景、道具在 9 格中必须保持一致。

九格内容分配：
Angle_01: ${prompts[0]}
Angle_02: ${prompts[1]}
Angle_03: ${prompts[2]}
Angle_04: ${prompts[3]}
Angle_05: ${prompts[4]}
Angle_06: ${prompts[5]}
Angle_07: ${prompts[6]}
Angle_08: ${prompts[7]}
Angle_09: ${prompts[8]}

输出要求：单张 3x3 网格母图，无明显网格线，视觉连贯。`;

  const parts: any[] = [];
  const selectedAssetsWithImages = [
    ...config.characters.filter((c) => shot.characterIds?.includes(c.id)),
    ...config.scenes.filter((s) => shot.sceneIds?.includes(s.id)),
    ...config.props.filter((p) => shot.propIds?.includes(p.id)),
  ].filter((a) => a.refImage);

  for (const asset of selectedAssetsWithImages) {
    const { base64, mimeType } = parseDataUri(asset.refImage!);
    const filename = `asset_${asset.id}.png`;

    let semantics = `参考图说明：图片文件名=${filename}。`;
    if (config.characters.some((c) => c.id === asset.id)) {
      semantics = `参考图说明（角色资产）：[角色名]${asset.name} ↔ [图片文件名]${filename}。用途=保持角色一致性（外观/服饰/特征）。`;
    } else if (config.scenes.some((s) => s.id === asset.id)) {
      semantics = `参考图说明（场景资产）：[参考：${filename}]。用途=保持场景一致性（环境/构图/光线）。`;
    } else if (config.props.some((p) => p.id === asset.id)) {
      semantics = `参考图说明（道具资产）：[参考图：${filename}]。用途=保持道具主体一致性（形态/材质/细节）。`;
    }

    parts.push({ inlineData: { data: base64, mimeType } });
    parts.push({ text: semantics });
  }

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: { parts: [...parts, { text: compositePrompt }] },
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: config.aspectRatio, imageSize: config.resolution as any },
    },
  });

  const candidate = response.candidates?.[0];
  const inline = candidate?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('Image generation returned no inline image data');

  const base64Png = inline.data;

  const { outputDir } = getAihubmixEnv();
  await fs.mkdir(path.join(outputDir, 'images'), { recursive: true });
  const hash = crypto.createHash('sha1').update(base64Png).digest('hex').slice(0, 12);
  await fs.writeFile(path.join(outputDir, 'images', `grid_${shot.id}_${hash}.png`), Buffer.from(base64Png, 'base64'));

  return `data:image/png;base64,${base64Png}`;
}

export async function enhanceAssetDescription(name: string, currentDesc: string): Promise<string> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `为“${name}”扩充视觉描述。原描述：“${currentDesc}”。覆盖材质、色彩、光影。只返回文字。`,
    config: { thinkingConfig: { thinkingBudget: 512 } },
  });
  return response.text || currentDesc;
}

export async function generateAssetImage(name: string, description: string, config: GlobalConfig): Promise<string> {
  const ai = getClient();
  const prompt = `${IMAGE_PRESET_PREFIX}\n[概念设计图]\n全局风格: ${config.artStyle}\n主体: ${name}\n细节: ${description}`;

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: '1K' as any },
    },
  });

  const candidate = response.candidates?.[0];
  const inline = candidate?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('Asset image generation returned no inline image data');
  return `data:image/png;base64,${inline.data}`;
}

export async function discoverMissingAssets(shot: Shot, config: GlobalConfig): Promise<DiscoverMissingAssetsResult> {
  const ai = getClient();
  const currentAssetNames = {
    characters: config.characters.map((c) => c.name),
    scenes: config.scenes.map((s) => s.name),
    props: config.props.map((p) => p.name),
  };

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `分析分镜：${shot.visualTranslation}\n已有库：${JSON.stringify(
      currentAssetNames,
    )}\n提取库中缺失的实体并描述（角色/场景/道具）。`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
              required: ['name', 'description'],
            },
          },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
              required: ['name', 'description'],
            },
          },
          props: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { name: { type: Type.STRING }, description: { type: Type.STRING } },
              required: ['name', 'description'],
            },
          },
        },
        required: ['characters', 'scenes', 'props'],
      },
    },
  });

  const result = (safeJsonParse(response.text || '{}') as any) || {};
  const normalize = (arr: any): MissingAssetCandidate[] =>
    Array.isArray(arr) ? arr.map((x) => ({ name: String(x?.name || ''), description: String(x?.description || '') })) : [];

  return {
    characters: normalize(result.characters),
    scenes: normalize(result.scenes),
    props: normalize(result.props),
  };
}
