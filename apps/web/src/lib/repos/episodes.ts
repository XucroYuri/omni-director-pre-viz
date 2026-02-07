import { randomUUID } from 'node:crypto';
import type { EpisodeRecord } from '../models';
import { queryRows } from '../db';

export async function listEpisodes(): Promise<EpisodeRecord[]> {
  return queryRows<EpisodeRecord>(
    `
      SELECT id, title, created_at, updated_at
      FROM episodes
      ORDER BY updated_at DESC
    `,
  );
}

export async function createEpisode(title?: string): Promise<{ id: string; title: string }> {
  const episode = {
    id: randomUUID(),
    title: title?.trim() || 'Untitled Episode',
  };

  await queryRows(
    `
      INSERT INTO episodes (id, title, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
    `,
    [episode.id, episode.title],
  );

  return episode;
}

export async function episodeExists(episodeId: string): Promise<boolean> {
  const rows = await queryRows<{ exists: boolean }>(
    `
      SELECT EXISTS (SELECT 1 FROM episodes WHERE id = $1) AS exists
    `,
    [episodeId],
  );
  return rows[0]?.exists === true;
}

export async function getEpisodeSummary(episodeId: string): Promise<{
  episodeId: string;
  shotCount: number;
  assetCount: number;
  taskCount: number;
}> {
  const rows = await queryRows<{
    shot_count: number;
    asset_count: number;
    task_count: number;
  }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM shots WHERE episode_id = $1) AS shot_count,
        (SELECT COUNT(*)::int FROM assets WHERE episode_id = $1) AS asset_count,
        (SELECT COUNT(*)::int FROM tasks WHERE episode_id = $1) AS task_count
    `,
    [episodeId],
  );

  const row = rows[0] || { shot_count: 0, asset_count: 0, task_count: 0 };
  return {
    episodeId,
    shotCount: row.shot_count,
    assetCount: row.asset_count,
    taskCount: row.task_count,
  };
}
