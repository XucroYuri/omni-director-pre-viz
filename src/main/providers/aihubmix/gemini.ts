import { GoogleGenAI, Type } from '@google/genai';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BeatTableItem,
  GlobalConfig,
  SceneTableItem,
  ScriptAssetExtraction,
  ScriptBreakdownResponse,
  Shot,
  ShotScriptMapping,
} from '../../../shared/types';
import {
  buildAssetInjection,
  ensurePromptListLength,
  getAngleLabel,
  getBoundAssets,
  getGridCellCount,
  normalizeGridLayout,
} from '../../../shared/utils';
import type { DiscoverMissingAssetsResult, MissingAssetCandidate, RecommendAssetsResult } from '../../../shared/ipc';
import {
  IMAGE_MODEL,
  SYSTEM_INSTRUCTION_BREAKDOWN,
  SYSTEM_INSTRUCTION_MATRIX,
  SYSTEM_INSTRUCTION_OPTIMIZE,
  TEXT_MODEL,
} from '../../../shared/constants';
import {
  pickModel,
  pickModelByKeyword,
  runWithProviderFallback,
  type ProviderExecutionContext,
} from '../router';

type Json = Record<string, unknown> | unknown[];

const clientCache = new Map<string, GoogleGenAI>();

function getClient(ctx: ProviderExecutionContext) {
  if (ctx.transport !== 'gemini') {
    throw new Error(`Provider ${ctx.providerId} does not support Gemini transport for ${ctx.capability}.`);
  }

  const baseUrl = ctx.geminiBaseUrl?.trim() || '';
  const cacheKey = `${ctx.providerId}:${ctx.apiKey}@${baseUrl || 'google-default'}`;
  const existing = clientCache.get(cacheKey);
  if (existing) return existing;

  const options: ConstructorParameters<typeof GoogleGenAI>[0] = {
    apiKey: ctx.apiKey,
  };
  if (baseUrl) {
    options.httpOptions = { baseUrl };
  }

  const ai = new GoogleGenAI(options);
  clientCache.set(cacheKey, ai);
  return ai;
}

function uniqueModels(candidates: string[]): string[] {
  return [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
}

function shouldRetryWithNextModel(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('model') ||
    message.includes('not found') ||
    message.includes('unsupported') ||
    message.includes('404')
  );
}

async function runWithModelFallback<T>(
  models: string[],
  run: (model: string) => Promise<T>,
): Promise<T> {
  const queue = uniqueModels(models);
  let lastError: unknown = null;
  for (let index = 0; index < queue.length; index += 1) {
    const model = queue[index];
    try {
      return await run(model);
    } catch (error) {
      lastError = error;
      if (!shouldRetryWithNextModel(error) || index === queue.length - 1) {
        throw error;
      }
    }
  }
  throw lastError || new Error('No model candidates available.');
}

function llmModelCandidates(ctx: ProviderExecutionContext, preferred?: string): string[] {
  const pool = ctx.models.llm || [];
  if (preferred) {
    return uniqueModels([preferred, ...pool, TEXT_MODEL]);
  }
  return uniqueModels([pickModel(pool, TEXT_MODEL), ...pool, TEXT_MODEL]);
}

function imageModelCandidates(ctx: ProviderExecutionContext, preferred?: string): string[] {
  const pool = ctx.models.image || [];
  if (preferred) {
    return uniqueModels([preferred, ...pool, IMAGE_MODEL]);
  }
  return uniqueModels([pickModel(pool, IMAGE_MODEL), ...pool, IMAGE_MODEL]);
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

const MAX_SCRIPT_CHARS_FOR_ASSET_EXTRACTION = 32000;
const MAX_BEATS_PER_CHUNK = 6;

function splitScriptLines(script: string): string[] {
  return script
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '  ').trimEnd());
}

function isSceneHeading(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  return /^(INT\.?|EXT\.?|INT\/EXT\.?|I\/E\.?|内景|外景|内\/外景|内外景)/i.test(value);
}

