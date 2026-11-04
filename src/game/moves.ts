import { Vector3 } from 'three';
import type { World } from './world';
import type { Enemy } from './entities';
import { fireAt, ringBurst } from './ai';
import { raySphere } from './world';

/**
 * Signature moves. Role code (ai.ts) gives every enemy its baseline behaviour;
 * a subtype adds 2-4 moves from this library on top, chosen by range and
 * situation, each with a readable telegraph. A Strafer gunship and a Bombard
 * gunship share a hull and a role but fight differently.
 */
export type MoveId =
  | 'dash' | 'flank' | 'dive' | 'burst' | 'fan' | 'snipe' | 'mines' | 'ring' | 'spiral' | 'ram'
  | 'feint' | 'retreat' | 'blink' | 'orb' | 'sweep' | 'artillery' | 'evade' | 'call' | 'bulwark';

interface MoveDef {
  /** cooldown after use, seconds [min, max] */
  cd: [number, number];
  /** usable when the target is within [min, max] metres */
  range: [number, number];
  /** extra gate */
  when?: (w: World, e: Enemy, dist: number) => boolean;
  /** duration in seconds; 0 = instant */
  dur: number;
  /** spends an attack token (the shared limit on simultaneous attackers) */
  attack?: boolean;
  start?: (w: World, e: Enemy, dist: number) => void;
  tick?: (w: World, e: Enemy, dt: number, t: number, dist: number) => void;
}

const _d = new Vector3();
const _s = new Vector3();
const _t = new Vector3();
const UP = new Vector3(0, 1, 0);

function toTarget(w: World, e: Enemy): Vector3 {
  return _d.copy(w.player.pos).sub(e.pos).normalize();
}
function side(e: Enemy): Vector3 {
  _s.crossVectors(_d, UP);
  if (_s.lengthSq() < 0.01) _s.set(1, 0, 0);
  return _s.normalize().multiplyScalar(e.orbitDir);
}
const fire = (e: Enemy) => e.def.fire;
const dmgOf = (e: Enemy, k = 1) => (fire(e)?.damage ?? 8) * k;
const spd = (e: Enemy) => e.def.speed * e.speedMul;
/** the player is pointing at this enemy (within ~15 degrees) */
function aimedAt(w: World, e: Enemy): boolean {
  const pl = w.player;
  pl.forward(_t);
  _s.copy(e.pos).sub(pl.pos).normalize();
  return _t.dot(_s) > 0.965;
}

