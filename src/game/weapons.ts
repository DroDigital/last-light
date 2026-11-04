import { Quaternion, Vector3 } from 'three';
import type { World } from './world';
import { raySphere } from './world';
import type { Controls } from './player';
import type { WeaponInstance } from './build';
import type { Enemy } from './entities';
import { PF_ECHO, PF_KINETIC, PF_MINE, PF_MISSILE } from './entities';

const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _d = new Vector3();
const _t = new Vector3();
const _m = new Vector3();
const _q = new Quaternion();

export interface RailFx {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  t: number;
  width: number;
  r: number;
  g: number;
  b: number;
}

/** Aim assist tuning, set by the game from settings/device. */
export const aim = { strength: 0.55, cone: 0.07, range: 240 };

const hits: { e: Enemy; t: number }[] = [];

function computeAim(w: World): void {
  const pl = w.player;
  pl.forward(_f);
  pl.aimDir.copy(_f);
  pl.aimTarget = -1;
  if (aim.strength <= 0) return;
  let best: Enemy | null = null;
  let bestScore = Math.cos(aim.cone * 2.2);
  for (const e of w.enemies) {
    if (!e.alive || !e.revealed || e.def.role === 'inert' || e.invuln) continue;
    _t.copy(e.pos).sub(pl.pos);
    const dist = _t.length();
    if (dist > aim.range || dist < 2) continue;
    const dot = _t.dot(_f) / dist;
    // widen the cone for nearby targets so the assist feels consistent in screen space
    const cone = Math.cos(Math.min(0.5, aim.cone + (e.radius * 0.6) / dist));
    if (dot < cone) continue;
    const score = dot - dist / 4000;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (!best) return;
  const sp = Math.max(120, w.build.primary.params.speed);
  const dist = best.pos.distanceTo(pl.pos);
  _t.copy(best.pos).addScaledVector(best.vel, (dist / sp) * 0.9).sub(pl.pos).normalize();
  pl.aimDir.lerp(_t, aim.strength).normalize();
  pl.aimTarget = best.id;
}

/**
 * Gun hardpoints in ship space (forward = -Z), matched to each hull's mesh in
 * render/meshes.ts: primary fire alternates between the left/right guns
 * (x is mirrored), secondary/beam/arc fire leaves the nose. `scale` matches the
 * hull's render scale.
 */
export const HARDPOINTS: Record<string, { primary: [number, number, number]; nose: [number, number, number]; scale: number }> = {
  lantern: { primary: [1.75, 0.05, 0.1], nose: [0, -0.05, -1.85], scale: 1 },
  moth: { primary: [0.62, 0, -0.45], nose: [0, 0, -1.4], scale: 0.8 },
  bastion: { primary: [1.0, 0, -0.95], nose: [0, 0.35, -1.25], scale: 1.2 },
  prism: { primary: [1.05, 0, -0.35], nose: [0, 0, -1.65], scale: 1 },
  ember: { primary: [1.3, -0.1, 0.05], nose: [0, 0, -1.65], scale: 1 },
  wraith: { primary: [0.8, 0, -0.45], nose: [0, 0, -1.85], scale: 1 },
};

const _bank = new Quaternion();
const _ax = new Vector3(0, 0, 1);
/** World-space muzzle. side ±1 = left/right primary gun, 0 = nose. Follows the visual bank/roll. */
export function muzzle(w: World, side: number, out: Vector3): Vector3 {
  const pl = w.player;
  const hp = HARDPOINTS[w.build.hull.id] ?? HARDPOINTS.lantern!;
  const src = side === 0 ? hp.nose : hp.primary;
  _bank.setFromAxisAngle(_ax, pl.bank + pl.roll);
  out.set(src[0] * (side === 0 ? 1 : side), src[1], src[2]).multiplyScalar(hp.scale).applyQuaternion(_bank).applyQuaternion(pl.quat);
  return out.add(pl.pos);
}

const _conv = new Vector3();
/** Direction from a muzzle to the shared convergence point on the aim line. */
function convergeDir(w: World, m: Vector3, out: Vector3): Vector3 {
  const pl = w.player;
  _conv.copy(pl.pos).addScaledVector(pl.aimDir, 90);
  return out.copy(_conv).sub(m).normalize();
}
const _aim = new Vector3();

/** Random direction inside a cone around dir. */
function coneDir(w: World, dir: Vector3, angle: number, out: Vector3): Vector3 {
  if (angle <= 0) return out.copy(dir);
  _u.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.95) _u.set(1, 0, 0);
  _r.crossVectors(dir, _u).normalize();
  _u.crossVectors(_r, dir).normalize();
  const a = w.rng.next() * Math.PI * 2;
  const rr = Math.sqrt(w.rng.next()) * angle;
  return out.copy(dir).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
}

