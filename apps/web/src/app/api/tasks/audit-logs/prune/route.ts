import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { pruneTaskAuditLogs } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

const pruneAuditLogsInputSchema = z.object({
  olderThanDays: z.number().int().min(0).max(3650).optional(),
  episodeId: z.string().trim().min(1).optional(),
  jobKind: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  auditAction: z.string().trim().min(1).optional(),
  auditActor: z.string().trim().min(1).optional(),
  batchId: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  actor: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(300).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const authError = requireRole(request, 'owner');
    if (authError) return authError;
    const parsed = pruneAuditLogsInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const result = await pruneTaskAuditLogs(parsed.data);
    return NextResponse.json({ result });
  });
}
