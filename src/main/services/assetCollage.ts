import sharp = require('sharp');
import type { GlobalConfig, Shot } from '../../shared/types';
import { getBoundAssets } from '../../shared/utils';

type CollageItem = { typeLabel: string; name: string; refImage: string };

const COLLAGE_WIDTH = 1920;
const COLLAGE_HEIGHT = 1080;
const COLLAGE_PADDING = 80;
const COLLAGE_GAP = 32;

function parseDataUri(dataUri: string) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URI');
  return { mimeType: match[1], base64: match[2] };
}

function escapeXml(input: string) {
  return input.replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return ch;
    }
  });
}

function computeGrid(count: number) {
  const ratio = COLLAGE_WIDTH / COLLAGE_HEIGHT;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * ratio)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cols, rows };
}

function buildLabelSvg(width: number, height: number, label: string) {
  const safeLabel = escapeXml(label);
  const fontSize = Math.max(12, Math.round(height * 0.55));
  const textY = Math.round(height * 0.7);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" />
  <text x="12" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#ffffff">${safeLabel}</text>
</svg>`;
}

function collectCollageItems(shot: Shot, config: GlobalConfig): CollageItem[] {
  const { characters, scenes, props } = getBoundAssets(shot, config);
  const items: CollageItem[] = [];

  for (const c of characters) {
    if (c.refImage) items.push({ typeLabel: 'Character', name: c.name, refImage: c.refImage });
  }
  for (const s of scenes) {
    if (s.refImage) items.push({ typeLabel: 'Scene', name: s.name, refImage: s.refImage });
  }
  for (const p of props) {
    if (p.refImage) items.push({ typeLabel: 'Prop', name: p.name, refImage: p.refImage });
  }

  return items;
}

export async function createAssetCollage(shot: Shot, config: GlobalConfig): Promise<Buffer> {
  const items = collectCollageItems(shot, config);
  if (items.length === 0) {
    throw new Error('Asset collage requires at least one bound asset with refImage');
  }

  const { cols, rows } = computeGrid(items.length);
  const width = COLLAGE_WIDTH;
  const height = COLLAGE_HEIGHT;
  const cellWidth = Math.floor((width - COLLAGE_PADDING * 2 - COLLAGE_GAP * (cols - 1)) / cols);
  const cellHeight = Math.floor((height - COLLAGE_PADDING * 2 - COLLAGE_GAP * (rows - 1)) / rows);
  const labelHeight = Math.min(40, Math.max(24, Math.floor(cellHeight * 0.18)));

  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new Error('Asset collage layout too small');
  }

  const composites = await Promise.all(
    items.map(async (item, index) => {
      const { base64 } = parseDataUri(item.refImage);
      const buffer = Buffer.from(base64, 'base64');
      const image = await sharp(buffer).resize(cellWidth, cellHeight, { fit: 'cover' }).toBuffer();

      const row = Math.floor(index / cols);
      const col = index % cols;
      const left = COLLAGE_PADDING + col * (cellWidth + COLLAGE_GAP);
      const top = COLLAGE_PADDING + row * (cellHeight + COLLAGE_GAP);

      const label = `${item.typeLabel}: ${item.name}`;
      const labelSvg = buildLabelSvg(cellWidth, labelHeight, label);

      return [
        { input: image, top, left },
        { input: Buffer.from(labelSvg), top: top + cellHeight - labelHeight, left },
      ];
    }),
  );

  const flattened = composites.flat();
  const canvas = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#0f1115',
    },
  });

  return canvas.composite(flattened).png().toBuffer();
}