/** Even horizontal fan (in ship space) with slight vertical jitter. */
function fanDir(w: World, dir: Vector3, i: number, n: number, spread: number, out: Vector3): Vector3 {
  if (n <= 1) return coneDir(w, dir, spread, out);
  const pl = w.player;
  pl.right(_r);
  pl.up(_u);
  const off = (i / (n - 1) - 0.5) * 2 * spread * Math.min(n, 8) * 0.5;
  return out
    .copy(dir)
    .addScaledVector(_r, off)
    .addScaledVector(_u, (w.rng.next() - 0.5) * spread * 0.6)
    .normalize();
}

let side = 1;

function fireBullets(w: World, wi: WeaponInstance, secondary: boolean, dmgMul = 1, origin?: Vector3): void {
  const p = wi.params;
  const pl = w.player;
  const kinetic = wi.hasTag('kinetic') ? PF_KINETIC : 0;
  const isMissile = wi.def.behavior === 'missile';
  const isMine = wi.def.behavior === 'mine';
  const echo = wi.def.id === 'echo' ? PF_ECHO : 0;
  let count = p.count;
  if (pl.flareT > 0 && w.build.flags.has('overdrive')) count *= 2;
  if (wi.def.id === 'photon' && wi.evolved && pl.flareT > 0) count *= 2;
  side = -side;
  // primary guns alternate; secondaries leave the nose
  const m = origin ?? muzzle(w, secondary ? 0 : side, _m);
  convergeDir(w, m, _aim);
  let dmg = p.damage * dmgMul;
  if (wi.def.family === 'light') dmg *= 1 + Math.min(pl.lightTotal, 3000) / 3000;
  // nova7 artifact
  let novaShot = false;
  if (!secondary && w.build.flags.has('nova7') && wi.shots % 7 === 6) novaShot = true;
  for (let i = 0; i < count; i++) {
    if (isMine) {
      pl.forward(_f);
      coneDir(w, _f.negate(), 1.3, _d);
      _d.multiplyScalar(p.speed * (0.6 + w.rng.next() * 0.8));
    } else if (isMissile && count > 2) {
      coneDir(w, _aim, p.spread, _d).multiplyScalar(p.speed);
    } else {
      fanDir(w, _aim, i, count, p.spread, _d).multiplyScalar(p.speed * (isMissile ? 1 : 0.95 + w.rng.next() * 0.1));
    }
    const flags = kinetic | (isMissile ? PF_MISSILE : 0) | (isMine ? PF_MINE : 0) | echo;
    const kind = isMissile || isMine ? 5 : 0;
    const k = w.proj.spawn(m.x, m.y, m.z, _d.x + pl.vel.x * 0.4, _d.y + pl.vel.y * 0.4, _d.z + pl.vel.z * 0.4, p.life, dmg, p.size, flags, kind, wi.slotIndex);
    if (k < 0) break;
    w.proj.pierce[k] = p.pierce;
    w.proj.homing[k] = p.homing;
    w.proj.ricochet[k] = p.ricochet;
    w.proj.split[k] = p.split;
    w.proj.explode[k] = p.explode;
    if (novaShot && i === 0) {
      w.proj.explode[k] = 16;
      w.proj.dmg[k] = dmg * 3;
      w.proj.size[k] = p.size * 2.5;
      w.proj.pierce[k] = 0;
    }
    if (w.build.flags.has('echoChamber') && w.rng.next() < 0.15) {
      coneDir(w, _d.normalize(), 0.06, _t).multiplyScalar(p.speed);
      const q = w.proj.spawn(m.x, m.y, m.z, _t.x, _t.y, _t.z, p.life, dmg, p.size, flags, kind, wi.slotIndex);
      if (q >= 0) {
        w.proj.pierce[q] = p.pierce;
        w.proj.homing[q] = p.homing;
        w.proj.split[q] = p.split;
        w.proj.explode[q] = p.explode;
      }
    }
  }
  // Prism hull refraction
  if (!secondary && w.build.flags.has('prismHull')) {
    for (const s of [-1, 1]) {
      pl.right(_r);
      _d.copy(_aim).addScaledVector(_r, s * 0.05).normalize().multiplyScalar(p.speed);
      const k = w.proj.spawn(m.x, m.y, m.z, _d.x, _d.y, _d.z, p.life * 0.8, dmg * 0.4, p.size * 0.7, kinetic, 0, wi.slotIndex);
      if (k >= 0) w.proj.pierce[k] = p.pierce;
    }
  }
}

