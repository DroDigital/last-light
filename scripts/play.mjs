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
if (scenario === 'fullrun') {
  const log = await page.evaluate(async () => {
    const g = window.__ll;
    const out = [];
    g.startRun({ seed: 'FULLRUN' });
    g.godMode = true; g.autopilot = true; g.input.synthetic.add('fire1'); g.input.synthetic.add('fire2'); g.input.synthetic.add('forward');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let guard = 0;
    while (guard++ < 250) {
      if (g.state === 'victory') { out.push('VICTORY'); break; }
      if (g.state === 'warp') { g.simulate(0); await wait(50); for (let i = 0; i < 40 && g.state === 'warp'; i++) { g.render(0, 0.1); } continue; }
      if (g.state === 'map') { const r = g.reachable(); const n = r.find((x) => x.type === 'boss') || r[0]; out.push(`S${g.run.sector} -> ${n.type}`); g.chooseNode(n.id); continue; }
      if (g.state === 'combat') {
        let t = 0; while (g.state === 'combat' && t < 400) { g.simulate(2); t += 2; }
        out.push(`  combat ${g.director ? g.director.kind : ''} t=${t} kills=${g.world.stats.kills} state=${g.state}${g.world.boss ? ' bossdead=' + g.world.boss.dead : ''}`);
        if (t >= 400) { out.push('STUCK in combat: live=' + g.world.liveEnemyCount() + ' spent=' + g.director?.spent + '/' + g.director?.budget); break; }
        continue;
      }
      if (g.state === 'draft') { g.pickCard(0); continue; }
      if (g.state === 'shop') { g.buy(0); g.openMap(); continue; }
      if (g.state === 'event') { g.chooseEvent(0); await wait(1200); if (g.state === 'event') g.openMap(); continue; }
      if (g.state === 'forge') { g.forgeAction('leave', ''); continue; }
      if (g.state === 'rest') { g.restAction('repair', ''); continue; }
      out.push('unknown state ' + g.state); break;
    }
    out.push(`final state=${g.state} sector=${g.run && g.run.sector} kills=${g.world && g.world.stats.kills} bosses=${g.world && g.world.stats.bossKills} embers=${g.save.data.embers}`);
    return out;
  });
  console.log(log.join('\n'));
}
if (scenario === 'cam') {
  // camera must stay on the ship (3rd/1st person) in every in-run state
  await ll(() => window.__ll.startRun({ seed: 'CAM' }));
  await page.waitForTimeout(800);
  const dist = () => ll(() => { const g = window.__ll; return { state: g.state, d: +g.view.camera.position.distanceTo(g.world.player.pos).toFixed(1) }; });
  const out = [];
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 3); g.autopilot = true; g.godMode = true; g.input.synthetic.add('fire1'); g.simulate(4); });
  await page.waitForTimeout(600); out.push(await dist());
  await ll(() => window.__ll.openDraft({ after: 'map' })); await page.waitForTimeout(800); out.push(await dist());
  await ll(() => window.__ll.openShop(4)); await page.waitForTimeout(800); out.push(await dist());
  await ll(() => window.__ll.openEvent(4)); await page.waitForTimeout(800); out.push(await dist());
  await ll(() => { const g = window.__ll; g.setState('rest'); }); await page.waitForTimeout(600); out.push(await dist());
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 5); g.world.killPlayer('Test'); g.simulate(3); }); await page.waitForTimeout(800); out.push(await dist());
  console.log(JSON.stringify(out));
  await ll(() => { const g = window.__ll; g.startRun({ seed: 'CAM2' }); });
  await page.waitForTimeout(500);
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 9); g.godMode = false; g.camMode = 'cockpit'; g.input.synthetic.add('forward'); g.simulate(5); g.world.player.hull = 25; g.world.player.lumen = 100; g.world.player.shockCd = 4.2; });
  await page.waitForTimeout(1200);
  await shot('cockpit');
  await ll(() => { const g = window.__ll; g.camMode = 'chase'; });
  await page.waitForTimeout(800);
  await shot('chase');
}
if (scenario === 'drift') {
  await ll(() => window.__ll.startRun({ seed: 'DRIFT' }));
  await page.waitForTimeout(500);
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 3); g.godMode = true; g.director.spawnCd = 1e9; });
  await page.mouse.move(1100, 150); // cursor resting far off-centre, pointer not locked
  const sample = () => ll(() => {
    const g = window.__ll; const pl = g.world.player; const cam = g.view.camera;
    const local = cam.position.clone().sub(pl.pos).applyQuaternion(pl.quat.clone().invert());
    const f = pl.forward(cam.position.clone());
    return { fwd: f.toArray().map((x) => +x.toFixed(4)), camLocal: local.toArray().map((x) => +x.toFixed(2)) };
  });
  const a = await sample();
  await page.waitForTimeout(8000);
  const b = await sample();
  await ll(() => { const g = window.__ll; g.input.synthetic.add('boost'); });
  await page.waitForTimeout(2500);
  const c = await sample();
  console.log(JSON.stringify({ start: a, after8s: b, boosting: c }));
}
if (scenario === 'muzzle') {
  await ll(() => window.__ll.startRun({ seed: 'MUZ' }));
  await page.waitForTimeout(500);
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 3); g.godMode = true; g.director.spawnCd = 1e9; g.world.enemies.forEach((e) => (e.alive = false)); g.input.synthetic.add('fire1'); });
  await page.waitForTimeout(1500);
  await shot('muzzle');
  await ll(() => { const g = window.__ll; g.input.synthetic.delete('fire1'); g.input.synthetic.add('fire2'); });
  await page.waitForTimeout(900);
  await shot('muzzle2');
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
  await ll(() => window.__ll.goHearth()); await page.waitForTimeout(900); await shot('m-hearth');
  await ll(() => { const g = window.__ll; g.hearthTab = 'hulls'; g.ui.root.querySelector('[data-act=htab][data-arg=hulls]').click(); }); await page.waitForTimeout(400); await shot('m-hulls');
  await ll(() => window.__ll.goTitle()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act=settings]').click()); await page.waitForTimeout(500); await shot('m-settings');
  await page.evaluate(() => document.querySelector('[data-act=stab][data-arg=access]').click()); await page.waitForTimeout(300); await shot('m-access');
  await page.evaluate(() => document.querySelector('[data-act=back]').click()); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act=codex]').click()); await page.waitForTimeout(500); await shot('m-codex');
  await ll(() => { const g = window.__ll; g.startRun({ seed: 'MENU' }); });
  await page.waitForTimeout(800);
  await ll(() => { const g = window.__ll; g.world.player.light = 400; g.openDraft({ after: 'map' }); });
  await page.waitForTimeout(1200); await shot('m-draft');
  await ll(() => { const g = window.__ll; g.openShop(5); }); await page.waitForTimeout(700); await shot('m-shop');
  await ll(() => { const g = window.__ll; g.openEvent(3); }); await page.waitForTimeout(700); await shot('m-event');
  await ll(() => { const g = window.__ll; g.setState('forge'); window.__llS?.showForge?.(g); }); 
  await ll(() => { const g = window.__ll; g.startEncounter('combat', 2); g.simulate(2); g.world.killPlayer('Gunship'); g.simulate(3); });
  await page.waitForTimeout(1500); await shot('m-death');
}
console.log('ERRORS:\n' + (errors.slice(0, 30).join('\n') || 'none'));
await browser.close();
server.close();
