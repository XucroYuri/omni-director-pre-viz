import { app, BrowserWindow, protocol } from 'electron';
import * as path from 'node:path';
import { initDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { loadLocalEnvFiles } from './loadEnv';
import { registerMediaProtocol } from './services/mediaProtocol';

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

function isDev() {
  return process.env.NODE_ENV === 'development';
}

function getPreloadPath() {
  return path.join(app.getAppPath(), 'dist', 'preload', 'preload.js');
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

  if (isDev()) {
    await mainWindow.loadURL('http://127.0.0.1:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    mainWindow.show();
  } else {
    const indexHtml = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
    await mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