function fireRail(w: World, wi: WeaponInstance): void {
  const p = wi.params;
  side = -side;
  const m = muzzle(w, side, _m);
  for (let n = 0; n < p.count; n++) {
    convergeDir(w, m, _aim);
    const dir = n === 0 ? _d.copy(_aim) : fanDir(w, _aim, n, p.count, 0.03, _d);
    hits.length = 0;
    for (const e of w.enemies) {
      if (!e.alive || !e.revealed) continue;
      const t = raySphere(m.x, m.y, m.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y, e.pos.z, e.radius + p.size);
      if (t >= 0 && t < p.range) hits.push({ e, t });
    }
    hits.sort((a, b) => a.t - b.t);
    let endT = p.range;
    const maxHits = p.pierce + 1;
    for (let i = 0; i < hits.length && i < maxHits; i++) {
      const h = hits[i]!;
      w.damageEnemy(h.e, p.damage * (1 - i * 0.04), wi.slotIndex, m.x + dir.x * h.t, m.y + dir.y * h.t, m.z + dir.z * h.t, -dir.x, -dir.y, -dir.z, { kinetic: true });
      if (h.e.invuln) {
        endT = h.t;
        break;
      }
    }
    const c = w.colorOf(wi.slotIndex);
    w.rails.push({ ax: m.x, ay: m.y, az: m.z, bx: m.x + dir.x * endT, by: m.y + dir.y * endT, bz: m.z + dir.z * endT, t: 0, width: p.size, r: c[0], g: c[1], b: c[2] });
  }
}

function fireBeam(w: World, wi: WeaponInstance, secondary: boolean, doDamage: boolean): void {
  const p = wi.params;
  const pl = w.player;
  const m = muzzle(w, 0, _m);
  const c = w.colorOf(wi.slotIndex);
  let dmg = p.damage;
  if (wi.def.family === 'light') dmg *= 1 + Math.min(pl.lightTotal, 3000) / 1500;
  if (wi.def.id === 'flarebeam' && wi.evolved && pl.flareT > 0) dmg *= 2;
  for (let n = 0; n < p.count; n++) {
    convergeDir(w, m, _aim);
    const dir = n === 0 ? _d.copy(_aim) : fanDir(w, _aim, n, p.count, 0.04, _d);
    hits.length = 0;
    for (const e of w.enemies) {
      if (!e.alive || !e.revealed) continue;
      const t = raySphere(m.x, m.y, m.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y, e.pos.z, e.radius + p.size);
      if (t >= 0 && t < p.range) hits.push({ e, t });
    }
    hits.sort((a, b) => a.t - b.t);
    let endT = p.range;
    const maxHits = p.pierce + 1;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]!;
      if (i >= maxHits || h.e.invuln) {
        endT = h.t;
        if (h.e.invuln && doDamage) w.damageEnemy(h.e, dmg, wi.slotIndex, m.x + dir.x * h.t, m.y + dir.y * h.t, m.z + dir.z * h.t, -dir.x, -dir.y, -dir.z);
        break;
      }
      if (doDamage) w.damageEnemy(h.e, dmg, wi.slotIndex, m.x + dir.x * h.t, m.y + dir.y * h.t, m.z + dir.z * h.t, -dir.x, -dir.y, -dir.z, { knock: 0.5 });
    }
    w.beams.push({ ax: m.x, ay: m.y, az: m.z, bx: m.x + dir.x * endT, by: m.y + dir.y * endT, bz: m.z + dir.z * endT, width: p.size * (0.8 + Math.sin(w.time * 40) * 0.15), r: c[0], g: c[1], b: c[2], enemy: false });
  }
  if (doDamage) w.events.emit('beamTick', { secondary });
}