function isTransitionLine(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  return /(?:CUT TO|FADE IN|FADE OUT|DISSOLVE TO|SMASH CUT|MATCH CUT|转场|切到|切至|镜头切换)/i.test(value);
}

function sceneLocationType(line: string): SceneTableItem['locationType'] {
  const value = line.trim().toUpperCase();
  if (/INT\/EXT|I\/E|内\/外景|内外景/.test(value)) return 'INT/EXT';
  if (/^INT|内景/.test(value)) return 'INT';
  if (/^EXT|外景/.test(value)) return 'EXT';
  return 'UNKNOWN';
}

function summarizeLine(line: string, max = 64): string {
  const value = line.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function buildSceneTable(lines: string[]): SceneTableItem[] {
  const headingIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (isSceneHeading(lines[index])) {
      headingIndexes.push(index);
    }
  }

  if (headingIndexes.length === 0) {
    const firstLine = lines.find((line) => line.trim()) || '';
    const lastLine = [...lines].reverse().find((line) => line.trim()) || firstLine;
    return [
      {
        id: 'SC_01',
        title: summarizeLine(firstLine || '未显式场景标题'),
        locationType: sceneLocationType(firstLine),
        startLine: 1,
        endLine: Math.max(1, lines.length),
        startLineText: firstLine || '',
        endLineText: lastLine || firstLine || '',
      },
    ];
  }

  return headingIndexes.map((headingIndex, sceneIndex) => {
    const startLine = headingIndex + 1;
    const endLine =
      sceneIndex + 1 < headingIndexes.length ? headingIndexes[sceneIndex + 1] : Math.max(1, lines.length);
    const endLineText =
      lines[Math.max(startLine - 1, endLine - 1)] && lines[endLine - 1]?.trim()
        ? lines[endLine - 1]
        : lines.slice(startLine - 1, endLine).reverse().find((line) => line.trim()) || lines[headingIndex];
    const title = summarizeLine(lines[headingIndex] || `Scene ${sceneIndex + 1}`);
    return {
      id: `SC_${String(sceneIndex + 1).padStart(2, '0')}`,
      title,
      locationType: sceneLocationType(lines[headingIndex]),
      startLine,
      endLine: Math.max(startLine, endLine),
      startLineText: lines[headingIndex] || '',
      endLineText: endLineText || lines[headingIndex] || '',
    };
  });
}

function buildBeatTable(lines: string[], scenes: SceneTableItem[]): BeatTableItem[] {
  const beats: BeatTableItem[] = [];

  const pushBeat = (scene: SceneTableItem, startLine: number, endLine: number) => {
    const contentLines = lines.slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
    const firstContent = contentLines.find((line) => line.trim()) || scene.startLineText;
    const lastContent = [...contentLines].reverse().find((line) => line.trim()) || firstContent;
    if (!firstContent.trim()) return;
    const beatIndex = beats.length + 1;
    beats.push({
      id: `BT_${String(beatIndex).padStart(3, '0')}`,
      sceneId: scene.id,
      summary: summarizeLine(firstContent, 80),
      startLine,
      endLine,
      startLineText: firstContent,
      endLineText: lastContent,
    });
  };

  for (const scene of scenes) {
    const start = Math.max(1, scene.startLine);
    const end = Math.max(start, scene.endLine);

    let beatStart = start;
    let nonEmptyCursor = start;
    let lastWasBlank = false;

    for (let lineNo = start; lineNo <= end; lineNo += 1) {
      const text = lines[lineNo - 1] || '';
      const isBlank = !text.trim();
      if (!isBlank) {
        nonEmptyCursor = lineNo;
      }

      const shouldCut = isTransitionLine(text) || (isBlank && lastWasBlank && lineNo - beatStart >= 4);
      if (shouldCut && nonEmptyCursor >= beatStart) {
        pushBeat(scene, beatStart, nonEmptyCursor);
        beatStart = lineNo + 1;
      }
      lastWasBlank = isBlank;
    }

    if (beatStart <= end) {
      pushBeat(scene, beatStart, Math.max(beatStart, nonEmptyCursor, end));
    }
  }

  if (beats.length === 0 && scenes.length > 0) {
    const firstScene = scenes[0];
    beats.push({
      id: 'BT_001',
      sceneId: firstScene.id,
      summary: summarizeLine(firstScene.startLineText || '节拍'),
      startLine: firstScene.startLine,
      endLine: firstScene.endLine,
      startLineText: firstScene.startLineText,
      endLineText: firstScene.endLineText,
    });
  }

  return beats;
}

