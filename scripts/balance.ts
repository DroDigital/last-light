/**
 * Headless balance simulator: a bot plays complete runs through the real sim
 * (World + Director + Build drafts), no rendering. Prints where runs end and
 * how much hull each encounter costs.
 *
 *   npx vite-node scripts/balance.ts [runs=12] [skill=good|ok|poor] [hull=lantern]
 */
import { Vector3, Quaternion } from 'three';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { emptyControls } from '../src/game/player';
import { Director, type EncounterKind } from '../src/game/run';
import { WEAPONS } from '../src/data/weapons';
import { aim } from '../src/game/weapons';
import { Rng } from '../src/core/rng';

const runs = Number(process.argv[2] ?? 12);
const skill = (process.argv[3] ?? 'ok') as 'good' | 'ok' | 'poor';
const hullId = process.argv[4] ?? 'lantern';
const SKILL = {
  // turn gain, aim noise (rad), reaction dodge chance/s near bullets, kite distance
  good: { gain: 14, noise: 0.01, dodge: 2.5, kite: 45, ability: true },
  ok: { gain: 9, noise: 0.035, dodge: 0.9, kite: 35, ability: true },
  poor: { gain: 6, noise: 0.07, dodge: 0.2, kite: 25, ability: false },
}[skill];

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });
const PATH: EncounterKind[] = ['combat', 'combat', 'elite', 'combat', 'boss'];
const DT = 1 / 60;
const _v = new Vector3();
const _q = new Quaternion();

interface EncLog {
  s: number;
  kind: string;
  t: number;
  hullLost: number;
  hullEnd: number;
  dmgTaken: number;
  cause?: string;
}

function playEncounter(w: World, kind: EncounterKind, sector: number, seed: number, rng: Rng): { died: boolean; log: EncLog } {
  w.clearArena();
  w.motes.n = 0;
  w.debris.n = 0;
  w.proj.clear();
  w.eproj.clear();
  const pl = w.player;
  pl.pos.set(0, 0, 70);
  pl.prev.copy(pl.pos);
  pl.vel.set(0, 0, -30);
  pl.quat.identity();
  pl.prevQuat.identity();
  pl.shield = pl.maxShield;
  pl.boostEnergy = 1;
  pl.dodgeCharges = w.build.ship.dodges;
  pl.flareT = 0;
  const hull0 = pl.hull;
  const dmg0 = w.stats.damageTaken;
  const dir = new Director(kind, sector, seed, w, 0);
  const c = emptyControls();
  let t = 0;
  const limit = kind === 'boss' ? 60 * 300 : 60 * 180;
  for (; t < limit && !dir.done && pl.alive; t++) {
    c.mx = c.my = c.mz = c.yaw = c.pitch = 0;
    c.dodge = c.ability1 = c.ability2 = c.flare = false;
    const tgt = w.nearestEnemy(pl.pos.x, pl.pos.y, pl.pos.z, 400);
    const beacon = dir.beacons.find((b) => !b.lit);
    const goal = beacon && (!tgt || tgt.pos.distanceTo(pl.pos) > 35) ? beacon.pos : tgt?.pos;
    if (goal) {
      const dist = goal.distanceTo(pl.pos);
      const lead = tgt && goal === tgt.pos ? dist / Math.max(150, w.build.primary.params.speed) : 0;
      _v.copy(goal);
      if (tgt && goal === tgt.pos) _v.addScaledVector(tgt.vel, lead);
      _v.sub(pl.pos).applyQuaternion(_q.copy(pl.quat).invert()).normalize();
      const n = () => (rng.next() - 0.5) * 2 * SKILL.noise;
      c.yaw = Math.max(-4, Math.min(4, Math.atan2(_v.x, -_v.z) * SKILL.gain)) * DT + n();
      c.pitch = Math.max(-4, Math.min(4, -Math.atan2(_v.y, -_v.z) * SKILL.gain)) * DT + n();
      const onBeacon = beacon && goal === beacon.pos;
      c.mz = onBeacon ? (dist > 6 ? 1 : 0) : dist > SKILL.kite + 25 ? 1 : dist < SKILL.kite - 10 ? -0.7 : 0.15;
      c.mx = Math.sin(t * 0.012) * 0.7;
      c.fire1 = true;
      c.fire2 = t % 30 < 20;
    }
    // reactive dodge when enemy rounds are close
    let near = false;
    const E = w.eproj;
    for (let i = 0; i < E.n && !near; i++) {
      const dx = E.x[i]! - pl.pos.x;
      const dy = E.y[i]! - pl.pos.y;
      const dz = E.z[i]! - pl.pos.z;
      if (dx * dx + dy * dy + dz * dz < 64) near = true;
    }
    if (near && rng.next() < SKILL.dodge * DT * 8) c.dodge = true;
    if (SKILL.ability && t % 240 === 0) c.ability1 = true;
    if (SKILL.ability && t % 400 === 200) c.ability2 = true;
    if (pl.lumen >= 100) c.flare = true;
    c.boost = false;
    dir.update(DT);
    w.update(c, DT);
  }
  return {
    died: !pl.alive,
    log: { s: sector, kind, t: Math.round(t / 60), hullLost: Math.round(hull0 - Math.max(0, pl.hull)), hullEnd: Math.round(Math.max(0, pl.hull)), dmgTaken: Math.round(w.stats.damageTaken - dmg0), cause: pl.alive ? undefined : pl.deathCause },
  };
}

