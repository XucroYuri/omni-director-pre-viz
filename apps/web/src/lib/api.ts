import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { jsonError } from './errors';

export type ApiHandler = () => Promise<NextResponse>;

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
  }
}

export async function runApi(handler: ApiHandler): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error('API handler failed', error);
    return jsonError(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiHttpError(400, 'INVALID_JSON', 'Malformed JSON body');
  }
}