function chunkBeats(beats: BeatTableItem[]): BeatTableItem[][] {
  const chunks: BeatTableItem[][] = [];
  for (let index = 0; index < beats.length; index += MAX_BEATS_PER_CHUNK) {
    chunks.push(beats.slice(index, index + MAX_BEATS_PER_CHUNK));
  }
  return chunks;
}

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  const mimeType = match[1];
  const base64 = match[2];
  return { mimeType, base64 };
}

function validateShotConsistency(shot: Shot, config: GlobalConfig) {
  const { scenes } = getBoundAssets(shot, config);
  if (scenes.length === 0) {
    throw new Error('POLICY_VIOLATION: Missing Scene Binding');
  }
}

function normalizeShotKind(value: unknown): Shot['shotKind'] {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CHAR') return 'CHAR';
  if (normalized === 'ENV') return 'ENV';
  if (normalized === 'POV') return 'POV';
  if (normalized === 'INSERT') return 'INSERT';
  return 'MIXED';
}

function extractLineWindow(lines: string[], startLine: number, endLine: number, maxLines = 18): string {
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.max(safeStart, endLine);
  const full = lines.slice(safeStart - 1, safeEnd);
  const windowed = full.length > maxLines ? full.slice(0, maxLines) : full;
  return windowed.map((line, offset) => `${safeStart + offset}. ${line}`).join('\n');
}

async function generateScriptOverview(
  ai: GoogleGenAI,
  llmCandidates: string[],
  script: string,
  scenes: SceneTableItem[],
  beats: BeatTableItem[],
): Promise<{ context: string; scriptOverview: string }> {
  const overviewResponse = await runWithModelFallback(llmCandidates, async (model) =>
    ai.models.generateContent({
      model,
      contents: [
        '任务1：快速通读并生成单集剧情概述（不超过220字）。',
        '任务2：总结主要冲突线索（3-6条）。',
        '任务3：总结影像制作关注点（3-6条，包含场景调度/情绪/节奏）。',
        `场景总数：${scenes.length}，节拍总数：${beats.length}`,
        '请务必仅基于原文，不得杜撰剧情。',
        script,
      ].join('\n\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            context: { type: Type.STRING },
            overview: { type: Type.STRING },
            storyAxes: { type: Type.ARRAY, items: { type: Type.STRING } },
            productionNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['context', 'overview', 'storyAxes', 'productionNotes'],
        },
      },
    }),
  );
  const parsed = (safeJsonParse(overviewResponse.text || '{}') as any) || {};
  const context = String(parsed.context || '').trim();
  const overview = String(parsed.overview || '').trim();
  const storyAxes = Array.isArray(parsed.storyAxes) ? parsed.storyAxes.map((item: unknown) => String(item || '').trim()) : [];
  const productionNotes = Array.isArray(parsed.productionNotes)
    ? parsed.productionNotes.map((item: unknown) => String(item || '').trim())
    : [];
  const scriptOverview = [overview, `冲突线索：${storyAxes.filter(Boolean).join(' / ')}`, `制作关注：${productionNotes.filter(Boolean).join(' / ')}`]
    .filter(Boolean)
    .join('\n');

  return {
    context: context || overview || '剧本拆解上下文',
    scriptOverview: scriptOverview || overview || context || '',
  };
}

