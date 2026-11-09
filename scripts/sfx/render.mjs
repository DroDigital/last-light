#!/usr/bin/env node
/**
 * Render every SFX patch (and the scripted scenes) offline in Chromium and
 * write 32-bit float WAVs, for measurement with scripts/sfx/measure.py.
 *
 *   npx vite --port 5199 &   # dev server
 *   node scripts/sfx/render.mjs out-dir [--synth] [names...]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');

const args = process.argv.slice(2);
const out = args.shift() ?? 'sfx-renders';
const synth = args.includes('--synth');
const only = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
await page.goto(`http://localhost:${process.env.PORT ?? 5199}/scripts/sfx/board.html`);
await page.waitForFunction(() => window.__sfx);
const names = only.length ? only : await page.evaluate(() => window.__sfx.names);
for (const name of names) {
  const b64 = await page.evaluate(([n, s]) => window.__sfx.renderWav(n, s), [name, synth]);
  fs.writeFileSync(path.join(out, `${name}.wav`), Buffer.from(b64, 'base64'));
  process.stdout.write(`${name} `);
}
console.log(`\n${names.length} renders -> ${out}`);
await browser.close();
