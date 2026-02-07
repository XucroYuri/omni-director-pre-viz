import { NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { listTaskDeadLetters } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

function parseOptionalLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export async function GET(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const episodeId = request.nextUrl.searchParams.get('episodeId') || undefined;
    const jobKind = request.nextUrl.searchParams.get('jobKind') || undefined;
    const traceId = request.nextUrl.searchParams.get('traceId') || undefined;
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const limit = parseOptionalLimit(limitRaw);
    if (limitRaw !== null && limit === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'limit must be a positive integer');
    }
    const deadLetters = await listTaskDeadLetters({ episodeId, jobKind, traceId, limit });
    return NextResponse.json({ deadLetters });
  });
}
