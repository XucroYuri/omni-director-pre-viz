import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp = require('sharp');
import type { DBTask, VideoGenerationParams } from '../../shared/types';
import { generateAssetImage, generateGridImage } from '../providers/aihubmix/gemini';
import { generateShotVideo } from '../providers/aihubmix/sora2';
import { getAihubmixEnv } from '../providers/aihubmix/env';
import { assetRepo } from '../db/repos/assetRepo';
import { shotRepo } from '../db/repos/shotRepo';
import { dbService } from '../services/dbService';
import { exportEpisode } from '../services/exportService';

type TaskPayload = {
  jobKind?: string;
  [key: string]: unknown;
};

export class TaskRunner {
  async execute(task: DBTask, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const payload = this.parsePayload(task);
    const jobKind = payload.jobKind || (task.type === 'EXPORT' ? 'EXPORT_EPISODE' : undefined);

    if (!jobKind) {
      throw new Error('Task payload missing jobKind');
    }

    switch (jobKind) {
      case 'MATRIX_GEN': {
        this.throwIfAborted(signal);
        const shot = payload.shot as any;
        const config = payload.config as any;
        if (!shot || !config) throw new Error('MATRIX_GEN requires shot and config');
        const { path: gridPath } = await generateGridImage(shot, config, signal);
        const splitPaths = await this.splitGridImage(gridPath, shot.id);

        const dbShot = shotRepo.get(shot.id);
        if (!dbShot) throw new Error(`Shot not found: ${shot.id}`);
        shotRepo.upsert({
          ...dbShot,
          generated_image_path: gridPath,
          split_images_json: JSON.stringify(splitPaths),
          updated_at: Date.now(),
        });

        task.result_json = JSON.stringify({ path: gridPath, splitPaths });
        return;
      }
      case 'VIDEO_GEN': {
        this.throwIfAborted(signal);
        const paramsPayload =
          payload.params && typeof payload.params === 'object'
            ? (payload.params as Record<string, unknown>)
            : undefined;
        const inputMode = (payload.inputMode ?? paramsPayload?.inputMode) as
          | VideoGenerationParams['inputMode']
          | undefined;
        if (!inputMode) throw new Error('VIDEO_GEN requires inputMode');
        const angleIndex = (payload.angleIndex ?? paramsPayload?.angleIndex) as number | undefined;
        const prompt = (payload.prompt ?? paramsPayload?.prompt) as string | undefined;

        if (payload.params && payload.config) {
          const params = payload.params as VideoGenerationParams;
          const config = payload.config as any;
          const { path } = await generateShotVideo(params, config, signal);
          task.result_json = JSON.stringify({ path });
          const shotId = params?.shot?.id as string | undefined;
          if (shotId) {
            this.updateShotVideoPath(shotId, inputMode, angleIndex, path);
          }
          return;
        }

        const episodeId = (payload.episodeId ?? payload.episode_id) as string | undefined;
        const shotId = (payload.shotId ?? payload.shot_id) as string | undefined;
        if (!episodeId || !shotId) throw new Error('VIDEO_GEN requires episodeId and shotId');
        const episode = await dbService.loadEpisode(episodeId);
        if (!episode) throw new Error(`Episode not found: ${episodeId}`);
        const shot = episode.shots.find((s) => s.id === shotId);
        if (!shot) throw new Error(`Shot not found: ${shotId}`);

        const params: VideoGenerationParams = { inputMode, shot, prompt, angleIndex };
        if (inputMode === 'IMAGE_FIRST_FRAME') {
          if (typeof angleIndex !== 'number') throw new Error('IMAGE_FIRST_FRAME requires angleIndex');
          const imageUri = shot.splitImages?.[angleIndex];
          if (!imageUri) throw new Error('IMAGE_FIRST_FRAME requires splitImages');
          params.imageUri = imageUri;
        } else if (inputMode === 'MATRIX_FRAME') {
          const imageUri = shot.generatedImageUrl;
          if (!imageUri) throw new Error('MATRIX_FRAME requires generatedImageUrl');
          params.imageUri = imageUri;
        }

        const { path } = await generateShotVideo(params, episode.config, signal);
        task.result_json = JSON.stringify({ path });
        this.updateShotVideoPath(shotId, inputMode, angleIndex, path);
        return;
      }
      case 'ASSET_GEN': {
        this.throwIfAborted(signal);
        const assetId =
          (payload.assetId ?? payload.asset_id ?? payload.id) as string | undefined;
        const name = payload.name as string | undefined;
        const description = payload.description as string | undefined;
        const config = payload.config as any;
        if (!assetId || !name || !config) throw new Error('ASSET_GEN requires assetId, name, and config');
        const { path } = await generateAssetImage(name, description || '', config, signal);
        const asset = assetRepo.get(assetId);
        if (!asset) throw new Error(`Asset not found: ${assetId}`);
        assetRepo.upsert({
          ...asset,
          ref_image_path: path,
          updated_at: Date.now(),
        });
        task.result_json = JSON.stringify({ path });
        return;
      }
      case 'EXPORT_EPISODE': {
        this.throwIfAborted(signal);
        const options = (payload.options ?? payload) as any;
        if (!options) throw new Error('EXPORT_EPISODE requires options');
        const result = await exportEpisode(options);
        task.result_json = JSON.stringify(result);
        return;
      }
      default:
        throw new Error(`Unsupported jobKind: ${jobKind}`);
    }
  }

