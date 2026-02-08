import type { GridLayout } from '@shared/types';
import { normalizeGridLayout } from '@shared/utils';

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

export async function splitGridImageByCanvas(
  imageUrl: string,
  layout?: Partial<GridLayout> | null,
): Promise<string[]> {
  if (!imageUrl) return [];
  const gridLayout = normalizeGridLayout(layout);
  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available');

  const slices: string[] = [];
  for (let row = 0; row < gridLayout.rows; row += 1) {
    for (let col = 0; col < gridLayout.cols; col += 1) {
      const left = Math.floor((img.width * col) / gridLayout.cols);
      const top = Math.floor((img.height * row) / gridLayout.rows);
      const right =
        col === gridLayout.cols - 1 ? img.width : Math.floor((img.width * (col + 1)) / gridLayout.cols);
      const bottom =
        row === gridLayout.rows - 1 ? img.height : Math.floor((img.height * (row + 1)) / gridLayout.rows);

      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
      slices.push(canvas.toDataURL('image/png'));
    }
  }

  return slices;
}
