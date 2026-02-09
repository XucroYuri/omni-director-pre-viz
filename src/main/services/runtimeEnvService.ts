import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import {
  DEFAULT_PROVIDER_BASE_URLS,
  DEFAULT_PROVIDER_MODELS,
  createDefaultRuntimeEnvConfig,
} from '../../shared/constants';
import type {
  AICapability,
  ApiProvider,
  ProviderId,
  ProviderModelMap,
  ProviderRuntimeConfig,
  RuntimeEnvConfig,
} from '../../shared/types';

const PROVIDER_IDS: ProviderId[] = ['aihubmix', 'gemini', 'volcengine'];
const CAPABILITIES: AICapability[] = ['llm', 'image', 'video', 'tts', 'music', 'sfx'];

const PROVIDER_ENV: Record<
  ProviderId,
  {
    singleKey: string;
    keys: string;
    geminiBaseUrl: string;
    openaiBaseUrl: string;
    enabled: string;
    priority: string;
    modelPrefix: string;
  }
> = {
  aihubmix: {
    singleKey: 'AIHUBMIX_API_KEY',
    keys: 'AIHUBMIX_API_KEYS',
    geminiBaseUrl: 'AIHUBMIX_GEMINI_BASE_URL',
    openaiBaseUrl: 'AIHUBMIX_OPENAI_BASE_URL',
    enabled: 'OMNI_AIHUBMIX_ENABLED',
    priority: 'OMNI_AIHUBMIX_PRIORITY',
    modelPrefix: 'AIHUBMIX',
  },
  gemini: {
    singleKey: 'GEMINI_API_KEY',
    keys: 'GEMINI_API_KEYS',
    geminiBaseUrl: 'GEMINI_BASE_URL',
    openaiBaseUrl: 'GEMINI_OPENAI_BASE_URL',
    enabled: 'OMNI_GEMINI_ENABLED',
    priority: 'OMNI_GEMINI_PRIORITY',
    modelPrefix: 'GEMINI',
  },
  volcengine: {
    singleKey: 'VOLCENGINE_API_KEY',
    keys: 'VOLCENGINE_API_KEYS',
    geminiBaseUrl: 'VOLCENGINE_GEMINI_BASE_URL',
    openaiBaseUrl: 'VOLCENGINE_OPENAI_BASE_URL',
    enabled: 'OMNI_VOLCENGINE_ENABLED',
    priority: 'OMNI_VOLCENGINE_PRIORITY',
    modelPrefix: 'VOLCENGINE',
  },
};

type LegacyRuntimeEnvInput = Partial<RuntimeEnvConfig> & {
  aihubmixApiKey?: unknown;
  aihubmixApiKeys?: unknown;
  geminiApiKey?: unknown;
  geminiApiKeys?: unknown;
  volcengineApiKey?: unknown;
  volcengineApiKeys?: unknown;
  geminiBaseUrl?: unknown;
  openaiBaseUrl?: unknown;
  aihubmixGeminiBaseUrl?: unknown;
  aihubmixOpenaiBaseUrl?: unknown;
  geminiOpenaiBaseUrl?: unknown;
  volcengineGeminiBaseUrl?: unknown;
  volcengineOpenaiBaseUrl?: unknown;
};

function getRuntimeEnvFilePath() {
  return path.join(app.getPath('userData'), 'runtime-env.json');
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function splitListString(raw: string): string[] {
  return raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseStringList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return uniq(
      input
        .map((item) => toTrimmedString(item))
        .filter(Boolean),
    );
  }
  if (typeof input === 'string') {
    return uniq(splitListString(input));
  }
  return [];
}

function parseBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    const lowered = input.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'off'].includes(lowered)) return false;
  }
  return fallback;
}

function parsePriority(input: unknown, fallback: number): number {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    return Math.round(input);
  }
  if (typeof input === 'string') {
    const parsed = Number(input.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return fallback;
}

function parseApiProvider(value: unknown): ApiProvider | undefined {
  if (value === 'auto' || value === 'aihubmix' || value === 'gemini' || value === 'volcengine') {
    return value;
  }
  return undefined;
}

function sanitizeModelMap(input: unknown, fallback: ProviderModelMap): ProviderModelMap {
  const source = typeof input === 'object' && input ? (input as Partial<Record<AICapability, unknown>>) : {};
  const next: ProviderModelMap = {
    llm: parseStringList(source.llm),
    image: parseStringList(source.image),
    video: parseStringList(source.video),
    tts: parseStringList(source.tts),
    music: parseStringList(source.music),
    sfx: parseStringList(source.sfx),
  };

  for (const capability of CAPABILITIES) {
    if (next[capability].length === 0) {
      next[capability] = [...fallback[capability]];
    }
  }

  return next;
}

function parseRuntimeEnvFile(content: string): LegacyRuntimeEnvInput {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === 'object' && parsed ? (parsed as LegacyRuntimeEnvInput) : {};
  } catch {
    return {};
  }
}

