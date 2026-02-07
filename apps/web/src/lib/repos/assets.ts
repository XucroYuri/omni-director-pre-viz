import { randomUUID } from 'node:crypto';
import type { AssetRecord, AssetType } from '../models';
import { queryRows } from '../db';

type CreateAssetInput = {
  episodeId: string;
  type: AssetType;
  name: string;
  description?: string;
  mediaKey?: string;
};

export async function listAssetsByEpisode(episodeId: string): Promise<AssetRecord[]> {
  return queryRows<AssetRecord>(
    `
      SELECT id, episode_id, type, name, description, media_key, created_at, updated_at
      FROM assets
      WHERE episode_id = $1
      ORDER BY created_at ASC
    `,
    [episodeId],
  );
}

export async function createAsset(input: CreateAssetInput): Promise<{
  id: string;
  episodeId: string;
  type: AssetType;
  name: string;
  description: string;
  mediaKey: string | null;
}> {
  const asset = {
    id: randomUUID(),
    episodeId: input.episodeId,
    type: input.type,
    name: input.name,
    description: input.description || '',
    mediaKey: input.mediaKey || null,
  };

  await queryRows(
    `
      INSERT INTO assets (id, episode_id, type, name, description, media_key, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `,
    [asset.id, asset.episodeId, asset.type, asset.name, asset.description, asset.mediaKey],
  );

  return asset;
}
