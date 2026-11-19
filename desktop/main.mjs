// AI generated (reviewed)
import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_ORIGIN = 'http://neus.localhost';
const APP_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/manifest.json', 'manifest.json'],
  ['/sw.js', 'sw.js'],
]);

function serveApp(request) {
  const url = new URL(request.url);
  // Chromium treats .localhost as secure and Cache Storage requires HTTP(S).
  // Electron handles this origin internally, without a listening socket.
  if (url.origin !== APP_ORIGIN) {
    // Preserve direct HTTP calls (such as Ollama) without following redirects in the main process.
    return net.fetch(request, {
      bypassCustomProtocolHandlers: true,
      credentials: 'omit',
      redirect: 'error',
    });
  }

  const file = APP_FILES.get(url.pathname);
  if (!file || request.method !== 'GET') return new Response(null, { status: 404 });
  return net.fetch(pathToFileURL(join(app.getAppPath(), file)).href);
}

function showApp() {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = URL.parse(url);
    if (target && target.origin !== APP_ORIGIN && ['http:', 'https:'].includes(target.protocol)) {
      void shell.openExternal(target.href).catch(console.error);
    }
    return { action: 'deny' };
  });

  const blockExternalNavigation = (event) => {
    const target = URL.parse(event.url);
    if (target?.protocol !== 'http:' || target.origin !== APP_ORIGIN) event.preventDefault();
  };
  window.webContents.on('will-frame-navigate', blockExternalNavigation);
  window.webContents.on('will-redirect', blockExternalNavigation);

  void window.loadURL(APP_ORIGIN).catch(console.error);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    protocol.handle('http', serveApp);
    app.on('activate', showApp);
    app.on('second-instance', () => {
      showApp();
      if (process.platform === 'darwin') app.focus({ steal: true });
    });
    showApp();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
