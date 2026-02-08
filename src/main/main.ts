import { app, BrowserWindow, protocol } from 'electron';
import * as path from 'node:path';
import { initDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { loadLocalEnvFiles } from './loadEnv';
import { registerMediaProtocol } from './services/mediaProtocol';

function isBrokenPipeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EPIPE');
}

function installStdioBrokenPipeGuards() {
  let stdioBroken = false;

  const patchWrite = (stream: NodeJS.WriteStream | undefined | null) => {
    if (!stream) return;

    const originalWrite = stream.write.bind(stream);
    (stream as any).write = (...args: any[]) => {
      if (stdioBroken) return false;
      try {
        return originalWrite(...args);
      } catch (error: unknown) {
        if (isBrokenPipeError(error)) {
          stdioBroken = true;
          return false;
        }
        throw error;
      }
    };

    stream.on('error', (error: unknown) => {
      if (isBrokenPipeError(error)) {
        stdioBroken = true;
      }
    });
  };

  patchWrite(process.stdout);
  patchWrite(process.stderr);

  const methods: Array<'log' | 'info' | 'warn' | 'error'> = ['log', 'info', 'warn', 'error'];
  for (const method of methods) {
    const original = console[method].bind(console);
    (console as any)[method] = (...args: any[]) => {
      if (stdioBroken) return;
      try {
        original(...args);
      } catch (error: unknown) {
        if (isBrokenPipeError(error)) {
          stdioBroken = true;
          return;
        }
        throw error;
      }
    };
  }
}

installStdioBrokenPipeGuards();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'omni-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
const DEV_SERVER_URL = 'http://127.0.0.1:3000';
const DEV_RETRY_DELAY_MS = 1200;
const DEV_MAX_LOAD_RETRIES = 30;

function isDev() {
  return process.env.NODE_ENV === 'development';
}

function getPreloadPath() {
  return path.join(app.getAppPath(), 'dist', 'preload', 'preload.js');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDevOfflineHtml(lastError?: string) {
  const safeError = lastError?.replace(/[<>&"]/g, '') || 'Unknown error';
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><title>Omni Director - Dev Server Offline</title></head>',
    '<body style="margin:0;background:#0f1115;color:#cbd5e1;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">',
    '<div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">',
    '<div style="max-width:700px;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:20px;background:rgba(255,255,255,.03)">',
    '<h2 style="margin:0 0 12px;font-size:18px;color:#f8fafc;">前端开发服务暂时不可用</h2>',
    '<p style="margin:0 0 8px;line-height:1.6;">应用正在等待 Vite 服务恢复（默认地址 127.0.0.1:3000）。窗口会自动重连。</p>',
    `<p style="margin:0 0 14px;line-height:1.6;color:#fca5a5;">最近错误：${safeError}</p>`,
    '<p style="margin:0;color:#94a3b8;line-height:1.6;">若你在终端运行，请确认 <code>npm run dev</code> 进程仍在。</p>',
    '</div></div></body></html>',
  ].join('');
}

async function loadMainContent(win: BrowserWindow) {
  if (!isDev()) {
    const indexHtml = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
    await win.loadFile(indexHtml);
    return;
  }

  let lastErrorMessage = '';
  for (let attempt = 1; attempt <= DEV_MAX_LOAD_RETRIES; attempt += 1) {
    try {
      await win.loadURL(DEV_SERVER_URL);
      return;
    } catch (error: any) {
      lastErrorMessage = error?.message || String(error);
      console.error(
        `[main] Failed to load dev server (attempt ${attempt}/${DEV_MAX_LOAD_RETRIES}): ${lastErrorMessage}`,
      );
      await sleep(DEV_RETRY_DELAY_MS);
    }
  }

  const offlineHtml = createDevOfflineHtml(lastErrorMessage);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml)}`);
}

function attachDevRecovery(win: BrowserWindow) {
  if (!isDev()) return;

  let reloadTimer: NodeJS.Timeout | null = null;
  const scheduleReload = (reason: string) => {
    if (win.isDestroyed()) return;
    if (reloadTimer) return;
    console.warn(`[main] Scheduling renderer reload: ${reason}`);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (win.isDestroyed()) return;
      win.loadURL(DEV_SERVER_URL).catch((error) => {
        console.error(`[main] Dev reload failed: ${error?.message || error}`);
        scheduleReload('dev server still unavailable');
      });
    }, DEV_RETRY_DELAY_MS);
  };

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(
      `[main] did-fail-load (${errorCode}) ${errorDescription} @ ${validatedURL || DEV_SERVER_URL}`,
    );
    scheduleReload('did-fail-load');
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[main] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    scheduleReload(`render-process-gone:${details.reason}`);
  });

  win.webContents.on('unresponsive', () => {
    console.warn('[main] Renderer became unresponsive');
  });

  win.on('closed', () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  });
}

async function createMainWindow() {
  registerIpcHandlers();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !isDev(),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  attachDevRecovery(mainWindow);
  await loadMainContent(mainWindow);

  if (isDev()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    mainWindow.show();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    loadLocalEnvFiles();
    initDatabase();
    registerMediaProtocol();
    await createMainWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