function fireArc(w: World, wi: WeaponInstance): void {
  const p = wi.params;
  const pl = w.player;
  const m = muzzle(w, 0, _m);
  let best: Enemy | null = null;
  let bd = p.range;
  for (const e of w.enemies) {
    if (!e.alive || !e.revealed || e.def.role === 'inert') continue;
    _t.copy(e.pos).sub(m);
    const d = _t.length();
    if (d > p.range) continue;
    const dot = _t.dot(pl.aimDir) / (d || 1);
    if (dot < 0.75) continue;
    const score = d * (2 - dot);
    if (score < bd) {
      bd = score;
      best = e;
    }
  }
  if (!best) {
    _t.copy(m).addScaledVector(pl.aimDir, p.range * 0.5);
    w.arcs.push({ ax: m.x, ay: m.y, az: m.z, bx: _t.x, by: _t.y, bz: _t.z, t: 0.05, color: 0, seed: w.rng.next() });
    return;
  }
  w.arcs.push({ ax: m.x, ay: m.y, az: m.z, bx: best.pos.x, by: best.pos.y, bz: best.pos.z, t: 0, color: 0, seed: w.rng.next() });
  _t.copy(best.pos).sub(m).normalize();
  w.damageEnemy(best, p.damage, wi.slotIndex, best.pos.x, best.pos.y, best.pos.z, -_t.x, -_t.y, -_t.z);
  if (best.alive || p.chain > 0) w.chainLightning(best, p.chain, p.damage * 0.8, wi.slotIndex, p.range * 0.5);
}

function fireWell(w: World, wi: WeaponInstance): void {
  const p = wi.params;
  const pl = w.player;
  const m = muzzle(w, 0, _m);
  const eh = w.build.flags.has('eventhorizon') ? 1.3 : 1;
  w.wells.push({
    x: m.x, y: m.y, z: m.z,
    vx: pl.aimDir.x * p.speed + pl.vel.x * 0.5, vy: pl.aimDir.y * p.speed + pl.vel.y * 0.5, vz: pl.aimDir.z * p.speed + pl.vel.z * 0.5,
    radius: p.range, life: p.life * eh, maxLife: p.life * eh, pull: p.special, dmg: p.damage, src: wi.slotIndex,
    tick: 0, shock: p.shock > 0, explode: p.explode, active: true,
  });
}

function firePulse(w: World, wi: WeaponInstance): void {
  const p = wi.params;
  const pl = w.player;
  const scale = 1 + Math.min(pl.lightTotal, 4000) / 4000;
  const c = w.colorOf(wi.slotIndex);
  w.explode(pl.pos.x, pl.pos.y, pl.pos.z, p.range * scale, p.damage * scale, wi.slotIndex, { color: c, knock: p.knock });
  if (p.radiant > 0) w.forEnemiesNear(pl.pos.x, pl.pos.y, pl.pos.z, p.range * scale, (e) => void (e.radiantT = 3));
}

function fireWeapon(w: World, wi: WeaponInstance, secondary: boolean): void {
  switch (wi.def.behavior) {
    case 'bullet':
    case 'missile':
    case 'mine':
      fireBullets(w, wi, secondary);
      break;
    case 'rail':
      fireRail(w, wi);
      break;
    case 'arc':
      fireArc(w, wi);
      break;
    case 'well':
      fireWell(w, wi);
      break;
    case 'pulse':
      firePulse(w, wi);
      break;
    default:
      break;
  }
  wi.shots++;
  const pl = w.player;
  pl.forward(_f);
  if (wi.def.behavior !== 'pulse')
    w.events.emit('shot', { x: _m.x, y: _m.y, z: _m.z, dx: pl.aimDir.x, dy: pl.aimDir.y, dz: pl.aimDir.z, w: wi, secondary });
}