  private parsePayload(task: DBTask): TaskPayload {
    if (!task.payload_json) return {};
    try {
      const parsed = JSON.parse(task.payload_json);
      return typeof parsed === 'object' && parsed ? (parsed as TaskPayload) : {};
    } catch {
      throw new Error('Invalid task payload_json');
    }
  }

  private async splitGridImage(gridPath: string, shotId: string): Promise<string[]> {
    const image = sharp(gridPath);
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) throw new Error('Grid image has no dimensions');

    const cellWidth = Math.floor(width / 3);
    const cellHeight = Math.floor(height / 3);
    const { outputDir } = getAihubmixEnv();
    await fs.mkdir(path.join(outputDir, 'images'), { recursive: true });

    const results: string[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const left = col * cellWidth;
        const top = row * cellHeight;
        const extractWidth = col === 2 ? width - left : cellWidth;
        const extractHeight = row === 2 ? height - top : cellHeight;
        const buffer = await sharp(gridPath)
          .extract({ left, top, width: extractWidth, height: extractHeight })
          .png()
          .toBuffer();
        const index = row * 3 + col + 1;
        const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
        const filePath = path.join(outputDir, 'images', `split_${shotId}_${this.pad2(index)}_${hash}.png`);
        await fs.writeFile(filePath, buffer);
        results.push(filePath);
      }
    }
    return results;
  }

  private updateShotVideoPath(
    shotId: string,
    inputMode: VideoGenerationParams['inputMode'],
    angleIndex: number | undefined,
    videoPath: string,
  ): void {
    const dbShot = shotRepo.get(shotId);
    if (!dbShot) throw new Error(`Shot not found: ${shotId}`);
    const updated = { ...dbShot, updated_at: Date.now() };

    if (inputMode === 'IMAGE_FIRST_FRAME') {
      if (typeof angleIndex !== 'number') throw new Error('IMAGE_FIRST_FRAME requires angleIndex');
      const urls = this.parseJson<(string | null)[]>(updated.video_urls_json, Array(9).fill(null));
      const nextUrls = [...urls];
      nextUrls[angleIndex] = videoPath;
      updated.video_urls_json = JSON.stringify(nextUrls);
      const statuses = this.parseJson<string[]>(updated.video_status_json, Array(9).fill('idle'));
      const nextStatuses = [...statuses];
      nextStatuses[angleIndex] = 'completed';
      updated.video_status_json = JSON.stringify(nextStatuses);
    } else if (inputMode === 'MATRIX_FRAME') {
      updated.animatic_video_path = videoPath;
    } else if (inputMode === 'ASSET_COLLAGE') {
      updated.asset_video_path = videoPath;
    }

    shotRepo.upsert(updated);
  }

  private pad2(value: number): string {
    return String(value).padStart(2, '0');
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const error = new Error('Aborted');
    (error as Error & { name?: string }).name = 'AbortError';
    throw error;
  }
}
