import { app } from 'electron';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type MediaWriteInput = {
  bytes: Uint8Array;
  mimeType: string;
  relativeBase: string;
};

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  return { mimeType: match[1], base64: match[2] };
}

function extFromMime(mimeType: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'video/mp4') return '.mp4';
  return '';
}

export function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
}

export function getMediaRoot() {
  return process.env.OMNI_OUTPUT_DIR?.trim() || path.join(app.getPath('userData'), 'output');
}

async function ensureDirForFile(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeKey(key: string) {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized;
}

export function keyFromPath(inputPath: string): string {
  const root = path.resolve(getMediaRoot());
  const abs = path.resolve(inputPath);
  if (abs === root) return '';
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!abs.startsWith(withSep)) {
    throw new Error('Path is outside media root');
  }
  return normalizeKey(path.relative(root, abs));
}

export function urlFromKey(key: string): string {
  const normalized = normalizeKey(key);
  const encoded = normalized
    .split('/')
    .filter((p) => p.length > 0)
    .map((p) => encodeURIComponent(p))
    .join('/');
  return `omni-media:///${encoded}`;
}

export function urlFromPath(inputPath: string): string {
  const key = keyFromPath(inputPath);
  return urlFromKey(key);
}

export function resolveUrlToPath(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'omni-media:') {
    throw new Error('Unsupported media URL');
  }
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  const root = path.resolve(getMediaRoot());
  const abs = path.resolve(root, rel);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(withSep)) {
    throw new Error('Media URL resolves outside media root');
  }
  return abs;
}

export async function writeBytesToMedia(input: MediaWriteInput): Promise<{ key: string; path: string; url: string }> {
  const ext = extFromMime(input.mimeType);
  const hash = createHash('sha1').update(input.bytes).digest('hex').slice(0, 10);
  const relativePath = normalizeKey(`${input.relativeBase}_${hash}${ext}`);
  const absPath = path.join(getMediaRoot(), relativePath);
  await ensureDirForFile(absPath);
  await fs.writeFile(absPath, Buffer.from(input.bytes));
  return { key: relativePath, path: absPath, url: urlFromKey(relativePath) };
}

export async function writeDataUriToMedia(dataUri: string, relativeBase: string) {
  const { mimeType, base64 } = parseDataUri(dataUri);
  const bytes = Buffer.from(base64, 'base64');
  return writeBytesToMedia({ bytes, mimeType, relativeBase });
}

export async function readFileAsDataUri(inputPath: string): Promise<string> {
  const buf = await fs.readFile(inputPath);
  const mimeType = mimeFromPath(inputPath);
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

export function normalizeMediaRefToUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('omni-media://')) return value;
  if (value.startsWith('file://')) {
    const srcPath = value.replace('file://', '');
    try {
      return urlFromPath(srcPath);
    } catch {
      return value;
    }
  }
  if (value.startsWith('data:')) {
    return undefined;
  }
  if (value.includes('://')) return value;
  try {
    const root = getMediaRoot();
    const abs = path.isAbsolute(value) ? value : path.join(root, value);
    return urlFromPath(abs);
  } catch {
    return value;
  }
}

export function resolveMediaRefToFilePath(value: string): string | null {
  if (!value) return null;
  if (value.startsWith('omni-media://')) {
    return resolveUrlToPath(value);
  }
  if (value.startsWith('file://')) {
    return value.replace('file://', '');
  }
  if (value.startsWith('data:')) {
    return null;
  }
  if (value.includes('://')) {
    return null;
  }
  const root = getMediaRoot();
  return path.isAbsolute(value) ? value : path.join(root, value);
}
