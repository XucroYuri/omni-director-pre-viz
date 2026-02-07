import { NextRequest, NextResponse } from 'next/server';
import { runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { listTaskAuditLogs } from '@/lib/repos/tasks';
import type { TaskAuditLogRecord } from '@/lib/models';
import { ensurePhase91Schema } from '@/lib/schema';

type ExportFormat = 'json' | 'csv';

function parseOptionalPositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseFormat(value: string | null): ExportFormat {
  if (value === 'csv') return 'csv';
  return 'json';
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows: TaskAuditLogRecord[]): string {
  const headers = [
    'id',
    'batch_id',
    'task_id',
    'episode_id',
    'trace_id',
    'job_kind',
    'action',
    'actor',
    'message',
    'metadata_json',
    'created_at',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.id),
        csvCell(row.batch_id),
        csvCell(row.task_id),
        csvCell(row.episode_id),
        csvCell(row.trace_id),
        csvCell(row.job_kind),
        csvCell(row.action),
        csvCell(row.actor),
        csvCell(row.message),
        csvCell(JSON.stringify(row.metadata_json || {})),
        csvCell(row.created_at),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export async function GET(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const episodeId = request.nextUrl.searchParams.get('episodeId') || undefined;
    const jobKind = request.nextUrl.searchParams.get('jobKind') || undefined;
    const traceId = request.nextUrl.searchParams.get('traceId') || undefined;
    const auditAction = request.nextUrl.searchParams.get('auditAction') || undefined;
    const auditActor = request.nextUrl.searchParams.get('auditActor') || undefined;
    const batchId = request.nextUrl.searchParams.get('batchId') || undefined;
    const limitRaw = request.nextUrl.searchParams.get('limit');
    const limit = parseOptionalPositiveInt(limitRaw) || 500;
    if (limitRaw !== null && parseOptionalPositiveInt(limitRaw) === undefined) {
      return jsonError(400, 'INVALID_QUERY', 'limit must be a positive integer');
    }
    const format = parseFormat(request.nextUrl.searchParams.get('format'));

    const rows = await listTaskAuditLogs({
      episodeId,
      jobKind,
      traceId,
      auditAction,
      auditActor,
      batchId,
      limit,
      offset: 0,
    });

    if (format === 'csv') {
      const csv = buildCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="task-audit-logs-${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({
      logs: rows,
      count: rows.length,
    });
  });
}
