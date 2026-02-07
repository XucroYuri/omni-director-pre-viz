import { randomUUID } from 'node:crypto';
import type { ShotRecord } from '../models';
import { queryRows } from '../db';

type CreateShotInput = {
  episodeId: string;
  orderIndex?: number;
  originalText?: string;
  visualTranslation?: string;
};

export type ShotStatusValue = 'pending' | 'processing' | 'completed' | 'failed';

export async function listShotsByEpisode(episodeId: string): Promise<ShotRecord[]> {
  return queryRows<ShotRecord>(
    `
      SELECT id, episode_id, order_index, original_text, visual_translation, status, created_at, updated_at
      FROM shots
      WHERE episode_id = $1
      ORDER BY order_index ASC, created_at ASC
    `,
    [episodeId],
  );
}

export async function createShot(input: CreateShotInput): Promise<{
  id: string;
  episodeId: string;
  orderIndex: number;
  originalText: string;
  visualTranslation: string;
  status: string;
}> {
  const shot = {
    id: randomUUID(),
    episodeId: input.episodeId,
    orderIndex: input.orderIndex ?? 0,
    originalText: input.originalText ?? '',
    visualTranslation: input.visualTranslation ?? '',
    status: 'pending',
  };

  await queryRows(
    `
      INSERT INTO shots (
        id, episode_id, order_index, original_text, visual_translation, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `,
    [shot.id, shot.episodeId, shot.orderIndex, shot.originalText, shot.visualTranslation, shot.status],
  );

  return shot;
}

export async function getShotById(shotId: string): Promise<ShotRecord | null> {
  const rows = await queryRows<ShotRecord>(
    `
      SELECT id, episode_id, order_index, original_text, visual_translation, status, created_at, updated_at
      FROM shots
      WHERE id = $1
      LIMIT 1
    `,
    [shotId],
  );
  return rows[0] || null;
}

export async function updateShotStatus(shotId: string, status: ShotStatusValue): Promise<ShotRecord | null> {
  const rows = await queryRows<ShotRecord>(
    `
      UPDATE shots
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, episode_id, order_index, original_text, visual_translation, status, created_at, updated_at
    `,
    [shotId, status],
  );
  return rows[0] || null;
}
