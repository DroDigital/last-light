import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveAssetPath, windowOptions } = require('../desktop/config.cjs') as {
  resolveAssetPath: (root: string, url: string) => string | null;
  windowOptions: () => { webPreferences: Record<string, boolean> };
};

describe('desktop application security', () => {
  const root = '/opt/last-light/dist';
  it('serves bundled assets from the app origin', () => {
    expect(resolveAssetPath(root, 'lastlight://game/index.html')).toBe('/opt/last-light/dist/index.html');
    expect(resolveAssetPath(root, 'lastlight://game/music/a.mp3')).toBe('/opt/last-light/dist/music/a.mp3');
    expect(resolveAssetPath(root, 'lastlight://game/')).toBe('/opt/last-light/dist/index.html');
  });
  it('rejects foreign origins, malformed paths and traversal', () => {
    expect(resolveAssetPath(root, 'https://game/index.html')).toBeNull();
    expect(resolveAssetPath(root, 'lastlight://other/index.html')).toBeNull();
    expect(resolveAssetPath(root, 'lastlight://game/%2e%2e%2fsecret')).toBeNull();
    expect(resolveAssetPath(root, 'lastlight://game/%00')).toBeNull();
    expect(resolveAssetPath(root, 'not a url')).toBeNull();
  });
  it('isolates the renderer from Node APIs', () => {
    expect(windowOptions().webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
  });
});
