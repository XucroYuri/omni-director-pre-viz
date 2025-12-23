import { initDatabase } from '../index';
import type { Database } from 'better-sqlite3';

export interface DBEpisode {
  id: string;
  title: string | null;
  script: string | null;
  context: string | null;
  config_json: string;
  tags_json: string | null;
  created_at: number;
  updated_at: number;
}

export class EpisodeRepo {
  private db: Database;

  constructor() {
    this.db = initDatabase();
  }

  create(episode: DBEpisode): void {
    const stmt = this.db.prepare(`
      INSERT INTO episodes (id, title, script, context, config_json, tags_json, created_at, updated_at)
      VALUES (@id, @title, @script, @context, @config_json, @tags_json, @created_at, @updated_at)
    `);
    stmt.run(episode);
  }

  get(id: string): DBEpisode | undefined {
    const stmt = this.db.prepare('SELECT * FROM episodes WHERE id = ?');
    return stmt.get(id) as DBEpisode | undefined;
  }

  getAll(): DBEpisode[] {
    const stmt = this.db.prepare('SELECT * FROM episodes ORDER BY updated_at DESC');
    return stmt.all() as DBEpisode[];
  }

  update(episode: DBEpisode): void {
    const stmt = this.db.prepare(`
      UPDATE episodes
      SET title = @title, script = @script, context = @context, config_json = @config_json, tags_json = @tags_json, updated_at = @updated_at
      WHERE id = @id
    `);
    stmt.run(episode);
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM episodes WHERE id = ?');
    stmt.run(id);
  }
}

export const episodeRepo = new EpisodeRepo();