function playRun(seed: number): { reached: string; logs: EncLog[]; won: boolean } {
  const rng = new Rng(seed);
  const b = new Build(HULLS.find((h) => h.id === hullId)!, meta());
  const w = new World('BAL' + seed, b);
  w.refreshParams();
  const logs: EncLog[] = [];
  for (let s = 0; s < 5; s++) {
    for (let e = 0; e < PATH.length; e++) {
      const kind = PATH[e]!;
      const r = playEncounter(w, kind, s, seed * 100 + s * 10 + e, rng);
      logs.push(r.log);
      if (r.died) return { reached: `S${s + 1} ${kind} #${e + 1}`, logs, won: false };
      // a draft after every fight; a random pick models an average player
      const cards = b.draft(rng.fork('d' + s + e), { minRarity: kind === 'boss' ? 'rare' : undefined });
      if (cards.length) b.apply(cards[rng.int(0, cards.length - 1)]!);
      w.refreshParams();
      // one rest stop per sector (map always offers one): repair 50%
      if (e === 2) w.player.hull = Math.min(w.player.maxHull, w.player.hull + w.player.maxHull * 0.5);
    }
  }
  return { reached: 'WON', logs, won: true };
}

aim.strength = 0.5;
aim.cone = 0.1;
const results = [];
for (let i = 0; i < runs; i++) {
  const r = playRun(1000 + i);
  results.push(r);
  console.log(`run ${i}: ${r.reached}  ` + r.logs.map((l) => `${l.s + 1}${l.kind[0]}:${l.t}s/-${l.hullLost}`).join(' '));
}
const wins = results.filter((r) => r.won).length;
const bySector = [0, 0, 0, 0, 0];
for (const r of results) if (!r.won) bySector[Number(r.reached[1]) - 1]!++;
const all = results.flatMap((r) => r.logs);
const avg = (k: string) => {
  const xs = all.filter((l) => l.kind === k);
  return xs.length ? `${k}: ${(xs.reduce((a, l) => a + l.t, 0) / xs.length).toFixed(0)}s, -${(xs.reduce((a, l) => a + l.hullLost, 0) / xs.length).toFixed(1)} hull, ${(xs.reduce((a, l) => a + l.dmgTaken, 0) / xs.length).toFixed(0)} raw dmg` : '';
};
console.log(`\nskill=${skill} hull=${hullId}  wins ${wins}/${runs}  deaths by sector ${bySector.join('/')}`);
console.log([avg('combat'), avg('elite'), avg('boss')].join('\n'));
const rows = [0, 1, 2, 3, 4].map((sct) => {
  const xs = all.filter((l) => l.s === sct);
  const raw = xs.reduce((a, l) => a + l.dmgTaken, 0) / Math.max(1, xs.length);
  const bossT = xs.filter((l) => l.kind === 'boss');
  return `S${sct + 1}: ${xs.length} fights, raw dmg/fight ${raw.toFixed(0)}, hull lost/fight ${(xs.reduce((a, l) => a + l.hullLost, 0) / Math.max(1, xs.length)).toFixed(1)}, boss ${bossT.length ? (bossT.reduce((a, l) => a + l.t, 0) / bossT.length).toFixed(0) + 's' : '-'}`;
});
console.log(rows.join('\n'));
const causes = new Map<string, number>();
for (const l of all) if (l.cause) causes.set(l.cause, (causes.get(l.cause) ?? 0) + 1);
console.log('deaths:', [...causes].map(([k, v]) => `${k} x${v}`).join(', '));