async function extractScriptAssets(
  ai: GoogleGenAI,
  llmCandidates: string[],
  script: string,
): Promise<ScriptAssetExtraction> {
  const response = await runWithModelFallback(llmCandidates, async (model) =>
    ai.models.generateContent({
      model,
      contents: [
        '仅基于输入剧本提取角色、场景、道具三类视觉描述候选。',
        '禁止杜撰人物关系、外观、材质、时代背景。',
        '每条描述使用原文可证据化信息，不足时明确写“剧本未明确描述”。',
        script.slice(0, MAX_SCRIPT_CHARS_FOR_ASSET_EXTRACTION),
      ].join('\n\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
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
            scenes: {
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
            props: {
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
          required: ['characters', 'scenes', 'props'],
        },
      },
    }),
  );

  const parsed = (safeJsonParse(response.text || '{}') as any) || {};
  return {
    characters: Array.isArray(parsed.characters)
      ? parsed.characters.map((item: any) => ({ name: String(item?.name || '').trim(), description: String(item?.description || '').trim() })).filter((item: any) => item.name)
      : [],
    scenes: Array.isArray(parsed.scenes)
      ? parsed.scenes.map((item: any) => ({ name: String(item?.name || '').trim(), description: String(item?.description || '').trim() })).filter((item: any) => item.name)
      : [],
    props: Array.isArray(parsed.props)
      ? parsed.props.map((item: any) => ({ name: String(item?.name || '').trim(), description: String(item?.description || '').trim() })).filter((item: any) => item.name)
      : [],
  };
}

async function breakdownShotsForBeatChunk(
  ai: GoogleGenAI,
  llmCandidates: string[],
  params: {
    scriptLines: string[];
    scriptOverview: string;
    scenes: SceneTableItem[];
    beats: BeatTableItem[];
  },
): Promise<Array<{
  beatId: string;
  originalText: string;
  visualTranslation: string;
  contextTag: string;
  shotKind: Shot['shotKind'];
  scriptMapping: ShotScriptMapping;
}>> {
  const beatsPrompt = params.beats
    .map((beat) => {
      const scene = params.scenes.find((item) => item.id === beat.sceneId);
      return [
        `BeatId: ${beat.id}`,
        `Scene: ${scene?.title || beat.sceneId}`,
        `LineRange: ${beat.startLine}-${beat.endLine}`,
        `LineStart: ${beat.startLineText}`,
        `LineEnd: ${beat.endLineText}`,
        'Excerpt:',
        extractLineWindow(params.scriptLines, beat.startLine, beat.endLine),
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const response = await runWithModelFallback(llmCandidates, async (model) =>
    ai.models.generateContent({
      model,
      contents: [
        '你是影视分镜导演，请将每个 Beat 拆成 1~3 个镜头组（shots）。',
        '必须返回 JSON 数组，每个元素都必须包含 beatId, originalText, visualTranslation, contextTag, shotKind。',
        'shotKind 仅允许 CHAR / ENV / POV / INSERT / MIXED。',
        '并补充脚本映射字段：sceneHeading/action/characters/dialogue/parenthetical/transition/sfx/bgm/vfx/sourceStartLine/sourceEndLine。',
        '所有内容必须由输入节拍原文支持，禁止杜撰。',
        `全局压缩上下文:\n${params.scriptOverview}`,
        beatsPrompt,
      ].join('\n\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              beatId: { type: Type.STRING },
              originalText: { type: Type.STRING },
              visualTranslation: { type: Type.STRING },
              contextTag: { type: Type.STRING },
              shotKind: { type: Type.STRING },
              sceneHeading: { type: Type.STRING },
              action: { type: Type.STRING },
              characters: { type: Type.ARRAY, items: { type: Type.STRING } },
              dialogue: { type: Type.ARRAY, items: { type: Type.STRING } },
              parenthetical: { type: Type.ARRAY, items: { type: Type.STRING } },
              transition: { type: Type.STRING },
              sfx: { type: Type.ARRAY, items: { type: Type.STRING } },
              bgm: { type: Type.ARRAY, items: { type: Type.STRING } },
              vfx: { type: Type.ARRAY, items: { type: Type.STRING } },
              sourceStartLine: { type: Type.NUMBER },
              sourceEndLine: { type: Type.NUMBER },
            },
            required: ['beatId', 'originalText', 'visualTranslation', 'contextTag', 'shotKind'],
          },
        },
      },
    }),
  );

  const parsed = safeJsonParse(response.text || '[]');
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        beatId: String(row.beatId || '').trim(),
        originalText: String(row.originalText || '').trim(),
        visualTranslation: String(row.visualTranslation || '').trim(),
        contextTag: String(row.contextTag || '').trim(),
        shotKind: normalizeShotKind(row.shotKind),
        scriptMapping: {
          sceneHeading: String(row.sceneHeading || '').trim(),
          action: String(row.action || '').trim(),
          characters: Array.isArray(row.characters) ? row.characters.map((v) => String(v || '').trim()).filter(Boolean) : [],
          dialogue: Array.isArray(row.dialogue) ? row.dialogue.map((v) => String(v || '').trim()).filter(Boolean) : [],
          parenthetical: Array.isArray(row.parenthetical)
            ? row.parenthetical.map((v) => String(v || '').trim()).filter(Boolean)
            : [],
          transition: String(row.transition || '').trim(),
          sfx: Array.isArray(row.sfx) ? row.sfx.map((v) => String(v || '').trim()).filter(Boolean) : [],
          bgm: Array.isArray(row.bgm) ? row.bgm.map((v) => String(v || '').trim()).filter(Boolean) : [],
          vfx: Array.isArray(row.vfx) ? row.vfx.map((v) => String(v || '').trim()).filter(Boolean) : [],
          sourceStartLine:
            typeof row.sourceStartLine === 'number' ? Math.max(1, Math.round(row.sourceStartLine)) : undefined,
          sourceEndLine: typeof row.sourceEndLine === 'number' ? Math.max(1, Math.round(row.sourceEndLine)) : undefined,
        },
      };
    })
    .filter((item) => item.beatId && item.visualTranslation && item.contextTag);
}

