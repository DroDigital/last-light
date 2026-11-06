'use strict';

const { app, BrowserWindow, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveAssetPath, windowOptions } = require('./config.cjs');

// A standard secure origin lets Vite's ES modules, media, and IndexedDB work
// without disabling Chromium's security rules or exposing Node to the page.
protocol.registerSchemesAsPrivileged([{
  scheme: 'lastlight',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

function createWindow() {
  const window = new BrowserWindow(windowOptions());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!resolveAssetPath(path.join(__dirname, '..', 'dist'), url)) event.preventDefault();
  });
  void window.loadURL('lastlight://game/index.html');
}

app.whenReady().then(() => {
  const root = path.join(__dirname, '..', 'dist');
  protocol.handle('lastlight', (request) => {
    const file = resolveAssetPath(root, request.url);
    if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { method: request.method, headers: request.headers });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
