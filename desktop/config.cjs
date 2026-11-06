'use strict';

const path = require('node:path');

/** Resolve only same-origin application assets beneath the bundled web root. */
function resolveAssetPath(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'lastlight:' || url.host !== 'game' || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return null;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    return file;
  } catch {
    return null;
  }
}

function windowOptions() {
  return {
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#080710',
    title: 'LAST LIGHT',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  };
}

module.exports = { resolveAssetPath, windowOptions };
