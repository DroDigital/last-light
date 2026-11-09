import { Vector3 } from 'three';
import type { World } from './world';
import { raySphere } from './world';
import type { Enemy } from './entities';
import type { BossController } from './bosses';
import { fireAt, ringBurst } from './ai';

/**
 * Boss signature moves. Every boss has its own set, built from a handful of
 * hazard primitives (Zone) and part launches (Flight). Each boss draws its
 * moves in its own colour on the vector layer (`BossController.fx`), so a
 * glance tells you whose attack is coming. Enemy rounds themselves keep the
 * shared enemy tone for readability.
 */
export type Signature =
  | 'drillLaunch'
  | 'scrapCage'
  | 'tractor'
  | 'mortarField'
  | 'coil'
  | 'breath'
  | 'dive'
  | 'lattice'
  | 'refract'
  | 'chorusSnipe'
  | 'pulseWave'
  | 'strobe'
  | 'magnetarSnap'
  | 'slagPools'
  | 'bellows'
  | 'kilnMortars'
  | 'horizonGrow'
  | 'lensing'
  | 'tidalShear'
  | 'judgment'
  | 'courtCharge'
  | 'jetSweep'
  | 'polarity'
  | 'shrapnel'
  | 'railLock'
  | 'masks'
  | 'eclipse'
  | 'swallow'
  | 'eyeLances'
  | 'umbraWave'
  | 'conveyor'
  | 'eruption'
  | 'requiem'
  | 'metronome'
  | 'pourStream'
  | 'accretion'
  | 'coronation'
  | 'ironStorm'
  | 'firstLight'
  | 'drain';

/** Which boss each signature belongs to (sets its colour, and what the Endless Night can borrow). */
export const SIG_OWNER: Record<Signature, string> = {
  drillLaunch: 'foreman', scrapCage: 'foreman', tractor: 'foreman', mortarField: 'foreman',
  coil: 'leviathan', breath: 'leviathan', dive: 'leviathan',
  lattice: 'glasschoir', refract: 'glasschoir', chorusSnipe: 'glasschoir',
  pulseWave: 'pulsarheart', strobe: 'pulsarheart', magnetarSnap: 'pulsarheart',
  slagPools: 'kilnmother', bellows: 'kilnmother', kilnMortars: 'kilnmother',
  horizonGrow: 'horizoneater', lensing: 'horizoneater', tidalShear: 'horizoneater',
  judgment: 'quasarregent', courtCharge: 'quasarregent', jetSweep: 'quasarregent',
  polarity: 'ironmagnetar', shrapnel: 'ironmagnetar', railLock: 'ironmagnetar',
  masks: 'endlessnight', eclipse: 'endlessnight',
  swallow: 'lastdark', eyeLances: 'lastdark', umbraWave: 'lastdark',
  conveyor: 'foreman', eruption: 'leviathan', requiem: 'glasschoir', metronome: 'pulsarheart', pourStream: 'kilnmother',
  accretion: 'horizoneater', coronation: 'quasarregent', ironStorm: 'ironmagnetar', firstLight: 'endlessnight', drain: 'lastdark',
};

export const SIGNATURES = new Set<string>(Object.keys(SIG_OWNER));

/** Display names, called out on the boss bar while a move runs. */
export const SIG_NAME: Record<Signature, string> = {
  drillLaunch: 'Drill Launch', scrapCage: 'Scrap Cage', tractor: 'Tractor Haul', mortarField: 'Mortar Walk', conveyor: 'Scrap Conveyor',
  coil: 'Constrict', breath: 'Cinder Breath', dive: 'Burning Dive', eruption: 'Eruption',
  lattice: 'Glass Lattice', refract: 'Refraction', chorusSnipe: 'Chorus of Lances', requiem: 'Requiem',
  pulseWave: 'Pulse Wave', strobe: 'Strobe', magnetarSnap: 'Magnetar Snap', metronome: 'Metronome',
  slagPools: 'Slag Pools', bellows: 'Bellows', kilnMortars: 'Kiln Barrage', pourStream: 'Molten Pour',
  horizonGrow: 'Swelling Horizon', lensing: 'Lensing', tidalShear: 'Tidal Shear', accretion: 'Accretion',
  judgment: 'Judgment', courtCharge: 'Court Charge', jetSweep: 'Jet Sweep', coronation: 'Coronation',
  polarity: 'Polarity', shrapnel: 'Shrapnel Shell', railLock: 'Rail Lock', ironStorm: 'Iron Storm',
  masks: 'Masks', eclipse: 'Eclipse', firstLight: 'The First Light',
  swallow: 'Swallow', eyeLances: 'Eye Lances', umbraWave: 'Umbra Wave', drain: 'Drain',
};

/** Each boss's vector colour (linear RGB, a little over 1 so it blooms). */
export const BOSS_COLOR: Record<string, [number, number, number]> = {
  foreman: [1.4, 0.75, 0.2],
  leviathan: [1.5, 0.45, 0.12],
  glasschoir: [1.4, 0.6, 1.3],
  pulsarheart: [0.95, 0.55, 1.5],
  kilnmother: [1.5, 0.6, 0.25],
  horizoneater: [1.3, 1.0, 0.7],
  quasarregent: [0.6, 1.2, 1.5],
  ironmagnetar: [1.3, 0.45, 0.3],
  endlessnight: [1.0, 1.15, 0.8],
  lastdark: [0.85, 0.35, 1.5],
};

/** Moves the Endless Night can borrow with its masks (they work from any body). */
const MASKABLE: Signature[] = [
  'scrapCage', 'mortarField', 'conveyor', 'refract', 'chorusSnipe', 'requiem', 'pulseWave', 'strobe', 'metronome', 'kilnMortars', 'pourStream',
  'lensing', 'accretion', 'judgment', 'coronation', 'railLock', 'ironStorm', 'swallow', 'shrapnel', 'polarity', 'tidalShear',
];

/**
 * A hazard primitive. All of them telegraph during `warm`, then do their thing.
 * - wave: a flat ring expanding in a plane (normal n). Leave the plane or dodge through it.
 * - shell: an expanding sphere. Dodge-roll or parry through it.
 * - pillar: a straight beam from a to b.
 * - mortar: a strike at a point; explodes once at the end of warm.
 * - dark: a sphere of darkness that grows at a point and lingers; it hurts inside.
 * - snipe: a lance from `src` that tracks the player, locks, then fires.
 * - lattice: beams between the boss's live parts.
 * - tractor: a pulling beam from the core (no damage).
 * - polarity: a field that alternately pulls and pushes.
 * - horizon: the core's event horizon swells and shrinks; it hurts inside.
 * - stream: a molten beam from `src` that chases you at a limited turn rate.
 * - spokes: beams radiating from `src`, rotating in a plane.
 * - chain: a beam that bounces from body to body (`nodes`) and ends on you.
 */
export interface Zone {
  kind: 'wave' | 'shell' | 'pillar' | 'mortar' | 'dark' | 'snipe' | 'lattice' | 'tractor' | 'polarity' | 'horizon' | 'stream' | 'spokes' | 'chain';
  t: number;
  warm: number;
  dur: number;
  a: Vector3;
  b: Vector3;
  r: number;
  speed: number;
  thick: number;
  dmg: number;
  col: [number, number, number];
  src: Enemy | null;
  /** polarity sign, snipe lock state, etc. */
  sign: number;
  /** chain: the bodies a beam bounces through, in order */
  nodes: Enemy[];
}

/** A boss part thrown at a point and pulled back to its mount. */
export interface Flight {
  t: number;
  out: number;
  hang: number;
  back: number;
  target: Vector3;
  from: Vector3;
  arrived: boolean;
  onArrive?: (p: Enemy) => void;
}

/** Global multiplier on hazard damage (sector, Heat and boss multipliers apply on top). */
export const ZONE_DAMAGE = 0.75;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Push a line onto the boss's vector layer. */
function seg(b: BossController, a: Vector3, c: Vector3, col: readonly number[], alpha: number): void {
  b.fx.push(0, a.x, a.y, a.z, c.x, c.y, c.z, col[0]!, col[1]!, col[2]!, alpha, 0);
}
/** Push a circle onto the boss's vector layer. */
function ring(b: BossController, c: Vector3, r: number, n: Vector3, col: readonly number[], alpha: number): void {
  b.fx.push(1, c.x, c.y, c.z, r, n.x, n.y, n.z, col[0]!, col[1]!, col[2]!, alpha);
}

