import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, runApi } from '@/lib/api';
import { jsonError } from '@/lib/errors';
import { bulkRetryDeadLetters } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

const bulkRetryInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  jobKind: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  deadReason: z.string().trim().min(1).optional(),
  errorCode: z.string().trim().min(1).optional(),
  taskIds: z.array(z.string().trim().min(1)).min(1).max(500).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  actor: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(300).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  return runApi(async () => {
    await ensurePhase91Schema();
    const parsed = bulkRetryInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid request body');
    }

    const result = await bulkRetryDeadLetters(parsed.data);
    return NextResponse.json({ result });
  });
}