function fallbackShotsFromBeats(beats: BeatTableItem[]): ScriptBreakdownResponse['shots'] {
  return beats.map((beat, index) => {
    const gridLayout = normalizeGridLayout();
    const cellCount = getGridCellCount(gridLayout);
    return {
      id: `sh_${String(index + 1).padStart(4, '0')}`,
      beatId: beat.id,
      sceneId: beat.sceneId,
      originalText: beat.startLineText,
      visualTranslation: beat.summary,
      contextTag: '节拍',
      shotKind: 'MIXED' as const,
      scriptMapping: {
        sourceStartLine: beat.startLine,
        sourceEndLine: beat.endLine,
      },
      gridLayout,
      matrixPrompts: Array(cellCount).fill(''),
      status: 'pending' as const,
      progress: 0,
      characterIds: [],
      sceneIds: [],
      propIds: [],
      videoUrls: Array(cellCount).fill(null),
      videoStatus: Array(cellCount).fill('idle'),
    };
  });
}

export async function breakdownScript(script: string, config: GlobalConfig): Promise<ScriptBreakdownResponse> {
  return runWithProviderFallback({
    capability: 'llm',
    preferredProvider: config.apiProvider,
    taskName: 'breakdownScript',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const scriptLines = splitScriptLines(script);
      const sceneTable = buildSceneTable(scriptLines);
      const beatTable = buildBeatTable(scriptLines, sceneTable);
      const llmCandidates = llmModelCandidates(ctx);
      const overviewCandidates = llmModelCandidates(
        ctx,
        pickModelByKeyword(ctx.models.llm, 'flash', llmCandidates[0] || TEXT_MODEL),
      );

      const overview = await generateScriptOverview(ai, overviewCandidates, script, sceneTable, beatTable);
      const extractedAssets = await extractScriptAssets(ai, llmCandidates, script).catch(() => ({
        characters: [],
        scenes: [],
        props: [],
      }));

      const shotDrafts: Array<{
        beatId: string;
        originalText: string;
        visualTranslation: string;
        contextTag: string;
        shotKind: Shot['shotKind'];
        scriptMapping: ShotScriptMapping;
      }> = [];

      for (const beatChunk of chunkBeats(beatTable)) {
        try {
          const chunkShots = await breakdownShotsForBeatChunk(ai, llmCandidates, {
            scriptLines,
            scriptOverview: overview.scriptOverview,
            scenes: sceneTable,
            beats: beatChunk,
          });
          shotDrafts.push(...chunkShots);
        } catch (error) {
          console.warn('Shot chunk breakdown failed, fallback to beat-level shot.', error);
        }
      }

      const fallbackShots = fallbackShotsFromBeats(beatTable);
      const shots =
        shotDrafts.length > 0
          ? shotDrafts.map((item, index) => {
              const beat = beatTable.find((row) => row.id === item.beatId);
              const gridLayout = normalizeGridLayout();
              const cellCount = getGridCellCount(gridLayout);
              return {
                id: `sh_${String(index + 1).padStart(4, '0')}`,
                originalText: item.originalText || beat?.startLineText || '',
                visualTranslation: item.visualTranslation,
                contextTag: item.contextTag || '镜头',
                sceneId: beat?.sceneId,
                beatId: item.beatId,
                scriptMapping: {
                  ...item.scriptMapping,
                  sourceStartLine: item.scriptMapping.sourceStartLine || beat?.startLine,
                  sourceEndLine: item.scriptMapping.sourceEndLine || beat?.endLine,
                },
                shotKind: item.shotKind || 'MIXED',
                gridLayout,
                matrixPrompts: Array(cellCount).fill(''),
                status: 'pending' as const,
                progress: 0,
                characterIds: [],
                sceneIds: [],
                propIds: [],
                videoUrls: Array(cellCount).fill(null),
                videoStatus: Array(cellCount).fill('idle'),
              };
            })
          : fallbackShots;

      return {
        context: overview.context || SYSTEM_INSTRUCTION_BREAKDOWN.trim(),
        scriptOverview: overview.scriptOverview,
        sceneTable,
        beatTable,
        extractedAssets,
        shots,
        characters: extractedAssets.characters.map((item) => ({ name: item.name, description: item.description })),
      };
    },
  });
}