function readRuntimeEnvFile(): LegacyRuntimeEnvInput {
  const filePath = getRuntimeEnvFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseRuntimeEnvFile(content);
  } catch {
    return {};
  }
}

function getLegacyProviderInput(input: LegacyRuntimeEnvInput, providerId: ProviderId): Partial<ProviderRuntimeConfig> {
  if (providerId === 'aihubmix') {
    return {
      apiKeys: parseStringList(input.aihubmixApiKeys).concat(parseStringList(input.aihubmixApiKey)),
      geminiBaseUrl: toTrimmedString(input.aihubmixGeminiBaseUrl || input.geminiBaseUrl) || undefined,
      openaiBaseUrl: toTrimmedString(input.aihubmixOpenaiBaseUrl || input.openaiBaseUrl) || undefined,
    };
  }
  if (providerId === 'gemini') {
    return {
      apiKeys: parseStringList(input.geminiApiKeys).concat(parseStringList(input.geminiApiKey)),
      geminiBaseUrl: toTrimmedString(input.geminiBaseUrl) || undefined,
      openaiBaseUrl: toTrimmedString(input.geminiOpenaiBaseUrl) || undefined,
    };
  }
  return {
    apiKeys: parseStringList(input.volcengineApiKeys).concat(parseStringList(input.volcengineApiKey)),
    geminiBaseUrl: toTrimmedString(input.volcengineGeminiBaseUrl) || undefined,
    openaiBaseUrl: toTrimmedString(input.volcengineOpenaiBaseUrl) || undefined,
  };
}

function sanitizeProviderConfig(
  providerId: ProviderId,
  source: unknown,
  fallback: ProviderRuntimeConfig,
): ProviderRuntimeConfig {
  const raw = typeof source === 'object' && source ? (source as Partial<ProviderRuntimeConfig>) : {};
  return {
    enabled: parseBool(raw.enabled, fallback.enabled),
    priority: parsePriority(raw.priority, fallback.priority),
    apiKeys: uniq(parseStringList(raw.apiKeys)),
    geminiBaseUrl:
      toTrimmedString(raw.geminiBaseUrl) || DEFAULT_PROVIDER_BASE_URLS[providerId].geminiBaseUrl || '',
    openaiBaseUrl:
      toTrimmedString(raw.openaiBaseUrl) || DEFAULT_PROVIDER_BASE_URLS[providerId].openaiBaseUrl || '',
    models: sanitizeModelMap(raw.models, DEFAULT_PROVIDER_MODELS[providerId]),
  };
}

function sanitizeRuntimeEnvConfig(input: LegacyRuntimeEnvInput): RuntimeEnvConfig {
  const defaults = createDefaultRuntimeEnvConfig();
  const providerSources = (input.providers || {}) as Partial<Record<ProviderId, unknown>>;

  const providers: RuntimeEnvConfig['providers'] = {
    aihubmix: sanitizeProviderConfig(
      'aihubmix',
      providerSources.aihubmix || getLegacyProviderInput(input, 'aihubmix'),
      defaults.providers.aihubmix,
    ),
    gemini: sanitizeProviderConfig(
      'gemini',
      providerSources.gemini || getLegacyProviderInput(input, 'gemini'),
      defaults.providers.gemini,
    ),
    volcengine: sanitizeProviderConfig(
      'volcengine',
      providerSources.volcengine || getLegacyProviderInput(input, 'volcengine'),
      defaults.providers.volcengine,
    ),
  };

  const apiProvider = parseApiProvider(input.apiProvider) || defaults.apiProvider;

  if (!providers.aihubmix.enabled && !providers.gemini.enabled && !providers.volcengine.enabled) {
    providers.aihubmix.enabled = true;
  }
  if (apiProvider !== 'auto') {
    providers[apiProvider].enabled = true;
  }

  return { apiProvider, providers };
}

