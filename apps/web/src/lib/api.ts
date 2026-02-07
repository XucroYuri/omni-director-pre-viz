import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { jsonError } from './errors';

export type ApiHandler = () => Promise<NextResponse>;

export async function runApi(handler: ApiHandler): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    return jsonError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
  }
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => ({}));
}