/** Push a volumetric sphere (see Shells.put for the modes). */
function vol(b: BossController, c: Vector3, r: number, mode: number, col: readonly number[], inten: number, age: number): void {
  b.vol.push(c.x, c.y, c.z, r, mode, col[0]!, col[1]!, col[2]!, inten, age);
}

function zone(b: BossController, z: Partial<Zone> & Pick<Zone, 'kind' | 'warm' | 'dur'>): Zone {
  const full: Zone = { t: 0, a: new Vector3(), b: new Vector3(), r: 0, speed: 0, thick: 2, dmg: 14, col: b.color, src: null, sign: 1, nodes: [], ...z };
  // hazard damage is tuned as a set: the numbers above read like the old beams, the scale keeps dense moves fair
  full.dmg *= ZONE_DAMAGE;
  b.zones.push(full);
  return full;
}

/** Random unit vector from the world rng (deterministic). */
function rndDir(w: World, out: Vector3): Vector3 {
  return out.set(w.rng.range(-1, 1), w.rng.range(-1, 1), w.rng.range(-1, 1)).normalize();
}

/** Where the player will be in `s` seconds if they keep flying straight. */
function lead(w: World, s: number, out: Vector3): Vector3 {
  return out.copy(w.player.pos).addScaledVector(w.player.vel, s);
}

function liveParts(b: BossController, filter?: (p: Enemy) => boolean): Enemy[] {
  return b.parts.filter((p) => p.alive && (!filter || filter(p)));
}

/** Throw a part at a point; it hangs there, then returns to its mount. */
export function launch(b: BossController, p: Enemy, target: Vector3, out: number, hang: number, back: number, onArrive?: (p: Enemy) => void): void {
  b.flights.set(p, { t: 0, out, hang, back, target: target.clone(), from: p.pos.clone(), arrived: false, onArrive });
}

/** Called once when a signature starts. */
export function startSignature(b: BossController, w: World, sig: Signature): void {
  const core = b.core;
  const pl = w.player;
  const ph = b.phase;
  b.sigI = 0;
  b.sigNext = 0;
  b.sigList = [];
  switch (sig) {
    case 'drillLaunch':
      b.sigList = liveParts(b, (p) => p.partIndex < 4);
      break;
    case 'courtCharge':
      b.sigList = liveParts(b, (p) => p.partIndex >= 2);
      break;
    case 'shrapnel':
      b.sigList = liveParts(b);
      break;
    case 'scrapCage':
      w.addTelegraph({ kind: 'sphere', ax: pl.pos.x, ay: pl.pos.y, az: pl.pos.z, bx: 0, by: 0, bz: 0, radius: 22, dur: 0.8, owner: core.id });
      break;
    case 'tractor':
      zone(b, { kind: 'tractor', warm: 0.5, dur: 2.6 + ph * 0.4, src: core, speed: 26 + ph * 6 });
      break;
    case 'breath':
    case 'bellows':
    case 'magnetarSnap':
    case 'eclipse':
    case 'umbraWave':
      core.emissive = 1;
      w.addTelegraph({ kind: 'sphere', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: 0, by: 0, bz: 0, radius: core.radius * 2.6, dur: 0.8, owner: core.id });
      break;
    case 'lattice':
      zone(b, { kind: 'lattice', warm: 1, dur: 4 + ph * 0.6, dmg: 15 });
      break;
    case 'polarity':
      zone(b, { kind: 'polarity', warm: 0.6, dur: 4.4 + ph * 0.6, src: core, speed: 36 + ph * 6 });
      break;
    case 'horizonGrow':
      zone(b, { kind: 'horizon', warm: 0.6, dur: 4.5, src: core, r: 30 + ph * 6, dmg: 16 });
      break;
    case 'jetSweep':
      for (const bm of b.beams) {
        bm.on = true;
        bm.warm = 0.3;
      }
      b.beamBoost = 3.2 + ph * 0.4;
      break;
    case 'pourStream':
      core.emissive = 1;
      _a.copy(pl.pos).sub(core.pos).normalize();
      _a.y += 0.6;
      zone(b, { kind: 'stream', warm: 0.9, dur: 3.2 + ph * 0.5, src: core, b: _a.normalize().clone(), r: 200, thick: 3, dmg: 16, speed: 0.75 + ph * 0.2 });
      break;
    case 'firstLight':
      _a.copy(pl.pos).sub(core.pos).normalize();
      zone(b, { kind: 'spokes', warm: 1.2, dur: 4 + ph * 0.5, src: core, b: _a.clone(), r: 230, thick: 2.4, dmg: 18, sign: 6 + ph, speed: 0.55 + ph * 0.1 });
      break;
    case 'requiem': {
      // the core fires into a shard; the light bounces through the choir and ends on you
      const shards = liveParts(b);
      const order: Enemy[] = [core];
      for (let k = 0; k < shards.length; k += shards.length > 3 ? 2 : 1) order.push(shards[k]!);
      zone(b, { kind: 'chain', warm: 1.1, dur: 0.8 + ph * 0.2, nodes: order, thick: 2, dmg: 20 });
      break;
    }
    case 'masks': {
      // the Night pulls a mask from a boss you have already killed and fights with its move
      const pick = MASKABLE[w.rng.int(0, MASKABLE.length - 1)]!;
      b.active = pick;
      b.maskOf = SIG_OWNER[pick];
      startSignature(b, w, pick);
      w.events.emit('bossMove', { id: pick, boss: b.id, mask: SIG_OWNER[pick] });
      return;
    }
    default:
      break;
  }
}

/**
 * One tick of an active signature. `t` is the time since it started.
 * Calls `b.end(cool)` when the move is finished.
 */
