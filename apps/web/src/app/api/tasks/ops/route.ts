import { NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { getTaskOpsSnapshot, getTaskQueueMetrics } from '@/lib/repos/tasks';
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
    const metricsWindowRaw = request.nextUrl.searchParams.get('metricsWindowMinutes');
    const metricsWindowMinutes = parseOptionalLimit(metricsWindowRaw);
    const auditAction = request.nextUrl.searchParams.get('auditAction') || undefined;
    const auditActor = request.nextUrl.searchParams.get('auditActor') || undefined;
    const auditPageRaw = request.nextUrl.searchParams.get('auditPage');
    const auditPage = parseOptionalLimit(auditPageRaw);
    const auditPageSizeRaw = request.nextUrl.searchParams.get('auditPageSize');
    const auditPageSize = parseOptionalLimit(auditPageSizeRaw);
    if (limitRaw !== null && limit === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'limit must be a positive integer');
    }
    if (metricsWindowRaw !== null && metricsWindowMinutes === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'metricsWindowMinutes must be a positive integer');
    }
    if (auditPageRaw !== null && auditPage === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'auditPage must be a positive integer');
    }
    if (auditPageSizeRaw !== null && auditPageSize === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'auditPageSize must be a positive integer');
    }

    const [queue, snapshot] = await Promise.all([
      getTaskQueueMetrics(),
      getTaskOpsSnapshot({
        episodeId,
        jobKind,
        traceId,
        limit,
        metricsWindowMinutes,
        auditAction,
        auditActor,
        auditPage,
        auditPageSize,
      }),
    ]);

    return NextResponse.json({
      queue,
      ...snapshot,
    });
  });
}
