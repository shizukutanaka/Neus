// @vitest-environment node
// AI generated (reviewed)
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  app: {
    requestSingleInstanceLock: vi.fn(),
    whenReady: vi.fn(async () => {}),
    getAppPath: vi.fn(() => process.cwd()),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows: vi.fn() }),
  protocol: { handle: vi.fn() },
  net: { fetch: vi.fn(async () => new Response('bundled asset')) },
  shell: { openExternal: vi.fn(async () => {}) },
}));

vi.mock('electron', () => electron);

let window;
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  window = {
    webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() },
    loadURL: vi.fn(async () => {}),
    isMinimized: vi.fn(() => true),
    restore: vi.fn(),
    focus: vi.fn(),
  };
  electron.BrowserWindow.mockImplementation(function () { return window; });
  electron.BrowserWindow.getAllWindows.mockReturnValue([]);
  electron.app.requestSingleInstanceLock.mockReturnValue(true);
});

describe('Electron shell', () => {
  it('loads the bundled app and only serves its allowlisted files', async () => {
    await import('../desktop/main.mjs');
    expect(window.loadURL).toHaveBeenCalledWith('http://neus.localhost');
    const [scheme, serve] = electron.protocol.handle.mock.calls[0];
    expect(scheme).toBe('http');
    for (const [path, file] of [
      ['/?test=1', 'index.html'],
      ['/index.html', 'index.html'],
      ['/sw.js', 'sw.js'],
      ['/manifest.json', 'manifest.json'],
    ]) {
      expect((await serve({ url: 'http://neus.localhost' + path, method: 'GET' })).ok).toBe(true);
      expect(electron.net.fetch).toHaveBeenLastCalledWith(pathToFileURL(join(process.cwd(), file)).href);
    }
    for (const url of ['http://neus.localhost/package.json', 'http://neus.localhost/%2Fsw.js']) {
      expect((await serve({ url, method: 'GET' })).status).toBe(404);
    }
    expect(electron.net.fetch).toHaveBeenCalledTimes(4);
    const ollama = { url: 'http://localhost:11434/api/chat', method: 'POST' };
    await serve(ollama);
    expect(electron.net.fetch).toHaveBeenLastCalledWith(ollama, { bypassCustomProtocolHandlers: true });
  });

  it('isolates the renderer and denies external navigation and new windows', async () => {
    await import('../desktop/main.mjs');
    expect(electron.BrowserWindow.mock.calls[0][0].webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    const [open] = window.webContents.setWindowOpenHandler.mock.calls[0];
    expect(open({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
    expect(open({ url: 'http://example.com/' })).toEqual({ action: 'deny' });
    expect(open({ url: 'http://neus.localhost/' })).toEqual({ action: 'deny' });
    expect(open({ url: 'file:///example' })).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal.mock.calls).toEqual([['https://example.com/'], ['http://example.com/']]);

    for (const name of ['will-frame-navigate', 'will-redirect']) {
      const [, navigate] = window.webContents.on.mock.calls.find(([event]) => event === name);
      const preventDefault = vi.fn();
      navigate({ url: 'http://neus.localhost/index.html', preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      navigate({ url: 'https://example.com/', preventDefault });
      navigate({ url: 'blob:http://neus.localhost/id', preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(2);
    }
  });

  it('quits when the lock belongs to another instance', async () => {
    electron.app.requestSingleInstanceLock.mockReturnValue(false);
    await import('../desktop/main.mjs');
    expect(electron.app.quit).toHaveBeenCalledOnce();
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
  });

  it('restores and focuses the existing window when invoked again', async () => {
    await import('../desktop/main.mjs');
    electron.BrowserWindow.getAllWindows.mockReturnValue([window]);
    const [, onSecondInstance] = electron.app.on.mock.calls.find(([event]) => event === 'second-instance');
    onSecondInstance();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(electron.BrowserWindow).toHaveBeenCalledOnce();
  });
});
