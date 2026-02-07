import { NextResponse } from 'next/server';
import { getTaskQueueMetrics } from '@/lib/repos/tasks';
import { ensurePhase91Schema } from '@/lib/schema';

export async function GET() {
  try {
    await ensurePhase91Schema();
    const taskQueue = await getTaskQueueMetrics();
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      services: {
        postgres: 'ready',
        objectStorage: process.env.S3_ENDPOINT ? 'configured' : 'not-configured',
      },
      taskQueue,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
