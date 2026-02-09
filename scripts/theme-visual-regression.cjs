#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { app, BrowserWindow } = require('electron');

const THEMES = ['dark', 'light'];
const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 1000 },
  { name: 'mobile', width: 393, height: 852 },
];

const STORAGE_KEY = 'OMNI_DIRECTOR_THEME_MODE';

function parseArgs(argv) {
  const options = {
    baseline: '',
    out: '',
    url: '',
    threshold: 0.01,
    channelThreshold: 14,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--baseline' && next) {
      options.baseline = next;
      i += 1;
      continue;
    }
    if (arg === '--out' && next) {
      options.out = next;
      i += 1;
      continue;
    }
    if (arg === '--url' && next) {
      options.url = next;
      i += 1;
      continue;
    }
    if (arg === '--threshold' && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.threshold = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === '--channel-threshold' && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.channelThreshold = parsed;
      }
      i += 1;
      continue;
    }
  }

  return options;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function waitForLoad(win, timeoutMs = 20_000) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`did-finish-load timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onFail = (_event, errorCode, errorDescription, validatedURL) => {
      cleanup();
      reject(new Error(`Page load failed (${errorCode}) ${errorDescription}: ${validatedURL}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      win.webContents.removeListener('did-finish-load', onLoad);
      win.webContents.removeListener('did-fail-load', onFail);
    };

    win.webContents.once('did-finish-load', onLoad);
    win.webContents.once('did-fail-load', onFail);
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function setThemeAndStabilize(win, theme) {
  await win.webContents.executeJavaScript(
    `localStorage.setItem('${STORAGE_KEY}', '${theme}'); document.documentElement.setAttribute('data-theme-mode', '${theme}');`,
    true,
  );

  await win.webContents.executeJavaScript('window.location.reload();', true);
  await waitForLoad(win);
  await sleep(420);

  await win.webContents.executeJavaScript(
    `document.documentElement.setAttribute('data-theme-mode', '${theme}');`,
    true,
  );

  await sleep(120);
}

async function captureThemeViewport(win, pageUrl, outDir, theme, viewport) {
  win.setBounds({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  await win.loadURL(pageUrl);
  await sleep(220);

  await setThemeAndStabilize(win, theme);

  const image = await win.webContents.capturePage();
  const filename = `${theme}-${viewport.name}.png`;
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, image.toPNG());

  return { theme, viewport: viewport.name, width: viewport.width, height: viewport.height, path: filepath };
}

async function comparePng(currentPath, baselinePath, channelThreshold) {
  const current = await sharp(currentPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const baseline = await sharp(baselinePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (current.info.width !== baseline.info.width || current.info.height !== baseline.info.height) {
    return {
      matched: false,
      reason: 'dimension_mismatch',
      current: { width: current.info.width, height: current.info.height },
      baseline: { width: baseline.info.width, height: baseline.info.height },
      diffRatio: 1,
      diffPixels: current.info.width * current.info.height,
      totalPixels: current.info.width * current.info.height,
    };
  }

  const totalPixels = current.info.width * current.info.height;
  let diffPixels = 0;

  for (let p = 0; p < totalPixels; p += 1) {
    const i = p * 4;
    const dr = Math.abs(current.data[i] - baseline.data[i]);
    const dg = Math.abs(current.data[i + 1] - baseline.data[i + 1]);
    const db = Math.abs(current.data[i + 2] - baseline.data[i + 2]);
    const da = Math.abs(current.data[i + 3] - baseline.data[i + 3]);
    const avgDelta = (dr + dg + db + da) / 4;
    if (avgDelta > channelThreshold) {
      diffPixels += 1;
    }
  }

  return {
    matched: true,
    reason: 'ok',
    current: { width: current.info.width, height: current.info.height },
    baseline: { width: baseline.info.width, height: baseline.info.height },
    diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    diffPixels,
    totalPixels,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const distHtml = path.join(cwd, 'dist', 'renderer', 'index.html');
  const pageUrl = args.url || pathToFileURL(distHtml).toString();

  if (!args.url && !fs.existsSync(distHtml)) {
    throw new Error(`Renderer build not found: ${distHtml}. Run \"npx vite build\" first or pass --url.`);
  }

  const outDir = args.out
    ? path.resolve(cwd, args.out)
    : path.resolve(cwd, 'temp_verification_out', 'theme-regression', nowStamp());
  ensureDir(outDir);

  const baselineDir = args.baseline ? path.resolve(cwd, args.baseline) : '';
  if (baselineDir && !fs.existsSync(baselineDir)) {
    throw new Error(`Baseline directory not found: ${baselineDir}`);
  }

  await app.whenReady();

  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1000,
    backgroundColor: '#0d1522',
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const captures = [];

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      // Capture each pair under deterministic filename for baseline comparison.
      const capture = await captureThemeViewport(win, pageUrl, outDir, theme, viewport);
      captures.push(capture);
      console.log(`[theme-regression] captured ${capture.theme}/${capture.viewport}: ${capture.path}`);
    }
  }

  const report = {
    ok: true,
    pageUrl,
    outDir,
    baselineDir,
    threshold: args.threshold,
    channelThreshold: args.channelThreshold,
    captures,
    comparisons: [],
    generatedAt: new Date().toISOString(),
  };

  if (baselineDir) {
    for (const capture of captures) {
      const filename = `${capture.theme}-${capture.viewport}.png`;
      const baselinePath = path.join(baselineDir, filename);
      if (!fs.existsSync(baselinePath)) {
        report.ok = false;
        report.comparisons.push({
          file: filename,
          status: 'missing_baseline',
          baselinePath,
          currentPath: capture.path,
        });
        console.warn(`[theme-regression] missing baseline: ${baselinePath}`);
        continue;
      }

      const compared = await comparePng(capture.path, baselinePath, args.channelThreshold);
      const exceeds = compared.diffRatio > args.threshold;
      if (exceeds) {
        report.ok = false;
      }

      report.comparisons.push({
        file: filename,
        status: exceeds ? 'diff_exceeds_threshold' : 'ok',
        baselinePath,
        currentPath: capture.path,
        ...compared,
      });

      const ratioPct = (compared.diffRatio * 100).toFixed(3);
      console.log(`[theme-regression] compare ${filename}: diff=${ratioPct}%`);
    }
  } else {
    console.log(`[theme-regression] baseline not provided. Captures generated at ${outDir}`);
    console.log('[theme-regression] use --baseline <dir> for diff mode.');
  }

  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[theme-regression] report: ${reportPath}`);

  await win.close();

  if (baselineDir && !report.ok) {
    throw new Error('Theme visual regression failed. See report.json for details.');
  }
}

run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(`[theme-regression] ${error.stack || error.message}`);
    app.exit(1);
  });