export function updateWeapons(w: World, c: Controls, dt: number): void {
  const pl = w.player;
  w.beams.length = 0;
  for (let i = w.rails.length - 1; i >= 0; i--) {
    w.rails[i]!.t += dt;
    if (w.rails[i]!.t > 0.25) w.rails.splice(i, 1);
  }
  computeAim(w);
  if (!pl.alive) return;
  const flareRate = pl.flareT > 0 ? 2 : 1;

  // primary
  const pw = w.build.primary;
  pw.cd -= dt;
  if (c.fire1) {
    if (pw.def.behavior === 'beam') {
      const tick = pw.cd <= 0;
      if (tick) pw.cd += 1 / (pw.params.rate * flareRate);
      fireBeam(w, pw, false, tick);
      pl.firingT = 0;
      if (pw.cd < -0.1) pw.cd = 0;
    } else if (pw.cd <= 0) {
      fireWeapon(w, pw, false);
      pw.cd += 1 / (pw.params.rate * flareRate);
      if (pw.cd < -0.05) pw.cd = 0;
      pl.recoil = Math.min(1, pl.recoil + (pw.def.recoil ?? 0.05) * 4);
      pl.firingT = 0;
      // nth-shot triggers
      for (const t of w.build.triggers)
        if (t.on === 'nthShot' && t.every && pw.shots % t.every === 0) w.fireTriggers('nthShot', _m.x, _m.y, _m.z, 0);
      // mirror drones copy the primary
      for (const d of w.drones) {
        if (d.kind !== 'mirror') continue;
        const mw = w.weaponsByIndex[d.src]!;
        if (pw.def.behavior === 'bullet' || pw.def.behavior === 'missile') fireBullets(w, pw, false, mw.params.damage, d.pos);
      }
    }
  } else if (pw.cd < 0) pw.cd = 0;

  // secondary
  const sw = w.build.secondary;
  sw.cd -= dt;
  if (c.fire2) {
    if (sw.def.behavior === 'beam') {
      const tick = sw.cd <= 0;
      if (tick) sw.cd += 1 / (sw.params.rate * flareRate);
      fireBeam(w, sw, true, tick);
      if (sw.cd < -0.1) sw.cd = 0;
    } else if (sw.cd <= 0) {
      fireWeapon(w, sw, true);
      if (w.build.flags.has('twinSoul')) fireWeapon(w, sw, true);
      sw.cd = 1 / (sw.params.rate * (flareRate > 1 ? 1.5 : 1));
      pl.recoil = Math.min(1, pl.recoil + 0.3);
      w.fireTriggers('secondary', pl.pos.x, pl.pos.y, pl.pos.z, 0);
    }
  } else if (sw.cd < 0) sw.cd = 0;

  // systems
  const combat = w.liveEnemyCount() > 0;
  w.blockers.length = 0;
  for (const sys of w.build.systems) {
    const p = sys.params;
    if (sys.def.behavior === 'pulse') {
      sys.cd -= dt;
      if (sys.cd <= 0 && combat) {
        fireWeapon(w, sys, false);
        sys.cd = 1 / (p.rate * flareRate);
      }
    } else if (sys.def.behavior === 'halo') {
      updateHalo(w, sys, dt);
    }
  }
  if (w.build.flags.has('lanternHeart')) {
    w.heartT = (w.heartT ?? 0) - dt;
    if (w.heartT <= 0 && combat) {
      w.heartT = 3;
      w.explode(pl.pos.x, pl.pos.y, pl.pos.z, 16, 25 * w.build.ship.globalDamage, w.triggerSrc, { color: [1, 0.95, 0.7] });
    }
  }
  updateDrones(w, dt, combat);
}

/** World positions of halo blades this tick (for rendering). */
export function haloPositions(w: World, sys: WeaponInstance, time: number, out: Vector3[]): number {
  const p = sys.params;
  const pl = w.player;
  const n = Math.max(1, p.special);
  const sentinel = sys.def.id === 'sentinel';
  const spd = sentinel ? 1.2 : 2.6;
  for (let i = 0; i < n; i++) {
    const a = time * spd + (i / n) * Math.PI * 2;
    const tilt = sentinel ? 0.5 : 0.25;
    const v = out[i] ?? (out[i] = new Vector3());
    _q.setFromAxisAngle(_t.set(0, 1, 0), a);
    v.set(p.range, 0, 0).applyQuaternion(_q);
    v.y += Math.sin(a * 2 + i) * p.range * tilt;
    v.add(pl.pos);
  }
  return n;
}

const _halo: Vector3[] = [];
function updateHalo(w: World, sys: WeaponInstance, _dt: number): void {
  const p = sys.params;
  const n = haloPositions(w, sys, w.time, _halo);
  const sentinel = sys.def.id === 'sentinel';
  for (let i = 0; i < n; i++) {
    const h = _halo[i]!;
    if (sentinel) w.blockers.push(h.x, h.y, h.z, 1.4 * p.size);
    w.forEnemiesNear(h.x, h.y, h.z, 1.2 * p.size + 0.5, (e) => {
      if (e.hitCdHalo > 0) return;
      e.hitCdHalo = 0.25;
      _t.copy(e.pos).sub(h).normalize();
      w.damageEnemy(e, p.damage, sys.slotIndex, h.x, h.y, h.z, -_t.x, -_t.y, -_t.z, { knock: 8 });
    });
  }
}

