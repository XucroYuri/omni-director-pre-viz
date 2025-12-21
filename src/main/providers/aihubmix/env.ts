import * as path from 'node:path';
import { app } from 'electron';

export type AihubmixEnv = {
  apiKey: string;
  geminiBaseUrl: string;
  openaiBaseUrl: string;
  outputDir: string;
};

export function getAihubmixEnv(): AihubmixEnv {
  const apiKey = process.env.AIHUBMIX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing AIHUBMIX_API_KEY. For dev, set it in your environment (see `.env.example`).');
  }

  const geminiBaseUrl = (process.env.AIHUBMIX_GEMINI_BASE_URL || 'https://aihubmix.com/gemini').trim();
  const openaiBaseUrl = (process.env.AIHUBMIX_OPENAI_BASE_URL || 'https://aihubmix.com/v1').trim();

  const outputDir = process.env.OMNI_OUTPUT_DIR?.trim() || path.join(app.getPath('userData'), 'output');

  return { apiKey, geminiBaseUrl, openaiBaseUrl, outputDir };
}
