const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const sourceSvg = path.join(ROOT, 'src', 'renderer', 'assets', 'brand-mark.svg');
const iconsDir = path.join(ROOT, 'build', 'icons');
const iconsetDir = path.join(iconsDir, 'hc-timeline.iconset');
const icnsPath = path.join(iconsDir, 'hc-timeline.icns');
const pngPath = path.join(iconsDir, 'hc-timeline.png');

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

async function main() {
  if (!fs.existsSync(sourceSvg)) {
    throw new Error(`Logo source not found: ${sourceSvg}`);
  }

  fs.mkdirSync(iconsDir, { recursive: true });
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.rmSync(path.join(iconsDir, 'omni-director.iconset'), { recursive: true, force: true });
  fs.rmSync(path.join(iconsDir, 'omni-director.icns'), { force: true });
  fs.rmSync(path.join(iconsDir, 'omni-director.png'), { force: true });
  fs.rmSync(icnsPath, { force: true });
  fs.rmSync(pngPath, { force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  await Promise.all(
    iconsetSizes.map(async ([name, size]) => {
      const output = path.join(iconsetDir, name);
      await sharp(sourceSvg).resize(size, size).png().toFile(output);
    }),
  );

  fs.copyFileSync(path.join(iconsetDir, 'icon_512x512@2x.png'), pngPath);
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
  console.log(`Generated icons:\n- ${icnsPath}\n- ${pngPath}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
