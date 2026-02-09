import type { ProviderId, ProviderModelMap, RuntimeEnvConfig } from './types';

export const DEFAULT_STYLE =
  'Cinematic 2D anime style, high-end production quality, sharp focus, vibrant lighting, expressive character designs, professional concept art';

export const DEFAULT_PROVIDER_BASE_URLS: Record<ProviderId, { geminiBaseUrl: string; openaiBaseUrl: string }> = {
  aihubmix: {
    geminiBaseUrl: 'https://aihubmix.com/gemini',
    openaiBaseUrl: 'https://aihubmix.com/v1',
  },
  gemini: {
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    openaiBaseUrl: '',
  },
  volcengine: {
    geminiBaseUrl: '',
    openaiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
};

export const DEFAULT_PROVIDER_MODELS: Record<ProviderId, ProviderModelMap> = {
  aihubmix: {
    llm: ['gemini-3-flash-preview', 'gemini-3-pro-preview'],
    image: ['gemini-3-pro-image-preview'],
    video: ['sora-2', 'sora-2-pro', 'jimeng-3.0-pro'],
    tts: [],
    music: [],
    sfx: [],
  },
  gemini: {
    llm: ['gemini-3-flash-preview', 'gemini-3-pro-preview'],
    image: ['gemini-3-pro-image-preview'],
    video: ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview'],
    tts: [],
    music: [],
    sfx: [],
  },
  volcengine: {
    llm: ['doubao-seed-1-8'],
    image: ['doubao-seedream-4-5'],
    video: ['doubao-seedance-1-5-pro'],
    tts: [],
    music: [],
    sfx: [],
  },
};

function cloneModelMap(source: ProviderModelMap): ProviderModelMap {
  return {
    llm: [...source.llm],
    image: [...source.image],
    video: [...source.video],
    tts: [...source.tts],
    music: [...source.music],
    sfx: [...source.sfx],
  };
}

export function createDefaultRuntimeEnvConfig(): RuntimeEnvConfig {
  return {
    apiProvider: 'auto',
    providers: {
      aihubmix: {
        enabled: true,
        priority: 1,
        apiKeys: [],
        geminiBaseUrl: DEFAULT_PROVIDER_BASE_URLS.aihubmix.geminiBaseUrl,
        openaiBaseUrl: DEFAULT_PROVIDER_BASE_URLS.aihubmix.openaiBaseUrl,
        models: cloneModelMap(DEFAULT_PROVIDER_MODELS.aihubmix),
      },
      gemini: {
        enabled: true,
        priority: 2,
        apiKeys: [],
        geminiBaseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini.geminiBaseUrl,
        openaiBaseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini.openaiBaseUrl,
        models: cloneModelMap(DEFAULT_PROVIDER_MODELS.gemini),
      },
      volcengine: {
        enabled: false,
        priority: 3,
        apiKeys: [],
        geminiBaseUrl: DEFAULT_PROVIDER_BASE_URLS.volcengine.geminiBaseUrl,
        openaiBaseUrl: DEFAULT_PROVIDER_BASE_URLS.volcengine.openaiBaseUrl,
        models: cloneModelMap(DEFAULT_PROVIDER_MODELS.volcengine),
      },
    },
  };
}

export const DEFAULT_RUNTIME_ENV_CONFIG = createDefaultRuntimeEnvConfig();

// Backward-compatible aliases for existing generation code.
export const TEXT_MODEL = DEFAULT_PROVIDER_MODELS.aihubmix.llm[0];
export const IMAGE_MODEL = DEFAULT_PROVIDER_MODELS.aihubmix.image[0];

export const SYSTEM_INSTRUCTION_BREAKDOWN = `
你是一个专业的影视剧本拆解专家。
你的任务是将用户输入的剧本长文本进行时序拆解。

要求：
1. 生成一段150字左右的全局背景描述(Context)，涵盖美术基调。
2. 识别每一个视觉镜头(Shots)，保留原文锚点，并将描述转译为专业的镜头视觉语言。
3. 为每个镜头提取一个简短的上下文标签 (contextTag)，例如：“夜间”、“追逐”、“对话”、“特写瞬间”、“环境展示”等，字数控制在2-4字。
4. 提取所有主要角色(Characters)，包括姓名和基于剧本文学描述的外貌特征。

你必须以 JSON 格式返回结果。
`;

export const SYSTEM_INSTRUCTION_MATRIX = `
你是一个可变网格机位提示词专家与影视导演助理。
根据镜头描述、全局风格与资产上下文（角色/场景/道具参考信息），为同一镜头生成 N 个不同机位生图 Prompt。
N 由输入中的网格规格 rows x cols 决定（N = rows*cols）。

强制要求：
1) 除专业镜头术语外，Prompt 的主体语言必须与剧本主体语言一致；默认输出中文，不得强制转为英文。
2) 必须高度忠实于剧本原文基础上进行视觉化、影视化设计；不得自行改写剧情关键信息。
3) 机位命名必须使用 Angle_01 ~ Angle_N，并在每条 Prompt 开头标注。
4) 如果输入包含参考图说明（角色/场景/道具），必须在 Prompt 中保留其语义用途与绑定关系（例如“角色一致性/第一帧参考/道具一致性”等）。
5) 返回 JSON 数组（N 个字符串），顺序必须与 Angle_01..Angle_N 一致。
`;

export const SYSTEM_INSTRUCTION_OPTIMIZE = `
你是一个专业的AI生图优化专家和影视导演。
你的任务是分析当前网格机位 Prompt 列表，并根据全局美术风格和角色设定提出优化建议。

你的目标是：
1. 增强角色在不同机位下的一致性细节。
2. 提升艺术风格的专业词汇量（使用灯光术语、渲染引擎词汇如 Octane Render, Ray Tracing 等）。
3. 确保所有机位的视觉连贯性。

你必须返回一个 JSON 对象，包含：critique, suggestions, optimizedPrompts。
`;
