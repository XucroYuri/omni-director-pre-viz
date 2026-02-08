import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import archiver = require('archiver');
import type { ExportOptions, ExportResult, Manifest, ManifestShot } from '../../shared/types';
import { resolveMediaRefToFilePath } from './mediaService';

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  return { mimeType: match[1], base64: match[2] };
}

function safeId(input: string) {
  return input.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

async function saveDataUriFile(dataUri: string, filePath: string) {
  const { base64 } = parseDataUri(dataUri);
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
}

async function saveMediaRef(ref: string, destPath: string) {
  if (ref.startsWith('data:')) {
    await saveDataUriFile(ref, destPath);
    return true;
  }
  const resolved = resolveMediaRefToFilePath(ref);
  if (!resolved) return false;
  await copyFileSafe(resolved, destPath);
  return true;
}

async function copyFileSafe(src: string, dest: string) {
  try {
    await fs.copyFile(src, dest);
  } catch (err) {
    console.warn(`Copy failed: ${src}`, err);
  }
}

async function saveVideo(url: string, destPath: string) {
  return saveMediaRef(url, destPath);
}

function getAssetNames(ids: string[] | undefined, assets: { id: string; name: string }[]) {
  if (!ids || ids.length === 0) return [];
  const idSet = new Set(ids);
  return assets.filter((a) => idSet.has(a.id)).map((a) => a.name);
}

function createZipArchive(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

export async function exportEpisode(options: ExportOptions): Promise<ExportResult> {
  const { episodeId, shots, includeVideos, createZip, outputDir, config } = options;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = outputDir?.trim() || process.env.OMNI_OUTPUT_DIR?.trim() || path.join(app.getPath('userData'), 'output');
  const folderName = `${safeId(episodeId)}_${timestamp}`;
  const exportPath = path.join(baseDir, folderName);

  try {
    await fs.mkdir(exportPath, { recursive: true });
    const manifestShots: ManifestShot[] = [];

    for (const shot of shots) {
      if (!shot.generatedImageUrl) continue;
      const safeShotId = safeId(shot.id);

      const matrixFilename = `Shot_${safeShotId}_Matrix.png`;
      await saveMediaRef(shot.generatedImageUrl, path.join(exportPath, matrixFilename));

      const sliceFilenames: string[] = [];
      if (shot.splitImages) {
        for (let i = 0; i < shot.splitImages.length; i += 1) {
          const slice = shot.splitImages[i];
          if (!slice) continue;
          const filename = `Shot_${safeShotId}_Angle_${pad2(i + 1)}.png`;
          await saveMediaRef(slice, path.join(exportPath, filename));
          sliceFilenames.push(filename);
        }
      }

      const videoFilenames: (string | null)[] = Array(9).fill(null);
      let animaticFilename: string | null = null;
      let assetVideoFilename: string | null = null;

      if (includeVideos) {
        if (shot.videoUrls) {
          for (let i = 0; i < shot.videoUrls.length; i += 1) {
            const url = shot.videoUrls[i];
            if (!url) continue;
            const filename = `Shot_${safeShotId}_Angle_${pad2(i + 1)}.mp4`;
            const ok = await saveVideo(url, path.join(exportPath, filename));
            if (ok) videoFilenames[i] = filename;
          }
        }

        if (shot.animaticVideoUrl) {
          const filename = `Shot_${safeShotId}_Animatic.mp4`;
          const ok = await saveVideo(shot.animaticVideoUrl, path.join(exportPath, filename));
          if (ok) animaticFilename = filename;
        }

        if (shot.assetVideoUrl) {
          const filename = `Shot_${safeShotId}_AssetVideo.mp4`;
          const ok = await saveVideo(shot.assetVideoUrl, path.join(exportPath, filename));
          if (ok) assetVideoFilename = filename;
        }
      }

      manifestShots.push({
        shotId: shot.id,
        visualTranslation: shot.visualTranslation,
        matrixImage: matrixFilename,
        slices: sliceFilenames,
        videos: videoFilenames,
        animaticVideo: animaticFilename,
        assetVideo: assetVideoFilename,
        prompts: shot.matrixPrompts || [],
        assets: {
          characters: getAssetNames(shot.characterIds, config.characters),
          scenes: getAssetNames(shot.sceneIds, config.scenes),
          props: getAssetNames(shot.propIds, config.props),
        },
      });
    }

    const manifest: Manifest = {
      version: '1.0.0',
      episodeId,
      generatedAt: new Date().toISOString(),
      totalShots: manifestShots.length,
      shots: manifestShots,
    };
    await fs.writeFile(path.join(exportPath, 'manifest.json'), JSON.stringify(manifest, null, 2));

    let zipPath: string | undefined;
    if (createZip) {
      zipPath = path.join(baseDir, `${folderName}.zip`);
      await createZipArchive(exportPath, zipPath);
    }

    return { success: true, outputPath: exportPath, zipPath };
  } catch (error: any) {
    console.error('Export failed:', error);
    return { success: false, outputPath: '', error: error.message };
  }
}