/** Ensure drone entities match drone weapons. */
export function syncDrones(w: World): void {
  const want: { kind: 'interceptor' | 'wisp' | 'mirror' | 'layer'; src: number }[] = [];
  for (const sys of w.build.systems) {
    if (sys.def.behavior !== 'drone') continue;
    const kind = sys.def.id === 'interceptors' ? 'interceptor' : sys.def.id === 'wisp' ? 'wisp' : sys.def.id === 'mirror' ? 'mirror' : 'layer';
    for (let i = 0; i < Math.max(1, sys.params.special); i++) want.push({ kind, src: sys.slotIndex });
  }
  const pl = w.player;
  while (w.drones.length > want.length) w.drones.pop();
  for (let i = 0; i < want.length; i++) {
    const d = w.drones[i];
    if (d) {
      d.kind = want[i]!.kind;
      d.src = want[i]!.src;
    } else
      w.drones.push({
        kind: want[i]!.kind, src: want[i]!.src, pos: pl.pos.clone(), prev: pl.pos.clone(), vel: new Vector3(),
        quat: new Quaternion(), cd: w.rng.next(), phase: i * 1.7, target: -1,
      });
  }
}

function updateDrones(w: World, dt: number, combat: boolean): void {
  const pl = w.player;
  pl.forward(_f);
  for (let i = 0; i < w.drones.length; i++) {
    const d = w.drones[i]!;
    d.prev.copy(d.pos);
    const wi = w.weaponsByIndex[d.src];
    if (!wi) continue;
    const p = wi.params;
    // formation slot around the player
    const a = w.time * 0.8 + d.phase;
    _t.set(Math.cos(a) * 5, 1.5 + Math.sin(a * 1.3) * 1.2, Math.sin(a) * 5 + 2).applyQuaternion(pl.quat).add(pl.pos);
    let tgt: Enemy | null = null;
    if (combat && (d.kind === 'interceptor' || d.kind === 'layer' || d.kind === 'wisp')) tgt = w.nearestEnemy(d.pos.x, d.pos.y, d.pos.z, d.kind === 'layer' ? 80 : 60);
    if (tgt && d.kind === 'interceptor') {
      _d.copy(tgt.pos).sub(d.pos);
      const dist = _d.length();
      _d.normalize();
      // dart toward target but stay leashed
      _t.lerp(_m.copy(tgt.pos).addScaledVector(_d, -12), Math.min(1, 30 / (dist + 1)) * 0.6);
    }
    d.vel.lerp(_t.sub(d.pos).multiplyScalar(6), Math.min(1, dt * 6));
    d.pos.addScaledVector(d.vel, dt);
    d.cd -= dt * (w.player.flareT > 0 ? 2 : 1);
    if (d.kind === 'wisp') {
      pl.shield = Math.min(pl.maxShield, pl.shield + 2.5 * dt * (wi.evolved ? 1.5 : 1));
      if (wi.evolved) pl.hull = Math.min(pl.maxHull, pl.hull + 0.4 * dt);
    }
    if (!tgt || d.cd > 0) continue;
    if (d.kind === 'interceptor' || d.kind === 'wisp') {
      d.cd = 1 / Math.max(0.5, p.rate);
      _d.copy(tgt.pos).addScaledVector(tgt.vel, 0.15).sub(d.pos).normalize().multiplyScalar(p.speed || 200);
      if (d.kind === 'wisp') {
        w.arcs.push({ ax: d.pos.x, ay: d.pos.y, az: d.pos.z, bx: tgt.pos.x, by: tgt.pos.y, bz: tgt.pos.z, t: 0, color: 0, seed: w.rng.next() });
        w.damageEnemy(tgt, p.damage, d.src, tgt.pos.x, tgt.pos.y, tgt.pos.z, 0, 1, 0);
      } else {
        const k = w.proj.spawn(d.pos.x, d.pos.y, d.pos.z, _d.x, _d.y, _d.z, p.life || 0.8, p.damage, p.size || 0.25, PF_KINETIC, 0, d.src);
        if (k >= 0) w.proj.pierce[k] = p.pierce;
      }
    } else if (d.kind === 'layer') {
      d.cd = 1 / Math.max(0.3, p.rate);
      const k = w.proj.spawn(tgt.pos.x + w.rng.range(-6, 6), tgt.pos.y + w.rng.range(-6, 6), tgt.pos.z + w.rng.range(-6, 6), 0, 0, 0, p.life || 10, p.damage, 0.6, PF_MINE, 5, d.src);
      if (k >= 0) w.proj.explode[k] = p.explode || 7;
    }
  }
}
