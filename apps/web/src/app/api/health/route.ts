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
    console.error('health check failed', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