export async function recommendAssets(shot: Shot, config: GlobalConfig): Promise<RecommendAssetsResult> {
  return runWithProviderFallback({
    capability: 'llm',
    preferredProvider: config.apiProvider,
    taskName: 'recommendAssets',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const assetLibrary = {
        characters: config.characters.map((c) => ({ id: c.id, name: c.name, description: c.description })),
        scenes: config.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description })),
        props: config.props.map((p) => ({ id: p.id, name: p.name, description: p.description })),
      };

      const response = await runWithModelFallback(llmModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
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
        }),
      );

      return (safeJsonParse(response.text || '{"characterIds":[],"sceneIds":[],"propIds":[]}') as any) || {
        characterIds: [],
        sceneIds: [],
        propIds: [],
      };
    },
  });
}

export async function generateMatrixPrompts(shot: Shot, config: GlobalConfig): Promise<string[]> {
  return runWithProviderFallback({
    capability: 'llm',
    preferredProvider: config.apiProvider,
    taskName: 'generateMatrixPrompts',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const gridLayout = normalizeGridLayout(shot.gridLayout);
      const cellCount = getGridCellCount(gridLayout);
      const assetInjection = buildAssetInjection(shot, config);
      const assetLine = assetInjection ? `资产绑定: ${assetInjection}` : '资产绑定: 无';
      const response = await runWithModelFallback(llmModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
          contents: [
            `全局风格: ${config.artStyle}`,
            assetLine,
            `网格规格: ${gridLayout.rows}x${gridLayout.cols}（共 ${cellCount} 格）`,
            `镜头描述: ${shot.visualTranslation}`,
            `请返回 ${cellCount} 条 Prompt，顺序严格为 ${Array.from({ length: cellCount }, (_item, index) => getAngleLabel(index)).join(', ')}`,
          ].join('\n'),
          config: {
            systemInstruction: SYSTEM_INSTRUCTION_MATRIX,
            responseMimeType: 'application/json',
            responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        }),
      );
      const parsed = safeJsonParse(response.text || '[]');
      const rawPrompts = Array.isArray(parsed) ? parsed.map((item) => String(item || '')) : [];
      return ensurePromptListLength(rawPrompts, gridLayout).map((prompt, index) => {
        const label = getAngleLabel(index);
        const trimmed = prompt.trim();
        if (!trimmed) return `${label}: ${shot.visualTranslation}`;
        return /^Angle_\d+\s*[:：]/i.test(trimmed) ? trimmed : `${label}: ${trimmed}`;
      });
    },
  });
}

