import { NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { previewDeadLetterMatches } from '@/lib/repos/tasks';
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
    const deadReason = request.nextUrl.searchParams.get('deadReason') || undefined;
    const errorCode = request.nextUrl.searchParams.get('errorCode') || undefined;
    const pageRaw = request.nextUrl.searchParams.get('page');
    const page = parseOptionalLimit(pageRaw);
    const pageSizeRaw = request.nextUrl.searchParams.get('pageSize');
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const pageSize = parseOptionalLimit(pageSizeRaw) || parseOptionalLimit(limitRaw);
    if (pageRaw !== null && page === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'page must be a positive integer');
    }
    if (pageSizeRaw !== null && parseOptionalLimit(pageSizeRaw) === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'pageSize must be a positive integer');
    }
    if (limitRaw !== null && parseOptionalLimit(limitRaw) === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'limit must be a positive integer');
    }

    const preview = await previewDeadLetterMatches({
      episodeId,
      jobKind,
      traceId,
      deadReason,
      errorCode,
      page,
      pageSize,
    });
    return NextResponse.json({ preview });
  });
}
