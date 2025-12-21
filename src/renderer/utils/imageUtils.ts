
/**
 * 将 3x3 的网格图切分为 9 张独立图片
 */
export const splitGridImage = async (base64: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('Canvas context not found');

      const cellWidth = img.width / 3;
      const cellHeight = img.height / 3;
      canvas.width = cellWidth;
      canvas.height = cellHeight;

      const results: string[] = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          ctx.clearRect(0, 0, cellWidth, cellHeight);
          ctx.drawImage(
            img,
            col * cellWidth, row * cellHeight, cellWidth, cellHeight,
            0, 0, cellWidth, cellHeight
          );
          results.push(canvas.toDataURL('image/png'));
        }
      }
      resolve(results);
    };
    img.onerror = reject;
    img.src = base64;
  });
};
