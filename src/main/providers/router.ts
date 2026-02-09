import * as path from 'node:path';
import { app } from 'electron';
import type { AICapability, ApiProvider, ProviderId, ProviderRuntimeConfig } from '../../shared/types';
import { getRuntimeEnvConfig } from '../services/runtimeEnvService';

const PROVIDER_IDS: ProviderId[] = ['aihubmix', 'gemini', 'volcengine'];

type ProviderTransport = 'gemini' | 'openai-video';

type AttemptFailure = {
  providerId: ProviderId;
  reason: 'disabled' | 'unsupported' | 'missing_key' | 'failed';
  error?: string;
};

const keyPoolCursor = new Map<string, number>();
const keyLoads = new Map<string, number>();

export class MissingApiCredentialError extends Error {
  readonly code = 'API_CREDENTIAL_MISSING';

  constructor(message: string) {
    super(message);
    this.name = 'MissingApiCredentialError';
  }
}

export class ProviderFallbackError extends Error {
  readonly code = 'PROVIDER_FALLBACK_EXHAUSTED';
  readonly attempts: AttemptFailure[];

  constructor(message: string, attempts: AttemptFailure[]) {
    super(message);
    this.name = 'ProviderFallbackError';
    this.attempts = attempts;
  }
}

export function isMissingApiCredentialError(error: unknown): boolean {
  if (error instanceof MissingApiCredentialError) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  if (code === 'API_CREDENTIAL_MISSING') return true;
  return /Missing\s+API\s+key/i.test(error.message);
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || /aborted/i.test(error.message);
}

function shouldStopFallback(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return isAbortError(error) || /POLICY_VIOLATION/i.test(message);
}

function keyPoolId(providerId: ProviderId, keys: string[]): string {
  return `${providerId}:${keys.join('|')}`;
}

function keyLoadToken(poolId: string, index: number): string {
  return `${poolId}#${index}`;
}

function getKeyAttemptOrder(poolId: string, keyCount: number): number[] {
  if (keyCount <= 1) return [0];
  const start = keyPoolCursor.get(poolId) || 0;
  const rotated = Array.from({ length: keyCount }, (_item, offset) => (start + offset) % keyCount);
  keyPoolCursor.set(poolId, (start + 1) % keyCount);

  const rank = new Map<number, number>();
  rotated.forEach((idx, order) => rank.set(idx, order));
  return [...rotated].sort((a, b) => {
    const loadA = keyLoads.get(keyLoadToken(poolId, a)) || 0;
    const loadB = keyLoads.get(keyLoadToken(poolId, b)) || 0;
    if (loadA !== loadB) return loadA - loadB;
    return (rank.get(a) || 0) - (rank.get(b) || 0);
  });
}

function acquireKeyLease(poolId: string, keyIndex: number): () => void {
  const token = keyLoadToken(poolId, keyIndex);
  keyLoads.set(token, (keyLoads.get(token) || 0) + 1);
  return () => {
    const next = (keyLoads.get(token) || 1) - 1;
    if (next <= 0) {
      keyLoads.delete(token);
    } else {
      keyLoads.set(token, next);
    }
  };
}

function sortProviders(
  preferredProvider: ApiProvider,
  providers: Record<ProviderId, ProviderRuntimeConfig>,
): ProviderId[] {
  const prioritySorted = [...PROVIDER_IDS].sort((a, b) => {
    const priorityDelta = providers[a].priority - providers[b].priority;
    if (priorityDelta !== 0) return priorityDelta;
    return a.localeCompare(b);
  });

  if (preferredProvider === 'auto') return prioritySorted;
  return [preferredProvider, ...prioritySorted.filter((providerId) => providerId !== preferredProvider)];
}

function resolveTransport(providerId: ProviderId, capability: AICapability): ProviderTransport | null {
  if (capability === 'llm' || capability === 'image') {
    if (providerId === 'aihubmix' || providerId === 'gemini') return 'gemini';
    return null;
  }
  if (capability === 'video') {
    if (providerId === 'aihubmix' || providerId === 'volcengine') return 'openai-video';
    return null;
  }
  return null;
}