export async function optimizePrompts(shot: Shot, config: GlobalConfig) {
  return runWithProviderFallback({
    capability: 'llm',
    preferredProvider: config.apiProvider,
    taskName: 'optimizePrompts',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const assetInjection = buildAssetInjection(shot, config);
      const assetLine = assetInjection ? `资产绑定: ${assetInjection}` : '资产绑定: 无';
      const response = await runWithModelFallback(llmModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
          contents: `全局风格: ${config.artStyle}\n${assetLine}\n镜头描述: ${shot.visualTranslation}\n当前 Prompts: ${JSON.stringify(
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
        }),
      );
      const result = (safeJsonParse(response.text || '{}') as any) || {};
      return {
        critique: result.critique || '',
        suggestions: result.suggestions || [],
        optimizedPrompts: result.optimizedPrompts || [],
      };
    },
  });
}

const IMAGE_PRESET_PREFIX = `[生成约束/不可省略]
- 输出必须忠实于镜头原文语义，不得擅自改写剧情
- 输出语言默认中文（镜头术语可为英文）
- 若提供参考图：必须理解并保持角色/场景/道具一致性
- 输出为一张网格母图，每格对应一个机位 Angle_01..Angle_N
`;

export async function generateGridImage(
  shot: Shot,
  config: GlobalConfig,
  signal?: AbortSignal,
): Promise<{ path: string; dataUri: string }> {
  return runWithProviderFallback({
    capability: 'image',
    preferredProvider: config.apiProvider,
    taskName: 'generateGridImage',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const gridLayout = normalizeGridLayout(shot.gridLayout);
      const cellCount = getGridCellCount(gridLayout);
      const prompts = ensurePromptListLength(shot.matrixPrompts, gridLayout);
      if (!prompts.some((prompt) => prompt.trim())) {
        throw new Error('matrixPrompts cannot be empty');
      }

      validateShotConsistency(shot, config);
      const assetInjection = buildAssetInjection(shot, config);
      const assetLine = assetInjection ? `资产绑定: ${assetInjection}` : '资产绑定: 无';
      const angleLines = prompts.map((prompt, index) => `${getAngleLabel(index)}: ${prompt || shot.visualTranslation}`).join('\n');

      const compositePrompt = `${IMAGE_PRESET_PREFIX}
全局风格: ${config.artStyle}
${assetLine}
网格规格: ${gridLayout.rows} 行 x ${gridLayout.cols} 列（共 ${cellCount} 格）
一致性: 角色、场景、道具在所有网格中必须保持一致。

网格内容分配：
${angleLines}

输出要求：单张 ${gridLayout.rows}x${gridLayout.cols} 网格母图，无明显网格线，视觉连贯。`;

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

      const response = await runWithModelFallback(imageModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
          contents: { parts: [...parts, { text: compositePrompt }] },
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: config.aspectRatio, imageSize: config.resolution as any },
            abortSignal: signal,
          },
        }),
      );

      const candidate = response.candidates?.[0];
      const inline = candidate?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
      if (!inline?.data) throw new Error('Image generation returned no inline image data');

      const base64Png = inline.data;
      await fs.mkdir(path.join(ctx.outputDir, 'images'), { recursive: true });
      const hash = crypto.createHash('sha1').update(base64Png).digest('hex').slice(0, 12);
      const filePath = path.join(ctx.outputDir, 'images', `grid_${shot.id}_${hash}.png`);
      await fs.writeFile(filePath, Buffer.from(base64Png, 'base64'));

      return { path: filePath, dataUri: `data:image/png;base64,${base64Png}` };
    },
  });
}

export async function enhanceAssetDescription(name: string, currentDesc: string): Promise<string> {
  return runWithProviderFallback({
    capability: 'llm',
    taskName: 'enhanceAssetDescription',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const response = await runWithModelFallback(llmModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
          contents: `为“${name}”扩充视觉描述。原描述：“${currentDesc}”。覆盖材质、色彩、光影。只返回文字。`,
          config: { thinkingConfig: { thinkingBudget: 512 } },
        }),
      );
      return response.text || currentDesc;
    },
  });
}

export async function generateAssetImage(
  name: string,
  description: string,
  config: GlobalConfig,
  signal?: AbortSignal,
): Promise<{ path: string; dataUri: string }> {
  return runWithProviderFallback({
    capability: 'image',
    preferredProvider: config.apiProvider,
    taskName: 'generateAssetImage',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const prompt = `${IMAGE_PRESET_PREFIX}\n[概念设计图]\n全局风格: ${config.artStyle}\n主体: ${name}\n细节: ${description}`;

      const response = await runWithModelFallback(imageModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '1:1', imageSize: '1K' as any },
            abortSignal: signal,
          },
        }),
      );

      const candidate = response.candidates?.[0];
      const inline = candidate?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
      if (!inline?.data) throw new Error('Asset image generation returned no inline image data');

      await fs.mkdir(path.join(ctx.outputDir, 'assets'), { recursive: true });
      const safeName = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
      const hash = crypto.createHash('sha1').update(inline.data).digest('hex').slice(0, 12);
      const fileName = `asset_${safeName || 'item'}_${hash}.png`;
      const filePath = path.join(ctx.outputDir, 'assets', fileName);
      await fs.writeFile(filePath, Buffer.from(inline.data, 'base64'));

      return { path: filePath, dataUri: `data:image/png;base64,${inline.data}` };
    },
  });
}

export async function discoverMissingAssets(shot: Shot, config: GlobalConfig): Promise<DiscoverMissingAssetsResult> {
  return runWithProviderFallback({
    capability: 'llm',
    preferredProvider: config.apiProvider,
    taskName: 'discoverMissingAssets',
    operation: async (ctx) => {
      const ai = getClient(ctx);
      const currentAssetNames = {
        characters: config.characters.map((c) => c.name),
        scenes: config.scenes.map((s) => s.name),
        props: config.props.map((p) => p.name),
      };

      const response = await runWithModelFallback(llmModelCandidates(ctx), (model) =>
        ai.models.generateContent({
          model,
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
        }),
      );

      const result = (safeJsonParse(response.text || '{}') as any) || {};
      const normalize = (arr: any): MissingAssetCandidate[] =>
        Array.isArray(arr)
          ? arr.map((x) => ({ name: String(x?.name || ''), description: String(x?.description || '') }))
          : [];

      return {
        characters: normalize(result.characters),
        scenes: normalize(result.scenes),
        props: normalize(result.props),
      };
    },
  });
}