export const MOVES: Record<MoveId, MoveDef> = {
  // --- movement
  dash: {
    cd: [1.8, 3.2], range: [0, 140], dur: 0.35,
    when: (w, e) => aimedAt(w, e),
    start: (w, e) => {
      toTarget(w, e);
      e.moveVec.copy(side(e)).multiplyScalar(spd(e) * 2.6 + 20);
      if (w.rng.chance(0.5)) e.moveVec.negate();
    },
    tick: (_w, e) => e.vel.copy(e.moveVec),
  },
  evade: {
    cd: [1.2, 2.4], range: [0, 160], dur: 0.3,
    when: (w, e) => {
      const P = w.proj;
      for (let i = 0; i < P.n; i++) {
        const dx = P.x[i]! - e.pos.x;
        const dy = P.y[i]! - e.pos.y;
        const dz = P.z[i]! - e.pos.z;
        if (dx * dx + dy * dy + dz * dz < (e.radius + 10) ** 2) return true;
      }
      return false;
    },
    start: (w, e) => {
      toTarget(w, e);
      e.moveVec.copy(side(e)).multiplyScalar(spd(e) * 2.2 + 16).addScaledVector(UP, w.rng.range(-12, 12));
    },
    tick: (_w, e) => e.vel.copy(e.moveVec),
  },
  flank: {
    cd: [5, 8], range: [25, 120], dur: 2.2,
    tick: (w, e) => {
      const pl = w.player;
      pl.forward(_t);
      _s.copy(pl.pos).addScaledVector(_t, -34).sub(e.pos);
      const l = _s.length() || 1;
      e.vel.copy(_s).multiplyScalar((spd(e) * 1.7) / l);
    },
  },
  dive: {
    cd: [4, 7], range: [30, 110], dur: 1.4,
    tick: (w, e, _dt, t) => {
      toTarget(w, e);
      if (t < 0.9) e.vel.copy(_d).multiplyScalar(spd(e) * 2.4);
      else e.vel.copy(side(e)).multiplyScalar(spd(e) * 2.4).addScaledVector(_d, -spd(e));
      e.emissive = Math.max(e.emissive, 0.6);
    },
  },
  retreat: {
    cd: [6, 9], range: [0, 60], dur: 1.6,
    when: (_w, e) => e.hp < e.maxHp * 0.4,
    tick: (w, e) => {
      toTarget(w, e);
      e.vel.copy(_d).multiplyScalar(-spd(e) * 1.9).addScaledVector(side(e), spd(e) * 0.6);
    },
  },
  blink: {
    cd: [5, 8], range: [0, 60], dur: 0,
    start: (w, e) => {
      w.events.emit('explosion', { x: e.pos.x, y: e.pos.y, z: e.pos.z, radius: 3, r: 0.7, g: 0.5, b: 1, enemy: false });
      toTarget(w, e);
      e.pos.addScaledVector(side(e), w.rng.range(14, 22)).addScaledVector(UP, w.rng.range(-6, 6));
      e.prev.copy(e.pos);
      w.events.emit('spawn', { x: e.pos.x, y: e.pos.y, z: e.pos.z, faction: e.def.faction, big: false });
    },
  },
  ram: {
    cd: [5, 8], range: [15, 70], dur: 1.3, attack: true,
    start: (w, e) => {
      e.moveVec.copy(w.player.pos).addScaledVector(w.player.vel, 0.3);
      w.addTelegraph({ kind: 'line', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.moveVec.x, by: e.moveVec.y, bz: e.moveVec.z, radius: e.radius, dur: 0.6, owner: e.id });
    },
    tick: (_w, e, _dt, t) => {
      if (t < 0.6) {
        e.vel.multiplyScalar(0.85);
        e.emissive = t / 0.6;
        return;
      }
      if (t < 0.62) {
        _t.copy(e.moveVec).sub(e.pos).normalize();
        e.moveVec.copy(_t).multiplyScalar(spd(e) * 5 + 40);
      }
      e.vel.copy(e.moveVec);
      e.emissive = 1;
    },
  },
  // --- fire
  burst: {
    cd: [2.4, 3.6], range: [10, 110], dur: 0.4, attack: true,
    tick: (w, e, dt, t) => {
      const shots = [0, 0.13, 0.26];
      for (const s of shots) if (t >= s && t - dt < s) fireAt(w, e, (fire(e)?.speed ?? 55) * 1.1, dmgOf(e, 0.8), 1, 1, 0, 0.8, 0.7);
    },
  },
  fan: {
    cd: [3, 4.5], range: [8, 70], dur: 0.45, attack: true,
    start: (_w, e) => (e.emissive = 1),
    tick: (w, e, dt, t) => {
      if (t >= 0.4 && t - dt < 0.4) fireAt(w, e, (fire(e)?.speed ?? 45) * 0.9, dmgOf(e, 0.7), 2, 7, 0.4, 0.4, 0.7);
    },
  },
  feint: {
    cd: [5, 7], range: [10, 60], dur: 0.9, attack: true,
    start: (w, e) => {
      e.moveVec.copy(w.player.pos);
      w.addTelegraph({ kind: 'line', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.moveVec.x, by: e.moveVec.y, bz: e.moveVec.z, radius: e.radius, dur: 0.5, owner: e.id });
    },
    tick: (w, e, dt, t) => {
      // looks like a charge, then sheers away and fans
      if (t < 0.5) e.emissive = t * 2;
      if (t >= 0.5 && t - dt < 0.5) {
        toTarget(w, e);
        e.vel.copy(side(e)).multiplyScalar(spd(e) * 2.5);
        fireAt(w, e, 50, dmgOf(e, 0.7), 2, 5, 0.35, 0.6, 0.7);
      }
    },
  },
  snipe: {
    cd: [5, 7], range: [40, 160], dur: 1.0, attack: true,
    start: (w, e) => {
      toTarget(w, e);
      e.moveVec.copy(_d);
      w.addTelegraph({ kind: 'line', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.pos.x + _d.x * 170, by: e.pos.y + _d.y * 170, bz: e.pos.z + _d.z * 170, radius: 0.7, dur: 0.85, owner: e.id });
    },
    tick: (w, e, dt, t) => {
      e.vel.multiplyScalar(0.9);
      e.emissive = Math.min(1, t / 0.85);
      if (t < 0.55) e.moveVec.lerp(toTarget(w, e), 0.1).normalize();
      for (const tg of w.telegraphs) if (tg.owner === e.id) {
        tg.ax = e.pos.x; tg.ay = e.pos.y; tg.az = e.pos.z;
        tg.bx = e.pos.x + e.moveVec.x * 170; tg.by = e.pos.y + e.moveVec.y * 170; tg.bz = e.pos.z + e.moveVec.z * 170;
      }
      if (t >= 0.85 && t - dt < 0.85) {
        _t.copy(e.moveVec).multiplyScalar(170);
        w.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, _t.x, _t.y, _t.z, dmgOf(e, 1.4) * e.dmgMul, 2, 1, 2);
        w.events.emit('enemyShot', { x: e.pos.x, y: e.pos.y, z: e.pos.z, big: true });
      }
    },
  },
  orb: {
    cd: [4, 6], range: [20, 130], dur: 0, attack: true,
    start: (w, e) => {
      toTarget(w, e);
      const k = w.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, _d.x * 28, _d.y * 28, _d.z * 28, dmgOf(e, 1.2) * e.dmgMul, 1, 1.4, 6);
      if (k >= 0) w.eproj.homing[k] = 2.2;
      w.events.emit('enemyShot', { x: e.pos.x, y: e.pos.y, z: e.pos.z, big: true });
    },
  },
  spiral: {
    cd: [6, 9], range: [0, 90], dur: 1.3, attack: true,
    tick: (w, e, dt, t) => {
      e.vel.multiplyScalar(0.9);
      e.spin += dt * 6;
      if (Math.floor(t / 0.07) !== Math.floor((t - dt) / 0.07)) {
        const a = t * 9 + e.id;
        _t.set(Math.cos(a), Math.sin(a * 0.5) * 0.3, Math.sin(a)).normalize().multiplyScalar(30);
        w.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, _t.x, _t.y, _t.z, dmgOf(e, 0.5) * e.dmgMul, 2, 0.7, 5);
      }
    },
  },
  ring: {
    cd: [4, 6], range: [0, 70], dur: 0.6, attack: true,
    start: (w, e) => w.addTelegraph({ kind: 'sphere', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: 0, by: 0, bz: 0, radius: e.radius * 2.6, dur: 0.6, owner: e.id }),
    tick: (w, e, dt, t) => {
      if (t >= 0.58 && t - dt < 0.58) ringBurst(w, e.pos.x, e.pos.y, e.pos.z, 14, 28, dmgOf(e, 0.7) * e.dmgMul, 1, e.spin);
    },
  },
  sweep: {
    cd: [6, 9], range: [10, 60], dur: 1.4, attack: true,
    start: (w, e) => {
      toTarget(w, e);
      e.moveVec.copy(_d).applyAxisAngle(UP, -0.6 * e.orbitDir);
    },
    tick: (w, e, dt, t) => {
      e.vel.multiplyScalar(0.85);
      const len = 70;
      if (t < 0.5) {
        e.emissive = t * 2;
        for (const tg of w.telegraphs) if (tg.owner === e.id) tg.t = 0;
        if (t - dt <= 0) w.addTelegraph({ kind: 'line', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.pos.x + e.moveVec.x * len, by: e.pos.y + e.moveVec.y * len, bz: e.pos.z + e.moveVec.z * len, radius: 1.2, dur: 0.5, owner: e.id });
        return;
      }
      e.moveVec.applyAxisAngle(UP, 1.3 * e.orbitDir * dt);
      const v = e.moveVec;
      w.beams.push({ ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.pos.x + v.x * len, by: e.pos.y + v.y * len, bz: e.pos.z + v.z * len, width: 1.2, r: 1, g: 0.3, b: 0.4, enemy: true });
      const pl = w.player;
      const hit = raySphere(e.pos.x, e.pos.y, e.pos.z, v.x, v.y, v.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + 0.8);
      if (hit >= 0 && hit < len) w.hurtPlayerBeam(dmgOf(e, 1) * e.dmgMul, `${e.def.name} sweep`, e);
    },
  },
  artillery: {
    cd: [5, 7], range: [30, 140], dur: 1.0, attack: true,
    start: (w, e) => {
      e.moveVec.copy(w.player.pos).addScaledVector(w.player.vel, 0.9);
      w.addTelegraph({ kind: 'sphere', ax: e.moveVec.x, ay: e.moveVec.y, az: e.moveVec.z, bx: 0, by: 0, bz: 0, radius: 9, dur: 1.0, owner: e.id });
    },
    tick: (w, e, dt, t) => {
      if (t >= 0.98 && t - dt < 0.98) {
        const p = e.moveVec;
        ringBurst(w, p.x, p.y, p.z, 10, 22, dmgOf(e, 0.6) * e.dmgMul, 2, t);
        w.explode(p.x, p.y, p.z, 9, dmgOf(e, 1.2) * e.dmgMul, -1, { enemy: true, color: [1, 0.55, 0.25] });
      }
    },
  },
  mines: {
    cd: [3, 5], range: [0, 90], dur: 0,
    start: (w, e) => {
      for (let i = 0; i < 2; i++) w.spawnEnemyShot(e.pos.x + w.rng.range(-3, 3), e.pos.y + w.rng.range(-2, 2), e.pos.z + w.rng.range(-3, 3), 0, 0, 0, 14 * e.dmgMul, 4, 1.1, 10);
    },
  },
  call: {
    cd: [7, 10], range: [0, 150], dur: 0,
    when: (w) => w.liveEnemyCount() < 180,
    start: (w, e) => {
      const child = e.def.faction === 'salvage' ? 'scrapper' : e.def.faction === 'choir' ? 'shardling' : 'moteeater';
      for (let i = 0; i < 2; i++) {
        const c = w.spawnEnemy(child, e.pos.x + w.rng.range(-4, 4), e.pos.y + w.rng.range(-3, 3), e.pos.z + w.rng.range(-4, 4));
        c.spawnT = 0.2;
      }
      e.emissive = 1;
    },
  },
  bulwark: {
    cd: [9, 12], range: [0, 100], dur: 0,
    when: (_w, e) => e.hp < e.maxHp * 0.7 && e.shield <= 0,
    start: (_w, e) => {
      e.shield = e.maxShield = Math.max(e.maxShield, e.maxHp * 0.3);
      e.flash = 1;
    },
  },
};