export function runSignature(b: BossController, w: World, sig: Signature, dt: number, t: number): void {
  const core = b.core;
  const pl = w.player;
  const ph = b.phase;
  const col = BOSS_COLOR[SIG_OWNER[sig]] ?? b.color;
  const tick = (hz: number) => Math.floor(t * hz) !== Math.floor((t - dt) * hz);
  switch (sig) {
    // ---------------------------------------------------------------- THE FOREMAN
    case 'drillLaunch': {
      // the drill arms come off the rig one at a time and spear where you are going
      const gap = 0.55 - ph * 0.1;
      const arms = b.sigList;
      while (b.sigI < arms.length && t >= b.sigI * gap) {
        const p = arms[b.sigI++]!;
        if (!p.alive) continue;
        lead(w, 0.45, _a);
        w.addTelegraph({ kind: 'line', ax: p.pos.x, ay: p.pos.y, az: p.pos.z, bx: _a.x, by: _a.y, bz: _a.z, radius: p.radius, dur: 0.45, owner: core.id });
        const target = _a.clone();
        w.later(0.45, () => {
          if (!p.alive || b.dead) return;
          launch(b, p, target, 0.4, 0.45 + ph * 0.15, 0.6, (q) => {
            if (ph >= 1) ringBurst(w, q.pos.x, q.pos.y, q.pos.z, 8 + ph * 4, 22, 9, 2, w.time);
            w.events.emit('explosion', { x: q.pos.x, y: q.pos.y, z: q.pos.z, radius: 6, r: 1, g: 0.6, b: 0.2, enemy: true });
          });
        });
      }
      if (!arms.length || t > arms.length * gap + 2) b.end(1.2);
      break;
    }
    case 'scrapCage': {
      // scrap closes in from a sphere around you: find the hole before it shuts
      if (t >= 0.8 && t - dt < 0.8) {
        b.sigDir.copy(rndDir(w, _a));
        b.sigAt.copy(pl.pos);
        const n = 46 + ph * 14;
        const R = 34;
        for (let i = 0; i < n; i++) {
          // Fibonacci sphere: even coverage
          const y = 1 - (2 * (i + 0.5)) / n;
          const rr = Math.sqrt(1 - y * y);
          const a = i * 2.39996;
          _b.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
          if (_b.dot(b.sigDir) > 0.82 - ph * 0.04) continue; // the way out
          w.spawnEnemyShot(b.sigAt.x + _b.x * R, b.sigAt.y + _b.y * R, b.sigAt.z + _b.z * R, -_b.x * 20, -_b.y * 20, -_b.z * 20, 11, 2, 0.8, 1.5);
        }
        w.events.emit('enemyShot', { x: b.sigAt.x, y: b.sigAt.y, z: b.sigAt.z, big: true });
      }
      if (t > 0.8 && t < 2.2) {
        // the cage wires tighten, and the gap glows
        const r = Math.max(2, 34 - (t - 0.8) * 34);
        for (const n of [UP, _c.set(1, 0, 0), _d.set(0, 0, 1)]) ring(b, b.sigAt, r, n, col, 0.5);
        _a.copy(b.sigAt).addScaledVector(b.sigDir, r);
        ring(b, _a, 5, b.sigDir, [0.5, 1.4, 0.8], 0.9);
      }
      if (t > 2.4) b.end(1.4);
      break;
    }
    case 'tractor': {
      // the rig hauls you toward its grinder while the turrets fire
      if (t > 0.6 && tick(1.4)) for (const p of liveParts(b, (q) => q.partIndex >= 4)) fireAt(w, p, 70, 10, 2, 3, 0.08, 0.6, 0.9);
      if (t > 3 + ph * 0.4) b.end(1.2);
      break;
    }
    case 'mortarField': {
      // strikes walk across your path
      const n = 5 + ph * 2;
      while (b.sigI < n && t >= b.sigI * 0.22) {
        lead(w, 1.0, _a);
        if (b.sigI > 0) _a.add(rndDir(w, _b).multiplyScalar(w.rng.range(4, 14)));
        zone(b, { kind: 'mortar', warm: 1.1, dur: 0, a: _a.clone(), r: 9, dmg: 22, col });
        b.sigI++;
      }
      if (t > n * 0.22 + 1.4) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- CINDER LEVIATHAN
    case 'coil': {
      // the serpent wraps around you and fires inward from every coil; climb out of its plane
      if (t > 0.5 && tick(4 + ph)) {
        const segs = liveParts(b);
        for (let k = 0; k < 2 + ph && segs.length; k++) fireAt(w, segs[w.rng.int(0, segs.length - 1)]!, 50, 10, 1, 1, 0, 0, 0.9);
      }
      const r = Math.max(16, 36 - t * 4);
      ring(b, b.sigAt.copy(pl.pos), r, UP, col, 0.25);
      if (t > 4.5) b.end(1.4);
      break;
    }
    case 'breath': {
      // a sweeping cone of fire from the head
      if (t < 0.7) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        b.sigDir.copy(_a);
        b.sigAxis.crossVectors(_a, UP).normalize().cross(_a).normalize();
        for (let k = -1; k <= 1; k++) {
          _b.copy(_a).applyAxisAngle(b.sigAxis, k * 0.5).multiplyScalar(60).add(core.pos);
          seg(b, core.pos, _b, col, 0.25 + t);
        }
      } else if (t < 2.4) {
        const sweep = Math.sin((t - 0.7) * 2.2) * 0.55;
        _a.copy(b.sigDir).applyAxisAngle(b.sigAxis, sweep);
        if (tick(30)) {
          for (let k = 0; k < 2 + ph; k++) {
            _b.copy(_a).add(rndDir(w, _c).multiplyScalar(0.16)).normalize().multiplyScalar(44 + w.rng.range(0, 10));
            w.spawnEnemyShot(core.pos.x, core.pos.y, core.pos.z, _b.x, _b.y, _b.z, 8, 1, 1.0, 1.3);
          }
        }
        for (let k = 0; k < 3; k++) {
          _b.copy(_a).add(rndDir(w, _c).multiplyScalar(0.12)).normalize().multiplyScalar(30 + w.rng.range(0, 25)).add(core.pos);
          seg(b, core.pos, _b, col, 0.7);
        }
      } else b.end(1.2);
      break;
    }
    case 'dive': {
      // straight dives through your position, laying a wake of magma
      const passes = 2 + (ph >= 2 ? 1 : 0);
      const per = 1.9;
      const k = Math.floor(t / per);
      const lt = t - k * per;
      if (k >= passes) {
        b.end(1.2);
        break;
      }
      if (lt < dt * 1.5) {
        lead(w, 0.3, _a);
        b.sigDir.copy(_a).sub(core.pos).normalize();
        _b.copy(core.pos).addScaledVector(b.sigDir, 170);
        w.addTelegraph({ kind: 'line', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: _b.x, by: _b.y, bz: _b.z, radius: core.radius, dur: 0.75, owner: core.id });
      }
      if (lt > 0.75 && lt < 1.75 && tick(8)) {
        const segs = liveParts(b);
        const s = segs.length ? segs[w.rng.int(0, segs.length - 1)]! : core;
        w.spawnEnemyShot(s.pos.x, s.pos.y, s.pos.z, 0, 0, 0, 12, 4, 1.3, 5 + ph);
      }
      break;
    }
    // ---------------------------------------------------------------- THE GLASS CHOIR
    case 'lattice': {
      if (t > 4.6 + ph * 0.6) b.end(1.4);
      break;
    }
    case 'refract': {
      // prism orbs that shatter into rings of glass
      if (t >= 0.6 && t - dt < 0.6) {
        for (let k = 0; k < 3; k++) {
          lead(w, 1.2, _a).add(rndDir(w, _b).multiplyScalar(8)).sub(core.pos).normalize().multiplyScalar(16);
          const i = w.spawnEnemyShot(core.pos.x, core.pos.y, core.pos.z, _a.x, _a.y, _a.z, 14, 1, 2.2, 1.3);
          if (i >= 0) b.orbs.push({ x: core.pos.x, y: core.pos.y, z: core.pos.z, vx: w.eproj.vx[i]!, vy: w.eproj.vy[i]!, vz: w.eproj.vz[i]!, t: 0, fuse: 1.25, n: 14 + ph * 4 });
        }
      }
      if (t > 2.2) b.end(1.2);
      break;
    }
    case 'chorusSnipe': {
      const shards = b.sigList.length ? b.sigList : (b.sigList = liveParts(b));
      const srcs = shards.length ? shards : [core];
      while (b.sigI < srcs.length && t >= b.sigI * (0.3 - ph * 0.05)) {
        zone(b, { kind: 'snipe', warm: 1.0, dur: 0.35, src: srcs[b.sigI]!, thick: 1.6, dmg: 18, col, r: 200 });
        b.sigI++;
      }
      if (t > srcs.length * 0.3 + 1.8) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- PULSAR HEART
    case 'pulseWave': {
      // flat rings of force in the plane you are flying in: leave the plane
      const n = 3 + ph;
      while (b.sigI < n && t >= b.sigI * 0.55) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        _b.crossVectors(_a, rndDir(w, _c)).normalize();
        zone(b, { kind: 'wave', warm: 0.45, dur: 4.5, a: core.pos.clone(), b: _b.clone(), speed: 42 + ph * 6, thick: 2.4, dmg: 16, col });
        b.sigI++;
      }
      if (t > n * 0.55 + 2) b.end(1);
      break;
    }
    case 'strobe': {
      // on every beat, lances flash out in new directions; one is always aimed at you
      const beat = 60 / b.bpm;
      const beats = 6 + ph * 2;
      while (b.sigI < beats && t >= b.sigI * beat) {
        const n = 3 + ph;
        for (let k = 0; k < n; k++) {
          if (k === 0) lead(w, beat * 0.9, _a).sub(core.pos).normalize();
          else rndDir(w, _a);
          zone(b, { kind: 'pillar', warm: beat * 0.85, dur: 0.16, a: core.pos.clone(), b: _a.clone().multiplyScalar(220).add(core.pos), thick: 2, dmg: 15, col });
        }
        b.sigI++;
      }
      if (t > beats * beat + 0.6) b.end(1);
      break;
    }
    case 'magnetarSnap': {
      // the heart drags you in, then snaps out a shell: roll or parry through it
      if (t > 0.5 && t < 1.7) {
        _a.copy(core.pos).sub(pl.pos);
        const l = _a.length() || 1;
        pl.vel.addScaledVector(_a, (dt * 46) / l);
        const r = core.radius * (4 - (t - 0.5) * 2.4);
        vol(b, core.pos, r, 3, col, 0.9, t / 1.7);
        ring(b, core.pos, r, UP, col, 0.8);
        ring(b, core.pos, r, _b.set(1, 0, 0), col, 0.8);
      }
      if (t >= 1.7 && t - dt < 1.7) {
        zone(b, { kind: 'shell', warm: 0, dur: 4, a: core.pos.clone(), speed: 48 + ph * 8, thick: 2.6, dmg: 22, col });
        if (ph >= 2) w.later(0.6, () => !b.dead && zone(b, { kind: 'shell', warm: 0, dur: 4, a: b.core.pos.clone(), speed: 40, thick: 2.6, dmg: 22, col }));
      }
      if (t > 2.6) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- THE KILN MOTHER
    case 'slagPools': {
      // a grid of molten slag around you, with a couple of clear lanes
      if (t >= 0.1 && t - dt < 0.1) {
        b.sigAt.copy(pl.pos);
        const laneX = w.rng.int(-3, 3);
        const laneZ = w.rng.int(-3, 3);
        for (let ix = -3; ix <= 3; ix++)
          for (let iz = -3; iz <= 3; iz++) {
            if (ix === laneX || iz === laneZ) continue;
            const x = b.sigAt.x + ix * 8 + w.rng.range(-1, 1);
            const y = b.sigAt.y + w.rng.range(-3, 3);
            const z = b.sigAt.z + iz * 8 + w.rng.range(-1, 1);
            zone(b, { kind: 'mortar', warm: 0.7 + (Math.abs(ix) + Math.abs(iz)) * 0.06, dur: 0, a: new Vector3(x, y, z), r: 0, dmg: 0, col, sign: -1 });
          }
      }
      if (t > 1.6) b.end(1.2);
      break;
    }
    case 'bellows': {
      // a blast of hot air throws you back, chased by rings of fire
      if (t >= 0.8 && t - dt < 0.8) {
        _a.copy(pl.pos).sub(core.pos);
        const d = _a.length() || 1;
        pl.vel.addScaledVector(_a, 70 / d);
        for (let k = 0; k < 3 + ph; k++) {
          _b.crossVectors(_a, rndDir(w, _c)).normalize();
          ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 22 + ph * 4, 30 + k * 6, 11, 1, w.time + k, _b);
        }
        w.events.emit('explosion', { x: core.pos.x, y: core.pos.y, z: core.pos.z, radius: 22, r: 1.4, g: 0.6, b: 0.25, enemy: true });
      }
      if (t > 0.8 && t < 1.4) {
        const r = core.radius * 2 + (t - 0.8) * 120;
        _a.copy(pl.pos).sub(core.pos).normalize();
        ring(b, core.pos, r, _a, col, 1 - (t - 0.8) / 0.6);
      }
      if (t > 1.8) b.end(1.2);
      break;
    }
    case 'kilnMortars': {
      // every kiln lobs a crucible of slag at you
      if (b.sigI === 0) {
        b.sigList = liveParts(b);
        if (!b.sigList.length) b.sigList = [core];
      }
      while (b.sigI < b.sigList.length && t >= b.sigI * 0.14) {
        const k = b.sigList[b.sigI]!;
        lead(w, 1.25, _a);
        if (b.sigI > 0) _a.add(rndDir(w, _b).multiplyScalar(w.rng.range(3, 11)));
        const z = zone(b, { kind: 'mortar', warm: 1.25, dur: 0, a: _a.clone(), r: 8, dmg: 20, col });
        z.src = k;
        z.b.copy(k.pos);
        b.sigI++;
      }
      if (t > b.sigList.length * 0.14 + 1.6) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- HORIZON EATER
    case 'horizonGrow': {
      if (t > 4.8) b.end(1.2);
      break;
    }
    case 'lensing': {
      // bent light: rounds arrive from behind you
      if (t < 0.7) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        b.sigAt.copy(pl.pos).addScaledVector(_a, 30);
        b.sigDir.copy(_a);
        ring(b, b.sigAt, 26, _a, col, 0.3 + t);
        ring(b, b.sigAt, 18, _a, col, 0.2 + t * 0.5);
      } else if ((t - dt < 0.7) || (ph >= 1 && t >= 1.2 && t - dt < 1.2)) {
        const second = t >= 1.2;
        if (second) lead(w, 0.5, b.sigAt).addScaledVector(b.sigDir, 22);
        else lead(w, 0.5, b.sigAt).addScaledVector(b.sigDir, 30);
        const n = (second ? 14 : 18) + ph * 5;
        _b.crossVectors(b.sigDir, UP).normalize();
        if (_b.lengthSq() < 0.5) _b.set(1, 0, 0);
        _c.crossVectors(b.sigDir, _b).normalize();
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rad = second ? 18 : 26;
          _d.copy(b.sigAt).addScaledVector(_b, Math.cos(a) * rad).addScaledVector(_c, Math.sin(a) * rad);
          const v = lead(w, 0.55, _a).sub(_d).normalize().multiplyScalar(22);
          w.spawnEnemyShot(_d.x, _d.y, _d.z, v.x, v.y, v.z, 11, 2, 0.9, 3);
        }
        w.events.emit('enemyShot', { x: b.sigAt.x, y: b.sigAt.y, z: b.sigAt.z, big: true });
      }
      if (t > 2.2) b.end(1.2);
      break;
    }
    case 'tidalShear': {
      // two tidal rings at right angles, then a third through you
      if (t >= 0.5 && t - dt < 0.5) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        _b.crossVectors(_a, UP).normalize();
        if (_b.lengthSq() < 0.5) _b.set(1, 0, 0);
        _c.crossVectors(_a, _b).normalize();
        zone(b, { kind: 'wave', warm: 0.3, dur: 4.5, a: core.pos.clone(), b: _b.clone(), speed: 38 + ph * 5, thick: 2.4, dmg: 16, col });
        zone(b, { kind: 'wave', warm: 0.3, dur: 4.5, a: core.pos.clone(), b: _c.clone(), speed: 38 + ph * 5, thick: 2.4, dmg: 16, col });
      }
      if (t >= 1.4 && t - dt < 1.4) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        _b.crossVectors(_a, rndDir(w, _c)).normalize();
        zone(b, { kind: 'wave', warm: 0.3, dur: 4.5, a: core.pos.clone(), b: _b.clone(), speed: 50, thick: 2.4, dmg: 16, col });
      }
      if (t > 2.4) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- QUASAR REGENT
    case 'judgment': {
      // columns of light fall where you stand and all around
      const n = 5 + ph * 2;
      while (b.sigI < n && t >= b.sigI * 0.12) {
        lead(w, 0.9, _a);
        if (b.sigI > 0) {
          rndDir(w, _b);
          _b.y = 0;
          _a.addScaledVector(_b.normalize(), w.rng.range(6, 24));
        }
        _b.set(w.rng.range(-0.25, 0.25), 1, w.rng.range(-0.25, 0.25)).normalize();
        zone(b, { kind: 'pillar', warm: 0.95, dur: 0.55, a: _a.clone().addScaledVector(_b, -110), b: _a.clone().addScaledVector(_b, 110), thick: 3, dmg: 20, col });
        b.sigI++;
      }
      if (t > n * 0.12 + 1.8) b.end(1.2);
      break;
    }
    case 'courtCharge': {
      // the court's prisms dive at you in turn, scattering crossfire
      const gap = 0.4;
      const court = b.sigList;
      while (b.sigI < court.length && t >= b.sigI * gap) {
        const p = court[b.sigI++]!;
        if (!p.alive) continue;
        lead(w, 0.5, _a);
        w.addTelegraph({ kind: 'line', ax: p.pos.x, ay: p.pos.y, az: p.pos.z, bx: _a.x, by: _a.y, bz: _a.z, radius: p.radius, dur: 0.4, owner: core.id });
        const target = _a.clone();
        w.later(0.4, () => {
          if (!p.alive || b.dead) return;
          launch(b, p, target, 0.45, 0.6, 0.7, (q) => {
            _b.copy(w.player.pos).sub(q.pos).normalize();
            ringBurst(w, q.pos.x, q.pos.y, q.pos.z, 10 + ph * 3, 26, 10, 2, w.time, _b);
          });
        });
      }
      if (!court.length || t > court.length * gap + 2.2) b.end(1.2);
      break;
    }
    case 'jetSweep': {
      if (t > 3 + ph * 0.4) {
        for (const bm of b.beams) bm.on = false;
        b.beamBoost = 1;
        b.end(1.4);
      }
      break;
    }
    // ---------------------------------------------------------------- IRON MAGNETAR
    case 'polarity': {
      if (t > 4.6 + ph * 0.6) b.end(1.2);
      break;
    }
    case 'shrapnel': {
      // the shell plates fly out around you, fire inward, and snap back
      const plates = b.sigList;
      while (b.sigI < plates.length && t >= b.sigI * 0.06) {
        const p = plates[b.sigI++]!;
        if (!p.alive) continue;
        _a.copy(w.player.pos).add(rndDir(w, _b).multiplyScalar(18 + w.rng.range(0, 8)));
        launch(b, p, _a, 0.6, 0.9, 0.7, (q) => fireAt(w, q, 45, 10, 2, 2 + (ph >= 2 ? 1 : 0), 0.1, 0.4, 0.8));
      }
      if (!plates.length || t > plates.length * 0.06 + 2.6) b.end(1.2);
      break;
    }
    case 'railLock': {
      // magnetic rails slam into place through your position
      const n = 3 + ph;
      while (b.sigI < n && t >= b.sigI * 0.3) {
        lead(w, 1.0, _a);
        rndDir(w, _b);
        zone(b, { kind: 'pillar', warm: 1.05, dur: 0.8, a: _a.clone().addScaledVector(_b, -130), b: _a.clone().addScaledVector(_b, 130), thick: 2.2, dmg: 18, col });
        b.sigI++;
      }
      if (t > n * 0.3 + 2) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- THE ENDLESS NIGHT
    case 'masks':
      b.end(0.5);
      break;
    case 'eclipse': {
      // the Night swallows the light, then rings out two shells in the dark
      if (t < 0.1) b.hushPulse = 3.5;
      if (t >= 0.9 && t - dt < 0.9) zone(b, { kind: 'shell', warm: 0, dur: 4, a: core.pos.clone(), speed: 44, thick: 2.6, dmg: 20, col });
      if (t >= 1.7 && t - dt < 1.7) zone(b, { kind: 'shell', warm: 0, dur: 4, a: core.pos.clone(), speed: 56, thick: 2.6, dmg: 20, col });
      if (t > 2.6) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- THE LAST DARK
    case 'swallow': {
      // pools of dark open where you are flying and linger
      const n = 3 + ph;
      while (b.sigI < n && t >= b.sigI * 0.75) {
        lead(w, 0.9, _a);
        zone(b, { kind: 'dark', warm: 0.9, dur: 3.2, a: _a.clone(), r: 11 + ph * 3, dmg: 11, col });
        b.sigI++;
      }
      if (t > n * 0.75 + 1.2) b.end(1.2);
      break;
    }
    case 'eyeLances': {
      const eyes = b.sigList.length ? b.sigList : (b.sigList = liveParts(b));
      const srcs = eyes.length ? eyes : [core];
      const gap = 0.22 - ph * 0.04;
      while (b.sigI < srcs.length * (ph >= 1 ? 2 : 1) && t >= b.sigI * gap) {
        zone(b, { kind: 'snipe', warm: 0.8, dur: 0.3, src: srcs[b.sigI % srcs.length]!, thick: 1.5, dmg: 16, col, r: 200 });
        b.sigI++;
      }
      if (t > srcs.length * (ph >= 1 ? 2 : 1) * gap + 1.6) b.end(1.2);
      break;
    }
    case 'umbraWave': {
      if (t < 0.1) b.hushPulse = 2.5;
      if (t >= 0.8 && t - dt < 0.8) {
        zone(b, { kind: 'shell', warm: 0, dur: 4, a: core.pos.clone(), speed: 46, thick: 2.6, dmg: 20, col });
        _a.copy(pl.pos).sub(core.pos).normalize();
        _b.crossVectors(_a, UP).normalize();
        zone(b, { kind: 'wave', warm: 0, dur: 4, a: core.pos.clone(), b: _b.clone(), speed: 36, thick: 2.4, dmg: 16, col });
      }
      if (t > 2) b.end(1.2);
      break;
    }
    // ---------------------------------------------------------------- extra signatures
    case 'conveyor': {
      // belts of scrap stream across your path in lanes; one lane is clear
      if (t >= 0.6 && t - dt < 0.6) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        _b.crossVectors(_a, UP).normalize();
        if (_b.lengthSq() < 0.5) _b.set(1, 0, 0);
        _c.crossVectors(_b, _a).normalize();
        const gap = w.rng.int(-2, 2);
        const lanes = 3 + (ph >= 1 ? 1 : 0);
        for (let k = -lanes; k <= lanes; k++) {
          if (k === gap) continue;
          for (let j = 0; j < 9 + ph * 2; j++) {
            _d.copy(pl.pos).addScaledVector(_b, -40 - j * 6).addScaledVector(_c, k * 4.5);
            const dir = j % 2 === 0 ? 1 : 1;
            w.spawnEnemyShot(_d.x, _d.y, _d.z, _b.x * 24 * dir, _b.y * 24 * dir, _b.z * 24 * dir, 10, 2, 0.8, 3.5);
          }
        }
        b.sigAt.copy(pl.pos);
        b.sigDir.copy(_c);
        b.sigAxis.copy(_b);
      }
      if (t < 0.6) {
        lead(w, 0.2, _a);
        ring(b, _a, 22, _c.copy(pl.pos).sub(core.pos).normalize(), b.color, t);
      } else if (t < 2.4) {
        // the belt rails
        for (const k of [-1, 1]) {
          _a.copy(b.sigAt).addScaledVector(b.sigDir, k * 18).addScaledVector(b.sigAxis, -60);
          _d.copy(b.sigAt).addScaledVector(b.sigDir, k * 18).addScaledVector(b.sigAxis, 60);
          seg(b, _a, _d, col, 0.5);
        }
      }
      if (t > 2.4) b.end(1.2);
      break;
    }
    case 'eruption': {
      // magma geysers burst up along the serpent's whole body, head to tail
      const pts = b.trail;
      const n = Math.min(10, Math.floor(pts.length / 6));
      while (b.sigI < n && t >= b.sigI * 0.09) {
        const p = pts[b.sigI * 6]!;
        _b.set(w.rng.range(-0.15, 0.15), 1, w.rng.range(-0.15, 0.15)).normalize();
        zone(b, { kind: 'pillar', warm: 0.85, dur: 0.6, a: p.clone().addScaledVector(_b, -80), b: p.clone().addScaledVector(_b, 80), thick: 2.8, dmg: 18, col });
        if (ph >= 1) w.later(0.9, () => !b.dead && ringBurst(w, p.x, p.y, p.z, 8, 18, 9, 1, w.time));
        b.sigI++;
      }
      if (t > n * 0.09 + 1.6) b.end(1);
      break;
    }
    case 'requiem': {
      if (t > 2.2 + ph * 0.2) b.end(1.2);
      break;
    }
    case 'metronome': {
      // a pendulum of lances: each beat, the safe side swaps
      const beat = 60 / b.bpm;
      const beats = 8;
      while (b.sigI < beats && t >= b.sigI * beat) {
        const side = b.sigI % 2 === 0 ? 1 : -1;
        lead(w, beat, _a).sub(core.pos).normalize();
        _b.crossVectors(_a, UP).normalize();
        if (_b.lengthSq() < 0.5) _b.set(1, 0, 0);
        const fan = 3 + ph;
        for (let k = 0; k < fan; k++) {
          _c.copy(_a).applyAxisAngle(UP, side * (k * 0.07 - 0.03)).normalize();
          zone(b, { kind: 'pillar', warm: beat * 0.85, dur: 0.15, a: core.pos.clone(), b: _c.clone().multiplyScalar(220).add(core.pos), thick: 2, dmg: 15, col });
        }
        if (ph >= 2 && b.sigI % 4 === 3) zone(b, { kind: 'shell', warm: 0, dur: 4, a: core.pos.clone(), speed: 46, thick: 2.4, dmg: 18, col });
        b.sigI++;
      }
      if (t > beats * beat + 0.5) b.end(1);
      break;
    }
    case 'pourStream': {
      if (t > 1 && tick(5)) {
        // the stream spatters slag where it lands
        const z = b.zones.find((q) => q.kind === 'stream');
        if (z) {
          _a.copy(core.pos).addScaledVector(z.b, Math.min(z.r, core.pos.distanceTo(pl.pos)));
          w.spawnEnemyShot(_a.x, _a.y, _a.z, w.rng.range(-4, 4), w.rng.range(-4, 4), w.rng.range(-4, 4), 10, 4, 1.2, 4);
        }
      }
      if (t > 4.4 + ph * 0.5) b.end(1.2);
      break;
    }
    case 'accretion': {
      // an accretion disc forms around you while the hole drags you through it
      if (t >= 0.6 && t - dt < 0.6) {
        _a.copy(pl.pos).sub(core.pos).normalize();
        b.sigAxis.crossVectors(_a, UP).normalize().cross(_a).normalize();
        for (let k = 0; k < 3 + (ph >= 2 ? 1 : 0); k++) ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 28 + ph * 4, 8 + k * 5, 10, k % 2 ? 2 : 1, w.time + k * 0.3, b.sigAxis);
      }
      if (t > 0.6 && t < 3.4) {
        _a.copy(core.pos).sub(pl.pos);
        const l = _a.length() || 1;
        pl.vel.addScaledVector(_a, (dt * (30 + ph * 6)) / l);
        for (let k = 1; k <= 3; k++) ring(b, core.pos, (t - 0.6) * (14 + k * 8) * 1.7, b.sigAxis, col, 0.5 - k * 0.1);
      }
      if (t > 3.6) b.end(1.2);
      break;
    }
    case 'coronation': {
      // a crown of light bars drops around you, then the centre burns: slip between the bars
      if (t < dt * 1.5) {
        lead(w, 0.4, b.sigAt);
        const bars = 8;
        for (let k = 0; k < bars; k++) {
          const a = (k / bars) * Math.PI * 2;
          _a.set(Math.cos(a) * 17, 0, Math.sin(a) * 17).add(b.sigAt);
          zone(b, { kind: 'pillar', warm: 0.9, dur: 2.4 + ph * 0.3, a: _a.clone().setY(_a.y - 90), b: _a.clone().setY(_a.y + 90), thick: 3.2, dmg: 18, col });
        }
      }
      if (t >= 1.3 && t - dt < 1.3) {
        zone(b, { kind: 'pillar', warm: 1.0 - ph * 0.1, dur: 0.7, a: b.sigAt.clone().setY(b.sigAt.y - 90), b: b.sigAt.clone().setY(b.sigAt.y + 90), thick: 9, dmg: 20, col });
      }
      if (t < 2.6) ring(b, b.sigAt, 17, UP, col, 0.6);
      if (t > 3.4) b.end(1.2);
      break;
    }
    case 'ironStorm': {
      // the field magnetises every round in the air: they all turn toward you
      if (t >= 0.5 && t - dt < 0.5) {
        ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 30 + ph * 6, 22, 10, 2, w.time);
        ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 20 + ph * 4, 18, 10, 1, w.time + 1, rndDir(w, _a));
      }
      if (t > 0.6 && t < 2.6) {
        const E = w.eproj;
        for (let i = 0; i < E.n; i++) if (E.homing[i]! < 0.6) E.homing[i] = 0.6 + ph * 0.15;
        const pulse = 0.5 + 0.5 * Math.sin(w.time * 14);
        ring(b, pl.pos, 6 + pulse * 2, UP, [1.5, 0.35, 0.25], 0.8);
        ring(b, pl.pos, 6 + pulse * 2, _a.set(1, 0, 0), [1.5, 0.35, 0.25], 0.5);
      }
      if (t > 2.8) b.end(1.2);
      break;
    }
    case 'firstLight': {
      if (t > 5.2 + b.phase * 0.5) b.end(1.4);
      break;
    }
    case 'drain': {
      // the eyes leave the body, ring you, and stare inward while the colour drains
      if (t < dt * 1.5) {
        b.hushPulse = 3.2;
        const eyes = liveParts(b);
        eyes.forEach((p, k) => {
          const a = (k / Math.max(1, eyes.length)) * Math.PI * 2;
          _a.set(Math.cos(a) * 24, Math.sin(a * 2) * 6, Math.sin(a) * 24).add(pl.pos);
          launch(b, p, _a, 0.7, 2.2, 0.8, (q) => {
            zone(b, { kind: 'snipe', warm: 0.7, dur: 0.3, src: q, thick: 1.5, dmg: 15, col, r: 60 });
            w.later(1.2, () => q.alive && !b.dead && zone(b, { kind: 'snipe', warm: 0.6, dur: 0.3, src: q, thick: 1.5, dmg: 15, col, r: 60 }));
          });
        });
      }
      if (t > 3.9) b.end(1.2);
      break;
    }
  }
}

