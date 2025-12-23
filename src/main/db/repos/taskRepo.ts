import { initDatabase } from '../index';
import type { Database } from 'better-sqlite3';
import type { DBTask } from '../../../shared/types';

export class TaskRepo {
  private db: Database;

  constructor() {
    this.db = initDatabase();
  }

  upsert(task: DBTask): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, episode_id, shot_id, type, status, progress,
        payload_json, result_json, error, created_at, updated_at
      ) VALUES (
        @id, @episode_id, @shot_id, @type, @status, @progress,
        @payload_json, @result_json, @error, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        episode_id = @episode_id,
        shot_id = @shot_id,
        type = @type,
        status = @status,
        progress = @progress,
        payload_json = @payload_json,
        result_json = @result_json,
        error = @error,
        updated_at = @updated_at
    `);
    stmt.run(task);
  }

  get(id: string): DBTask | undefined {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) as DBTask | undefined;
  }

  getByEpisodeId(episodeId: string): DBTask[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE episode_id = ? ORDER BY created_at DESC');
    return stmt.all(episodeId) as DBTask[];
  }

  getPending(): DBTask[] {
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE status IN ('queued', 'running') ORDER BY created_at ASC",
    );
    return stmt.all() as DBTask[];
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(id);
  }
}

export const taskRepo = new TaskRepo();
