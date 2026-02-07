const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const inElectron = Boolean(process.versions && process.versions.electron);
if (!inElectron && !process.argv.includes('--electron-verify')) {
  try {
    const electronPath = require('electron');
    const result = spawnSync(electronPath, [__filename, '--electron-verify'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        ELECTRON_FORCE_IS_PACKAGED: '',
      },
    });
    process.exit(result.status ?? 1);
  } catch {
    // Fall through to Node-mode stub for environments without Electron binary.
  }
}

let app;
try {
  const electron = require('electron');
  app = electron && electron.app;
} catch {
  app = null;
}

async function runVerification() {
  if (!app || !app.getPath) {
    const fallbackUserData = path.join(__dirname, '../temp_verification_out', 'userData');
    fs.mkdirSync(fallbackUserData, { recursive: true });
    const electronModuleId = (() => {
      try {
        return require.resolve('electron');
      } catch {
        return null;
      }
    })();
    const fakeApp = {
      getPath: () => fallbackUserData,
      whenReady: () => Promise.resolve(),
      commandLine: { appendSwitch: () => {} },
    };
    if (electronModuleId) {
      require.cache[electronModuleId] = { exports: { app: fakeApp } };
    }
    app = fakeApp;
    console.log('🟡 [Verify] Electron app not detected, using stub getPath.');
  }

  console.log('🔵 [Verify] Initializing DB...');
  if (app && app.whenReady) {
    await app.whenReady();
  }

  const dbModulePath = path.join(__dirname, '../dist/main/db/index.js');
  if (!fs.existsSync(dbModulePath)) {
    console.error(`❌ [Verify] DB module missing: ${dbModulePath}`);
    console.error('👉 Please run: npm run build:electron');
    process.exit(1);
  }

  const { initDatabase } = require(dbModulePath);
  const db = initDatabase();

  console.log('✅ [Verify] DB Initialized.');

  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const tables = rows.map((r) => r.name).filter((name) => name !== 'sqlite_sequence');
  console.log('📋 [Verify] Tables:', tables);

  const expected = ['meta', 'episodes', 'shots', 'assets', 'tasks'];
  const missing = expected.filter((name) => !tables.includes(name));
  if (missing.length > 0) {
    console.error(`❌ [Verify] Missing tables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (app && app.getPath) {
    const dbPath = path.join(app.getPath('userData'), 'omni-director.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`❌ [Verify] Database file missing: ${dbPath}`);
      process.exit(1);
    }
  }

  console.log('✨ PASS: DB Schema matches expectation.');
  process.exit(0);
}

runVerification();
