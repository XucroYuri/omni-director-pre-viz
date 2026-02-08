import { initDatabase } from '../index';
import type { Database } from 'better-sqlite3';

export interface DBEpisode {
  id: string;
  project_id: string | null;
  episode_no: number;
  title: string | null;
  script: string | null;
  context: string | null;
  script_overview: string | null;
  analysis_json: string | null;
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
      INSERT INTO episodes (
        id, project_id, episode_no, title, script, context, script_overview, analysis_json,
        config_json, tags_json, created_at, updated_at
      )
      VALUES (
        @id, @project_id, @episode_no, @title, @script, @context, @script_overview, @analysis_json,
        @config_json, @tags_json, @created_at, @updated_at
      )
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

  getByProjectId(projectId: string): DBEpisode[] {
    const stmt = this.db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_no ASC, updated_at DESC');
    return stmt.all(projectId) as DBEpisode[];
  }

  getNextEpisodeNo(projectId: string): number {
    const stmt = this.db.prepare('SELECT COALESCE(MAX(episode_no), 0) + 1 AS next_no FROM episodes WHERE project_id = ?');
    const row = stmt.get(projectId) as { next_no?: number } | undefined;
    return row?.next_no && row.next_no > 0 ? row.next_no : 1;
  }

  update(episode: DBEpisode): void {
    const stmt = this.db.prepare(`
      UPDATE episodes
      SET project_id = @project_id,
          episode_no = @episode_no,
          title = @title,
          script = @script,
          context = @context,
          script_overview = @script_overview,
          analysis_json = @analysis_json,
          config_json = @config_json,
          tags_json = @tags_json,
          updated_at = @updated_at
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