/**
 * Movement during signatures that steer the body itself.
 * Returns true when it has set the core's velocity this tick.
 */
export function moveSignature(b: BossController, w: World, dt: number): boolean {
  const core = b.core;
  const pl = w.player;
  const t = b.activeT;
  switch (b.active) {
    case 'coil': {
      // circle the player, tightening
      b.orbitA += dt * (2.2 + b.phase * 0.4);
      const r = Math.max(16, 36 - t * 4);
      _a.set(Math.cos(b.orbitA) * r, Math.sin(b.orbitA * 2) * 3, Math.sin(b.orbitA) * r).add(pl.pos);
      core.vel.lerp(_a.sub(core.pos).multiplyScalar(4), Math.min(1, dt * 6));
      return true;
    }
    case 'dive': {
      const lt = t % 1.9;
      if (lt < 0.75) core.vel.multiplyScalar(0.9);
      else if (lt < 1.75) core.vel.copy(b.sigDir).multiplyScalar(150 + b.phase * 20);
      else core.vel.multiplyScalar(0.85);
      return true;
    }
    case 'breath':
    case 'magnetarSnap':
    case 'bellows':
      core.vel.multiplyScalar(0.9);
      return true;
    case 'lattice': {
      // the choir closes in so its web sweeps through you
      _a.copy(pl.pos).sub(core.pos);
      const d = _a.length() || 1;
      _a.multiplyScalar((d - 26) / d);
      core.vel.lerp(_a.multiplyScalar(1.2), Math.min(1, dt * 2));
      return true;
    }
    default:
      return false;
  }
}