/** Per-frame: run the active move or pick the next one. */
export function updateMoves(w: World, e: Enemy, dt: number, dist: number, moves: readonly MoveId[]): void {
  if (!moves.length) return;
  if (e.move) {
    const m = MOVES[e.move as MoveId];
    e.moveTime += dt;
    m.tick?.(w, e, dt, e.moveTime, dist);
    if (e.moveTime >= m.dur) {
      if (m.attack && e.moveToken) {
        w.releaseToken(e);
        e.moveToken = false;
      }
      e.move = '';
    }
    return;
  }
  e.moveT -= dt;
  if (e.moveT > 0) return;
  // try the subtype's moves in a shuffled order; first usable wins
  const start = w.rng.int(0, moves.length - 1);
  for (let k = 0; k < moves.length; k++) {
    const id = moves[(start + k) % moves.length]!;
    const m = MOVES[id];
    if (dist < m.range[0] || dist > m.range[1]) continue;
    if (m.when && !m.when(w, e, dist)) continue;
    if (m.attack) {
      // role state machines hold their own token; don't double-book
      if (e.hasToken || !w.takeToken(e)) continue;
      e.moveToken = true;
    }
    e.move = id;
    e.moveTime = 0;
    e.moveT = w.rng.range(m.cd[0], m.cd[1]);
    m.start?.(w, e, dist);
    if (m.dur <= 0) {
      if (e.moveToken) {
        w.releaseToken(e);
        e.moveToken = false;
      }
      e.move = '';
    }
    return;
  }
  e.moveT = 0.5;
}
