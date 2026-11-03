// Automated playtest: launches the built game in headless Chromium, drives it
// through scripted input, captures screenshots and console errors.
// usage: node scripts/play.mjs <outdir> [scenario]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const out = process.argv[2] || 'shots';
const scenario = process.argv[3] || 'basic';
const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(2500);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const ll = (fn, arg) => page.evaluate(fn, arg);
await shot('01-title');

if (scenario === 'basic' || scenario === 'full') {
  await ll(() => window.__ll.startRun({ seed: 'TEST1' }));
  await page.waitForTimeout(3500);
  await shot('02-map');
  await ll(() => window.__ll.chooseNode(window.__ll.reachable()[0].id));
  await page.waitForTimeout(3500);
  await shot('03-combat-start');
  // fly + shoot
  await ll(() => { const i = window.__ll.input; i.synthetic.add('fire1'); i.synthetic.add('forward'); i.syntheticAimX = 0.4; });
  await page.waitForTimeout(4000);
  await shot('04-combat-firing');
  await ll(() => { const g = window.__ll; g.world.player.lumen = 100; g.controls.flare = true; });
  await page.waitForTimeout(1500);
  await shot('05-flare');
  await ll(() => { window.__ll.input.syntheticAimX = -0.6; window.__ll.input.synthetic.add('fire2'); });
  await page.waitForTimeout(5000);
  await shot('06-combat-later');
  const st = await ll(() => { const g = window.__ll; return { state: g.state, kills: g.world.stats.kills, hp: g.world.player.hull, enemies: g.world.enemies.length, fps: g.fps, dc: g.pipe.drawCalls }; });
  console.log(JSON.stringify(st));
  await ll(() => window.__ll.openDraft({ after: 'map' }));
  await page.waitForTimeout(1200);
  await shot('07-draft');
  await ll(() => window.__ll.pickCard(0));
  await page.waitForTimeout(500);
  await ll(() => window.__ll.startEncounter('boss', 5));
  await page.waitForTimeout(6000);
  await shot('08-boss');
  await ll(() => { window.__ll.camMode = 'cockpit'; });
  await page.waitForTimeout(1500);
  await shot('09-cockpit');
  await ll(() => { window.__ll.camMode = 'chase'; window.__ll.godMode = false; window.__ll.world.killPlayer('Test'); });
  await page.waitForTimeout(3500);
  await shot('10-death');
}
if (scenario === 'diag') {
  await ll(() => window.__ll.startRun({ seed: 'TEST1' }));
  await page.waitForTimeout(1500);
  await ll(() => window.__ll.startEncounter('combat', 3));
  await ll(() => { const i = window.__ll.input; i.synthetic.add('fire1'); window.__ll.autopilot = true; });
  await ll(() => window.__ll.simulate(12));
  await page.waitForTimeout(800);
  await shot('d1');
  await ll(() => { window.__ll.pipe.look.bloom = 0; });
  await page.waitForTimeout(500);
  await shot('d2-nobloom');
  await ll(() => { window.__ll.pipe.look.bloom = 0.9; window.__ll.view.space.dust.visible = false; });
  await page.waitForTimeout(500);
  await shot('d3-nodust');
  const st = await ll(() => { const g = window.__ll; return { kills: g.world.stats.kills, live: g.world.liveEnemyCount(), proj: g.world.proj.n, hp: g.world.player.hull, pos: g.world.player.pos.toArray().map(Math.round), cam: g.view.camera.position.toArray().map(Math.round) }; });
  console.log(JSON.stringify(st));
}
if (scenario === 'look') {
  await ll(() => window.__ll.startRun({ seed: 'LOOK' }));
  await page.waitForTimeout(1200);
  await shot('l0-map');
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 11); g.input.synthetic.add('fire1'); g.autopilot = true; g.godMode = true; });
  await ll(() => window.__ll.simulate(9));
  await page.waitForTimeout(1200);
  await shot('l1-combat');
  await ll(() => window.__ll.simulate(3));
  await page.waitForTimeout(400);
  await shot('l2-combat');
  await ll(() => { const g = window.__ll; g.world.player.lumen = 100; g.controls.flare = true; g.simulate(1.0); });
  await page.waitForTimeout(500);
  await shot('l3-flare');
  for (const s of [1, 2, 3, 4]) {
    await ll((s) => { const g = window.__ll; g.enterSector(s, true); }, s);
    await page.waitForTimeout(400);
    await ll(() => { const g = window.__ll; g.startEncounter('boss', 9); g.input.synthetic.add('fire1'); g.autopilot = true; g.godMode = true; g.simulate(7); });
    await page.waitForTimeout(1200);
    await shot('l-boss' + s);
  }
}
if (scenario === 'ship') {
  await ll(() => window.__ll.startRun({ seed: 'LOOK' }));
  await page.waitForTimeout(800);
  for (const h of ['lantern', 'moth', 'bastion', 'prism', 'ember', 'wraith']) {
    await ll((h) => { const g = window.__ll; g.view.setHull(h, '#fff0c0'); g.startEncounter('combat', 11); g.director.spawnCd = 999; g.world.enemies.forEach((e) => { if (e.def.role !== 'inert') e.alive = false; }); g.input.syntheticAimX = 0.15; g.simulate(1); }, h);
    await page.waitForTimeout(700);
    await shot('s-' + h);
  }
}
if (scenario === 'stress') {
  await ll(() => window.__ll.startRun({ seed: 'STRESS' }));
  await page.waitForTimeout(3000);
  await ll(() => window.__ll.stress());
  await ll(() => { const i = window.__ll.input; i.synthetic.add('fire1'); i.syntheticAimX = 0.3; });
  await page.waitForTimeout(5000);
  await shot('stress');
  const st = await ll(() => { const g = window.__ll; return { fps: g.fps, sim: g.loop.simMs, render: g.loop.renderMs, dc: g.pipe.drawCalls, enemies: g.world.enemies.length, eproj: g.world.eproj.n, particles: g.view.particles.liveEstimate() }; });
  console.log(JSON.stringify(st));
}
if (scenario === 'menus') {
  await ll(() => window.__ll.goHearth()); await page.waitForTimeout(800); await shot('m-hearth');
  await ll(() => { const g = window.__ll; g.setState('codex'); g.ui.show('x',''); }); 
  await page.evaluate(() => document.querySelector('[data-act=title]')?.click());
  await page.evaluate(() => { window.__ll.ui.root.querySelector('[data-act]'); });
  await ll(() => window.__ll.goTitle()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForTimeout(500); await shot('m-settings');
}
console.log('ERRORS:\n' + (errors.slice(0, 30).join('\n') || 'none'));
await browser.close();
server.close();