const _orbPos = new Vector3();

/** Advance hazards, part flights and delayed orbs; draw them on the boss's vector layer. */
export function updateZones(b: BossController, w: World, dt: number): void {
  const pl = w.player;
  const core = b.core;
  // ---- part flights
  for (const [p, f] of b.flights) {
    f.t += dt;
    if (!p.alive || b.dead) {
      b.flights.delete(p);
      continue;
    }
    if (f.t >= f.out + f.hang + f.back) b.flights.delete(p);
    else if (!f.arrived && f.t >= f.out) {
      f.arrived = true;
      f.onArrive?.(p);
    }
  }
  // ---- delayed orbs (Refract)
  for (let i = b.orbs.length - 1; i >= 0; i--) {
    const o = b.orbs[i]!;
    o.t += dt;
    _orbPos.set(o.x + o.vx * o.t, o.y + o.vy * o.t, o.z + o.vz * o.t);
    const k = o.t / o.fuse;
    vol(b, _orbPos, 2.6 + k * 2.2, 6, b.color, 0.8 + k * 0.8, k);
    ring(b, _orbPos, 2.5 + k * 3, UP, b.color, 0.4 + k * 0.6);
    ring(b, _orbPos, 2.5 + k * 3, _a.set(1, 0, 0), b.color, 0.4 + k * 0.6);
    if (o.t < o.fuse) continue;
    b.orbs.splice(i, 1);
    // only if the orb is still there (not reflected, cleared or blocked)
    let found = -1;
    const E = w.eproj;
    for (let j = 0; j < E.n; j++) {
      if (E.size[j]! < 2) continue;
      const dx = E.x[j]! - _orbPos.x;
      const dy = E.y[j]! - _orbPos.y;
      const dz = E.z[j]! - _orbPos.z;
      if (dx * dx + dy * dy + dz * dz < 25) {
        found = j;
        break;
      }
    }
    if (found < 0) continue;
    _orbPos.set(E.x[found]!, E.y[found]!, E.z[found]!);
    E.kill(found);
    ringBurst(w, _orbPos.x, _orbPos.y, _orbPos.z, o.n, 26, 10, 2, w.time, rndDir(w, _b));
    w.events.emit('explosion', { x: _orbPos.x, y: _orbPos.y, z: _orbPos.z, radius: 8, r: b.color[0], g: b.color[1], b: b.color[2], enemy: true });
  }
  // ---- hazards
  for (let i = b.zones.length - 1; i >= 0; i--) {
    const z = b.zones[i]!;
    z.t += dt;
    const warm = z.t < z.warm;
    const at = z.t - z.warm;
    const kw = Math.min(1, z.t / Math.max(0.01, z.warm));
    let done = !warm && at > z.dur;
    switch (z.kind) {
      case 'wave': {
        if (warm) {
          ring(b, z.a, 4 + kw * 6, z.b, z.col, kw);
          break;
        }
        const r = at * z.speed;
        ring(b, z.a, r, z.b, z.col, 1);
        ring(b, z.a, Math.max(0, r - z.thick * 1.5), z.b, z.col, 0.35);
        _a.copy(pl.pos).sub(z.a);
        const off = _a.dot(z.b);
        const radial = Math.sqrt(Math.max(0, _a.lengthSq() - off * off));
        if (Math.abs(off) < z.thick + pl.radius && Math.abs(radial - r) < z.thick + pl.radius) w.hurtPlayerBeam(z.dmg, `${b.name} wave`, core);
        if (r > 240) done = true;
        break;
      }
      case 'shell': {
        const r = Math.max(0, at) * z.speed;
        if (r > 1) vol(b, z.a, r, 3, z.col, 1.1, Math.min(1, r / 240));
        ring(b, z.a, r, UP, z.col, 1);
        ring(b, z.a, r, _a.set(1, 0, 0), z.col, 0.7);
        ring(b, z.a, r, _a.set(0, 0, 1), z.col, 0.7);
        const d = pl.pos.distanceTo(z.a);
        if (!warm && Math.abs(d - r) < z.thick + pl.radius) w.hurtPlayerBeam(z.dmg, `${b.name} shell`, core);
        if (r > 240) done = true;
        break;
      }
      case 'pillar': {
        if (warm) {
          w.telegraphs.push({ kind: 'line', ax: z.a.x, ay: z.a.y, az: z.a.z, bx: z.b.x, by: z.b.y, bz: z.b.z, radius: z.thick, t: kw * 0.98, dur: 1, owner: core.id });
          seg(b, z.a, z.b, z.col, 0.15 + kw * 0.35);
          break;
        }
        w.beams.push({ ax: z.a.x, ay: z.a.y, az: z.a.z, bx: z.b.x, by: z.b.y, bz: z.b.z, width: z.thick, r: z.col[0], g: z.col[1], b: z.col[2], enemy: true });
        _a.copy(z.b).sub(z.a);
        const len = _a.length() || 1;
        _a.multiplyScalar(1 / len);
        const tt = raySphere(z.a.x, z.a.y, z.a.z, _a.x, _a.y, _a.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + z.thick * 0.5);
        if (tt >= 0 && tt < len) w.hurtPlayerBeam(z.dmg, `${b.name} lance`, core);
        break;
      }
      case 'mortar': {
        if (warm) {
          // sign -1 = a slag pool seed: it becomes a lingering orb instead of a blast
          const r = z.sign < 0 ? 3 : z.r * (1.6 - kw * 0.6);
          // the volume shows the true blast radius, faint until it is about to land
          if (z.sign > 0) vol(b, z.a, z.r, 3, z.col, 0.1 + kw * kw * 0.45, kw);
          ring(b, z.a, r, UP, z.col, 0.3 + kw * 0.6);
          if (z.sign > 0) ring(b, z.a, r, _a.set(1, 0, 0), z.col, 0.3 + kw * 0.6);
          if (z.src) {
            // the lob: an arc from the kiln to the strike
            const k0 = Math.max(0, kw - 0.25);
            arcPoint(z.b, z.a, k0, _a);
            arcPoint(z.b, z.a, kw, _b);
            seg(b, _a, _b, z.col, 1);
          }
          break;
        }
        if (z.sign < 0) w.spawnEnemyShot(z.a.x, z.a.y, z.a.z, 0, 0, 0, 12, 4, 1.4, 7);
        else w.explode(z.a.x, z.a.y, z.a.z, z.r, z.dmg, -1, { enemy: true, color: [z.col[0], z.col[1], z.col[2]] });
        done = true;
        break;
      }
      case 'dark': {
        const r = warm ? z.r * 0.3 : z.r * Math.min(1, 0.3 + at * 1.6);
        vol(b, z.a, r, 5, z.col, warm ? kw * 0.6 : 1, (w.time * 0.2) % 1);
        ring(b, z.a, r, UP, z.col, warm ? kw * 0.6 : 0.9);
        ring(b, z.a, r, _a.set(1, 0, 0), z.col, warm ? kw * 0.4 : 0.7);
        ring(b, z.a, r * 0.6, _a.set(0, 0, 1), z.col, warm ? kw * 0.3 : 0.5);
        if (!warm && pl.pos.distanceTo(z.a) < r + pl.radius) w.hurtPlayerBeam(z.dmg, `${b.name} dark`, core);
        break;
      }
      case 'snipe': {
        const s = z.src;
        if (!s || !s.alive) {
          done = true;
          break;
        }
        // track for most of the warm-up, then lock: move after the lock
        if (warm && kw < 0.75) z.b.copy(pl.pos).sub(s.pos).normalize();
        _a.copy(s.pos).addScaledVector(z.b, z.r);
        if (warm) {
          seg(b, s.pos, _a, z.col, kw < 0.75 ? 0.25 : 0.9);
          break;
        }
        w.beams.push({ ax: s.pos.x, ay: s.pos.y, az: s.pos.z, bx: _a.x, by: _a.y, bz: _a.z, width: z.thick, r: z.col[0], g: z.col[1], b: z.col[2], enemy: true });
        const tt = raySphere(s.pos.x, s.pos.y, s.pos.z, z.b.x, z.b.y, z.b.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + z.thick * 0.5);
        if (tt >= 0 && tt < z.r) w.hurtPlayerBeam(z.dmg, `${b.name} lance`, s);
        break;
      }
      case 'lattice': {
        const ps = liveParts(b);
        for (let k = 0; k < ps.length; k++) {
          const links = b.phase >= 1 ? [1, 2] : [1];
          for (const o of links) {
            if (ps.length < 3 && o > 1) continue;
            const p = ps[k]!;
            const q = ps[(k + o) % ps.length]!;
            if (p === q) continue;
            if (warm) {
              seg(b, p.pos, q.pos, z.col, 0.2 + kw * 0.4);
              continue;
            }
            w.beams.push({ ax: p.pos.x, ay: p.pos.y, az: p.pos.z, bx: q.pos.x, by: q.pos.y, bz: q.pos.z, width: 1.6, r: z.col[0], g: z.col[1], b: z.col[2], enemy: true });
            _a.copy(q.pos).sub(p.pos);
            const len = _a.length() || 1;
            _a.multiplyScalar(1 / len);
            const tt = raySphere(p.pos.x, p.pos.y, p.pos.z, _a.x, _a.y, _a.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + 0.8);
            if (tt >= 0 && tt < len) w.hurtPlayerBeam(z.dmg, `${b.name} lattice`, p);
          }
        }
        b.spreadTarget = warm ? 1.6 : 2.6;
        if (done) b.spreadTarget = 1;
        break;
      }
      case 'tractor': {
        const s = z.src ?? core;
        // a wide, pulsing hauling beam
        const pulse = 0.5 + 0.5 * Math.sin(w.time * 18);
        seg(b, s.pos, pl.pos, z.col, warm ? kw * 0.5 : 0.5 + pulse * 0.5);
        _a.copy(pl.pos).sub(s.pos).normalize();
        _b.crossVectors(_a, UP).normalize().multiplyScalar(1.6);
        _c.copy(s.pos).add(_b);
        _d.copy(pl.pos).add(_b);
        seg(b, _c, _d, z.col, 0.35);
        _c.copy(s.pos).sub(_b);
        _d.copy(pl.pos).sub(_b);
        seg(b, _c, _d, z.col, 0.35);
        if (!warm) {
          _a.copy(s.pos).sub(pl.pos);
          const l = _a.length() || 1;
          pl.vel.addScaledVector(_a, (z.speed * dt) / l);
        }
        if (done) b.spreadTarget = 1;
        break;
      }
      case 'polarity': {
        const s = z.src ?? core;
        // flips every 0.9 s: red pulls you in, blue throws you out
        const flip = Math.floor(Math.max(0, at) / 0.9);
        const sign = flip % 2 === 0 ? 1 : -1;
        if (!warm && sign !== z.sign) {
          z.sign = sign;
          _a.copy(pl.pos).sub(s.pos).normalize();
          ringBurst(w, s.pos.x, s.pos.y, s.pos.z, 14 + b.phase * 3, 26, 10, sign > 0 ? 1 : 2, w.time, _b.crossVectors(_a, UP).normalize());
        }
        const c: [number, number, number] = z.sign > 0 ? [1.5, 0.35, 0.25] : [0.35, 0.7, 1.5];
        const rr = s.radius * (2.4 + 0.6 * Math.sin(w.time * 8));
        vol(b, s.pos, rr * 1.2, 1, c, warm ? kw * 0.5 : 0.8, 0.3);
        ring(b, s.pos, rr, UP, c, warm ? kw : 0.9);
        ring(b, s.pos, rr * 1.6, _a.set(1, 0, 0), c, warm ? kw * 0.6 : 0.6);
        // field lines toward you
        _a.copy(pl.pos).sub(s.pos);
        for (let k = 0; k < 3; k++) {
          const f = ((w.time * (z.sign > 0 ? -1.5 : 1.5) + k / 3) % 1 + 1) % 1;
          _b.copy(s.pos).addScaledVector(_a, f);
          _c.copy(s.pos).addScaledVector(_a, Math.min(1, f + 0.08));
          seg(b, _b, _c, c, 0.9);
        }
        if (!warm) {
          const l = _a.length() || 1;
          pl.vel.addScaledVector(_a, (-z.sign * z.speed * dt) / l);
        }
        break;
      }
      case 'horizon': {
        const s = z.src ?? core;
        const grow = warm ? 0 : at < z.dur * 0.55 ? at / (z.dur * 0.55) : at < z.dur * 0.75 ? 1 : 1 - (at - z.dur * 0.75) / (z.dur * 0.25);
        const r = s.radius * 1.2 + (z.r - s.radius * 1.2) * Math.max(0, grow);
        vol(b, s.pos, r, 4, z.col, warm ? kw * 0.6 : 1.2, (w.time * 0.05) % 1);
        for (let k = 0; k < 4; k++) ring(b, s.pos, r * (1 - k * 0.04), _a.set(Math.sin(k), 1, Math.cos(k * 2)).normalize(), z.col, warm ? kw * 0.5 : 0.9 - k * 0.15);
        ring(b, s.pos, r * 1.35, UP, z.col, 0.3);
        _a.copy(s.pos).sub(pl.pos);
        const l = _a.length() || 1;
        if (!warm) pl.vel.addScaledVector(_a, ((18 + b.phase * 4) * dt) / l);
        if (!warm && l < r + pl.radius) w.hurtPlayerBeam(z.dmg, `${b.name} horizon`, s);
        break;
      }
      case 'stream': {
        const s = z.src ?? core;
        // turn toward the player at a limited rate: keep moving across it
        _a.copy(pl.pos).sub(s.pos).normalize();
        const ang = z.b.angleTo(_a);
        const maxTurn = (warm ? 0.3 : z.speed) * dt;
        if (ang > 1e-4) {
          _b.crossVectors(z.b, _a).normalize();
          if (_b.lengthSq() > 0.5) z.b.applyAxisAngle(_b, Math.min(ang, maxTurn)).normalize();
        }
        _c.copy(s.pos).addScaledVector(z.b, z.r);
        if (warm) {
          seg(b, s.pos, _c, z.col, 0.2 + kw * 0.5);
          break;
        }
        w.beams.push({ ax: s.pos.x, ay: s.pos.y, az: s.pos.z, bx: _c.x, by: _c.y, bz: _c.z, width: z.thick * (0.85 + 0.15 * Math.sin(w.time * 30)), r: z.col[0], g: z.col[1], b: z.col[2], enemy: true });
        const tt = raySphere(s.pos.x, s.pos.y, s.pos.z, z.b.x, z.b.y, z.b.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + z.thick * 0.5);
        if (tt >= 0 && tt < z.r) w.hurtPlayerBeam(z.dmg, `${b.name} stream`, s);
        break;
      }
      case 'spokes': {
        const s = z.src ?? core;
        // rotate the spokes around the axis z.b
        if (!warm) z.sign = Math.round(z.sign);
        const n = Math.max(3, Math.round(z.sign));
        _b.crossVectors(z.b, UP).normalize();
        if (_b.lengthSq() < 0.5) _b.set(1, 0, 0);
        _c.crossVectors(z.b, _b).normalize();
        const rot = Math.max(0, at) * z.speed;
        for (let k = 0; k < n; k++) {
          const a = rot + (k / n) * Math.PI * 2;
          _a.copy(_b).multiplyScalar(Math.cos(a)).addScaledVector(_c, Math.sin(a));
          _d.copy(s.pos).addScaledVector(_a, z.r);
          if (warm) {
            seg(b, s.pos, _d, z.col, 0.15 + kw * 0.5);
            continue;
          }
          w.beams.push({ ax: s.pos.x, ay: s.pos.y, az: s.pos.z, bx: _d.x, by: _d.y, bz: _d.z, width: z.thick, r: z.col[0], g: z.col[1], b: z.col[2], enemy: true });
          const tt = raySphere(s.pos.x, s.pos.y, s.pos.z, _a.x, _a.y, _a.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + z.thick * 0.5);
          if (tt >= 0 && tt < z.r) w.hurtPlayerBeam(z.dmg, `${b.name} spokes`, s);
        }
        ring(b, s.pos, s.radius * 2.2, z.b, z.col, warm ? kw : 0.8);
        break;
      }
      case 'chain': {
        const nodes = z.nodes.filter((n) => n.alive);
        if (!nodes.length) {
          done = true;
          break;
        }
        // the last leg tracks you, then locks
        if (warm && kw < 0.75) z.b.copy(pl.pos);
        const last = nodes[nodes.length - 1]!;
        _a.copy(z.b).sub(last.pos).normalize();
        _d.copy(last.pos).addScaledVector(_a, 200);
        for (let k = 0; k < nodes.length; k++) {
          const p = nodes[k]!;
          const q = k + 1 < nodes.length ? nodes[k + 1]!.pos : _d;
          if (warm) {
            seg(b, p.pos, q, z.col, kw < 0.75 ? 0.2 + kw * 0.3 : 0.9);
            continue;
          }
          w.beams.push({ ax: p.pos.x, ay: p.pos.y, az: p.pos.z, bx: q.x, by: q.y, bz: q.z, width: z.thick, r: z.col[0], g: z.col[1], b: z.col[2], enemy: true });
          _c.copy(q).sub(p.pos);
          const len = _c.length() || 1;
          _c.multiplyScalar(1 / len);
          const tt = raySphere(p.pos.x, p.pos.y, p.pos.z, _c.x, _c.y, _c.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + z.thick * 0.5);
          if (tt >= 0 && tt < len) w.hurtPlayerBeam(z.dmg, `${b.name} requiem`, p);
        }
        break;
      }
    }
    if (done) b.zones.splice(i, 1);
  }
}

/** A point on a lob from a to b (k 0..1), arcing up. */
function arcPoint(a: Vector3, c: Vector3, k: number, out: Vector3): Vector3 {
  out.copy(a).lerp(c, k);
  out.y += Math.sin(k * Math.PI) * Math.max(14, a.distanceTo(c) * 0.35);
  return out;
}

/** Where a flying part should be this tick (null if it is on its mount). */
export function flightPos(b: BossController, p: Enemy, mount: Vector3, out: Vector3): Vector3 | null {
  const f = b.flights.get(p);
  if (!f) return null;
  const ease = (k: number) => 1 - (1 - k) * (1 - k);
  if (f.t < f.out) return out.copy(f.from).lerp(f.target, ease(f.t / f.out));
  if (f.t < f.out + f.hang) return out.copy(f.target);
  const k = Math.min(1, (f.t - f.out - f.hang) / f.back);
  return out.copy(f.target).lerp(mount, k * k);
}