function getOutputDir(): string {
  return process.env.OMNI_OUTPUT_DIR?.trim() || path.join(app.getPath('userData'), 'output');
}

function sanitizeKeys(keys: string[]): string[] {
  return keys.map((item) => item.trim()).filter(Boolean);
}

export type ProviderExecutionContext = {
  providerId: ProviderId;
  capability: AICapability;
  transport: ProviderTransport;
  apiKey: string;
  geminiBaseUrl: string;
  openaiBaseUrl: string;
  models: ProviderRuntimeConfig['models'];
  outputDir: string;
};

export async function runWithProviderFallback<T>(params: {
  capability: AICapability;
  preferredProvider?: ApiProvider;
  taskName: string;
  operation: (ctx: ProviderExecutionContext) => Promise<T>;
}): Promise<T> {
  const runtime = getRuntimeEnvConfig();
  const preferredProvider = params.preferredProvider || runtime.apiProvider;
  const orderedProviders = sortProviders(preferredProvider, runtime.providers);
  const attempts: AttemptFailure[] = [];

  for (const providerId of orderedProviders) {
    const provider = runtime.providers[providerId];
    if (!provider.enabled) {
      attempts.push({ providerId, reason: 'disabled' });
      continue;
    }

    const transport = resolveTransport(providerId, params.capability);
    if (!transport) {
      attempts.push({ providerId, reason: 'unsupported' });
      continue;
    }

    const keys = sanitizeKeys(provider.apiKeys);
    if (keys.length === 0) {
      attempts.push({ providerId, reason: 'missing_key' });
      continue;
    }

    const poolId = keyPoolId(providerId, keys);
    const keyOrder = getKeyAttemptOrder(poolId, keys.length);
    for (const keyIndex of keyOrder) {
      const release = acquireKeyLease(poolId, keyIndex);
      try {
        const result = await params.operation({
          providerId,
          capability: params.capability,
          transport,
          apiKey: keys[keyIndex],
          geminiBaseUrl: provider.geminiBaseUrl || '',
          openaiBaseUrl: provider.openaiBaseUrl || '',
          models: provider.models,
          outputDir: getOutputDir(),
        });
        return result;
      } catch (error) {
        if (shouldStopFallback(error)) {
          throw error;
        }
        attempts.push({
          providerId,
          reason: 'failed',
          error: normalizeErrorMessage(error),
        });
      } finally {
        release();
      }
    }
  }

  const missingOnly = attempts.length > 0 && attempts.every((attempt) => attempt.reason === 'missing_key' || attempt.reason === 'disabled');
  if (missingOnly) {
    throw new MissingApiCredentialError(
      `Missing API key for ${params.capability.toUpperCase()} requests. 请在设置中至少配置一个可用服务商的 API Key。`,
    );
  }

  const summary = attempts
    .map((attempt) => {
      if (!attempt.error) return `${attempt.providerId}:${attempt.reason}`;
      return `${attempt.providerId}:${attempt.reason} (${attempt.error.slice(0, 160)})`;
    })
    .join(' | ');
  throw new ProviderFallbackError(
    `All providers failed for ${params.taskName} (${params.capability}). ${summary || 'No provider attempts were made.'}`,
    attempts,
  );
}

export function pickModel(models: string[], fallback: string): string {
  const normalized = models.map((model) => model.trim()).filter(Boolean);
  return normalized[0] || fallback;
}

export function pickModelByKeyword(models: string[], keyword: string, fallback: string): string {
  const normalized = models.map((model) => model.trim()).filter(Boolean);
  const preferred = normalized.find((model) => model.toLowerCase().includes(keyword.toLowerCase()));
  return preferred || normalized[0] || fallback;
}

export function getProviderOutputDir(): string {
  return getOutputDir();
}