function mergeRuntimeEnvWithProcess(persisted: LegacyRuntimeEnvInput): RuntimeEnvConfig {
  const merged = sanitizeRuntimeEnvConfig(persisted);
  const envApiProvider = parseApiProvider(process.env.OMNI_API_PROVIDER);
  if (envApiProvider) {
    merged.apiProvider = envApiProvider;
  }

  for (const providerId of PROVIDER_IDS) {
    const envMeta = PROVIDER_ENV[providerId];
    const provider = merged.providers[providerId];

    const envKeys = parseStringList(process.env[envMeta.keys]);
    const envSingleKey = toTrimmedString(process.env[envMeta.singleKey]);
    if (envKeys.length > 0) {
      provider.apiKeys = envKeys;
    } else if (envSingleKey) {
      provider.apiKeys = [envSingleKey];
    }

    const envGeminiBase = toTrimmedString(process.env[envMeta.geminiBaseUrl]);
    if (envGeminiBase) provider.geminiBaseUrl = envGeminiBase;
    const envOpenaiBase = toTrimmedString(process.env[envMeta.openaiBaseUrl]);
    if (envOpenaiBase) provider.openaiBaseUrl = envOpenaiBase;

    provider.enabled = parseBool(process.env[envMeta.enabled], provider.enabled);
    provider.priority = parsePriority(process.env[envMeta.priority], provider.priority);

    for (const capability of CAPABILITIES) {
      const envModelList = parseStringList(
        process.env[`${envMeta.modelPrefix}_${capability.toUpperCase()}_MODELS`],
      );
      if (envModelList.length > 0) {
        provider.models[capability] = envModelList;
      }
    }
  }

  if (merged.apiProvider !== 'auto') {
    merged.providers[merged.apiProvider].enabled = true;
  }

  if (!PROVIDER_IDS.some((providerId) => merged.providers[providerId].enabled)) {
    merged.providers.aihubmix.enabled = true;
  }

  return merged;
}

function setOrDeleteEnv(name: string, value: string | undefined) {
  if (value && value.trim()) {
    process.env[name] = value.trim();
    return;
  }
  delete process.env[name];
}

function applyRuntimeEnvToProcess(config: RuntimeEnvConfig) {
  process.env.OMNI_API_PROVIDER = config.apiProvider;

  for (const providerId of PROVIDER_IDS) {
    const provider = config.providers[providerId];
    const envMeta = PROVIDER_ENV[providerId];
    const keys = uniq(parseStringList(provider.apiKeys));
    const primaryKey = keys[0] || '';

    setOrDeleteEnv(envMeta.keys, keys.join(','));
    setOrDeleteEnv(envMeta.singleKey, primaryKey || undefined);
    setOrDeleteEnv(envMeta.geminiBaseUrl, provider.geminiBaseUrl || undefined);
    setOrDeleteEnv(envMeta.openaiBaseUrl, provider.openaiBaseUrl || undefined);
    process.env[envMeta.enabled] = provider.enabled ? '1' : '0';
    process.env[envMeta.priority] = String(Math.max(1, Math.round(provider.priority || 1)));

    for (const capability of CAPABILITIES) {
      const envName = `${envMeta.modelPrefix}_${capability.toUpperCase()}_MODELS`;
      const models = uniq(parseStringList(provider.models[capability]));
      setOrDeleteEnv(envName, models.length > 0 ? models.join(',') : undefined);
    }
  }
}

function writeRuntimeEnvFile(config: RuntimeEnvConfig) {
  const filePath = getRuntimeEnvFilePath();
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function loadRuntimeEnvOverrides() {
  const persisted = readRuntimeEnvFile();
  const merged = mergeRuntimeEnvWithProcess(persisted);
  applyRuntimeEnvToProcess(merged);
}

export function getRuntimeEnvConfig(): RuntimeEnvConfig {
  const persisted = readRuntimeEnvFile();
  return mergeRuntimeEnvWithProcess(persisted);
}

export function saveRuntimeEnvConfig(input: RuntimeEnvConfig): RuntimeEnvConfig {
  const next = sanitizeRuntimeEnvConfig(input);
  writeRuntimeEnvFile(next);
  applyRuntimeEnvToProcess(next);
  return next;
}
