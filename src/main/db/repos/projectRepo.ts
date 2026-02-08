import { initDatabase } from '../index';
import type { Database } from 'better-sqlite3';

export interface DBProject {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export class ProjectRepo {
  private db: Database;

  constructor() {
    this.db = initDatabase();
  }

  create(project: DBProject): void {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at)
      VALUES (@id, @name, @description, @created_at, @updated_at)
    `);
    stmt.run(project);
  }

  get(id: string): DBProject | undefined {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    return stmt.get(id) as DBProject | undefined;
  }

  getAll(): DBProject[] {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
    return stmt.all() as DBProject[];
  }

  update(project: DBProject): void {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET name = @name, description = @description, updated_at = @updated_at
      WHERE id = @id
    `);
    stmt.run(project);
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
  }
}

export const projectRepo = new ProjectRepo();
