import { initDatabase } from '../index';
import type { Database } from 'better-sqlite3';

export interface DBAsset {
  id: string;
  episode_id: string;
  type: string;
  name: string;
  description: string | null;
  ref_image_path: string | null;
  tags_json: string | null;
  created_at: number;
  updated_at: number;
}

export class AssetRepo {
  private db: Database;

  constructor() {
    this.db = initDatabase();
  }

  create(asset: DBAsset): void {
    const stmt = this.db.prepare(`
      INSERT INTO assets (id, episode_id, type, name, description, ref_image_path, tags_json, created_at, updated_at)
      VALUES (@id, @episode_id, @type, @name, @description, @ref_image_path, @tags_json, @created_at, @updated_at)
    `);
    stmt.run(asset);
  }

  getByEpisodeId(episodeId: string): DBAsset[] {
    const stmt = this.db.prepare('SELECT * FROM assets WHERE episode_id = ?');
    return stmt.all(episodeId) as DBAsset[];
  }

  update(asset: DBAsset): void {
    const stmt = this.db.prepare(`
      UPDATE assets
      SET type = @type, name = @name, description = @description, ref_image_path = @ref_image_path, tags_json = @tags_json, updated_at = @updated_at
      WHERE id = @id
    `);
    stmt.run(asset);
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM assets WHERE id = ?');
    stmt.run(id);
  }
}

export const assetRepo = new AssetRepo();