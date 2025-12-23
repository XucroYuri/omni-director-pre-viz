import { initDatabase } from '../index';
import type { Database } from 'better-sqlite3';

export interface DBShot {
  id: string;
  episode_id: string;
  order_index: number;
  original_text: string | null;
  visual_translation: string | null;
  context_tag: string | null;
  shot_kind: string | null;
  matrix_prompts_json: string | null;
  generated_image_path: string | null;
  split_images_json: string | null;
  video_urls_json: string | null;
  animatic_video_path: string | null;
  asset_video_path: string | null;
  status: string | null;
  video_status_json: string | null;
  progress: number | null;
  history_json: string | null;
  optimization_json: string | null;
  character_ids_json: string | null;
  scene_ids_json: string | null;
  prop_ids_json: string | null;
  linked_shot_ids_json: string | null;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ShotRepo {
  private db: Database;

  constructor() {
    this.db = initDatabase();
  }

  upsert(shot: DBShot): void {
    const stmt = this.db.prepare(`
      INSERT INTO shots (
        id, episode_id, order_index, original_text, visual_translation, context_tag, shot_kind,
        matrix_prompts_json, generated_image_path, split_images_json, video_urls_json,
        animatic_video_path, asset_video_path, status, video_status_json, progress,
        history_json, optimization_json, character_ids_json, scene_ids_json, prop_ids_json,
        linked_shot_ids_json, last_accessed_at, created_at, updated_at
      ) VALUES (
        @id, @episode_id, @order_index, @original_text, @visual_translation, @context_tag, @shot_kind,
        @matrix_prompts_json, @generated_image_path, @split_images_json, @video_urls_json,
        @animatic_video_path, @asset_video_path, @status, @video_status_json, @progress,
        @history_json, @optimization_json, @character_ids_json, @scene_ids_json, @prop_ids_json,
        @linked_shot_ids_json, @last_accessed_at, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        order_index = @order_index, original_text = @original_text, visual_translation = @visual_translation,
        context_tag = @context_tag, shot_kind = @shot_kind, matrix_prompts_json = @matrix_prompts_json,
        generated_image_path = @generated_image_path, split_images_json = @split_images_json,
        video_urls_json = @video_urls_json, animatic_video_path = @animatic_video_path,
        asset_video_path = @asset_video_path, status = @status, video_status_json = @video_status_json,
        progress = @progress, history_json = @history_json, optimization_json = @optimization_json,
        character_ids_json = @character_ids_json, scene_ids_json = @scene_ids_json, prop_ids_json = @prop_ids_json,
        linked_shot_ids_json = @linked_shot_ids_json, last_accessed_at = @last_accessed_at, updated_at = @updated_at
    `);
    stmt.run(shot);
  }

  getByEpisodeId(episodeId: string): DBShot[] {
    const stmt = this.db.prepare('SELECT * FROM shots WHERE episode_id = ? ORDER BY order_index ASC');
    return stmt.all(episodeId) as DBShot[];
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM shots WHERE id = ?');
    stmt.run(id);
  }
}

export const shotRepo = new ShotRepo();