import { getRuntimeEnvConfig } from '../../services/runtimeEnvService';
import { MissingApiCredentialError, isMissingApiCredentialError as isMissingGenericApiCredentialError } from '../router';
import { getProviderOutputDir } from '../router';

export type AihubmixEnv = {
  apiKey: string;
  geminiBaseUrl: string;
  openaiBaseUrl: string;
  outputDir: string;
};

const MISSING_API_KEY_MESSAGE =
  'Missing AIHUBMIX_API_KEY. Please configure API keys in 设置 > API 与环境变量。';

export class MissingAihubmixApiKeyError extends MissingApiCredentialError {
  constructor(message = MISSING_API_KEY_MESSAGE) {
    super(message);
    this.name = 'MissingAihubmixApiKeyError';
  }
}

export function isMissingAihubmixApiKeyError(error: unknown): boolean {
  if (error instanceof MissingAihubmixApiKeyError) return true;
  if (isMissingGenericApiCredentialError(error)) return true;
  if (!(error instanceof Error)) return false;
  return /Missing\s+AIHUBMIX_API_KEY/i.test(error.message);
}

export function getAihubmixEnv(): AihubmixEnv {
  const runtime = getRuntimeEnvConfig();
  const provider = runtime.providers.aihubmix;
  const apiKey = provider.apiKeys[0]?.trim() || '';
  if (!apiKey) {
    throw new MissingAihubmixApiKeyError();
  }

  return {
    apiKey,
    geminiBaseUrl: provider.geminiBaseUrl || '',
    openaiBaseUrl: provider.openaiBaseUrl || '',
    outputDir: getProviderOutputDir(),
  };
}
