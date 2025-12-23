let app;
try {
  const electron = require('electron');
  app = electron && electron.app;
} catch {
  app = null;
}
const path = require('path');
const fs = require('fs');

if (app && app.commandLine) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

async function runVerification() {
  if (app && app.whenReady) {
    console.log('🔵 [Verify] Waiting for Electron...');
    await app.whenReady();
  } else {
    console.log('🟡 [Verify] Electron app not detected, continuing in Node mode...');
  }

  const servicePath = path.join(__dirname, '../dist/main/services/exportService.js');
  if (!fs.existsSync(servicePath)) {
    console.error(`❌ [Verify] Service file missing: ${servicePath}`);
    console.error('👉 Please run: npm run build:electron');
    process.exit(1);
  }

  console.log('🔵 [Verify] Loading exportService...');
  const { exportEpisode } = require(servicePath);

  const timestamp = Date.now();
  const mockShot = {
    id: `shot_${timestamp}`,
    visualTranslation: 'Test Shot for Verification',
    generatedImageUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    splitImages: [],
    videoUrls: [],
    matrixPrompts: [],
    characterIds: [],
    sceneIds: [],
    propIds: [],
  };

  const mockOptions = {
    episodeId: `EP_TEST_${timestamp}`,
    shots: [mockShot],
    config: { characters: [], scenes: [], props: [] },
    includeVideos: false,
    createZip: true,
    outputDir: path.join(__dirname, '../temp_verification_out'),
  };

  console.log(`🔵 [Verify] Exporting to: ${mockOptions.outputDir}`);

  try {
    if (fs.existsSync(mockOptions.outputDir)) {
      fs.rmSync(mockOptions.outputDir, { recursive: true, force: true });
    }

    const result = await exportEpisode(mockOptions);

    if (!result.success) {
      console.error('❌ [Verify] Export failed:', result.error);
      process.exit(1);
    }

    console.log('🟢 [Verify] Export function returned success.');

    const manifestPath = path.join(result.outputPath, 'manifest.json');
    const zipPath = result.zipPath;

    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest file missing!');
    }
    console.log('✅ [Verify] Manifest created.');

    if (!zipPath || !fs.existsSync(zipPath)) {
      throw new Error('ZIP file missing!');
    }
    console.log('✅ [Verify] ZIP created.');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (manifest.shots[0].shotId !== mockShot.id) {
      throw new Error('Manifest content mismatch!');
    }
    console.log('✅ [Verify] Manifest content valid.');

    console.log('\n✨ PASS: All checks passed successfully.');
    console.log(`   (Output kept at: ${mockOptions.outputDir} for inspection)`);

    process.exit(0);
  } catch (err) {
    console.error('❌ [Verify] Error:', err);
    process.exit(1);
  }
}

runVerification();
