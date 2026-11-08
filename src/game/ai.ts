import { Matrix4, Quaternion, Vector3 } from 'three';
import type { World } from './world';
import { raySphere } from './world';
import type { Enemy } from './entities';
import { damp } from '../core/math';
import { BAL } from '../data/balance';
import { updateAffixAI } from './affixai';
import { updateMoves } from './moves';
import { SUBTYPES } from '../data/subtypes';

const _d = new Vector3();
const _t = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _o = new Vector3();
const _qq = new Quaternion();
const _fd = new Vector3();

/** Aimed shot with partial lead. */
export function fireAt(w: World, e: Enemy, speed: number, dmg: number, kind: number, count = 1, spread = 0, lead = 0.5, size = 0.7): void {
  const pl = w.player;
  const tgt = w.decoys.length ? w.decoys[0]!.pos : pl.pos;
  const dist = e.pos.distanceTo(tgt);
  const tt = (dist / Math.max(speed * BAL.enemyShotSpeed, 1)) * Math.min(1, lead * BAL.enemyLead);
  _t.copy(tgt).addScaledVector(pl.vel, w.decoys.length ? 0 : tt).sub(e.pos).normalize();
  // perpendicular basis for spread
  _s.crossVectors(_t, _up);
  if (_s.lengthSq() < 0.01) _s.set(1, 0, 0);
  _s.normalize();
  for (let i = 0; i < count; i++) {
    const off = count > 1 ? (i / (count - 1) - 0.5) * spread * 2 : 0;
    _d.copy(_t).addScaledVector(_s, off).normalize().multiplyScalar(speed);
    const k = w.spawnEnemyShot(e.pos.x + _t.x * e.radius, e.pos.y + _t.y * e.radius, e.pos.z + _t.z * e.radius, _d.x, _d.y, _d.z, dmg * e.dmgMul, kind, size);
    if (k >= 0 && e.affixMask && e.has('seeking')) w.eproj.homing[k] = 1.6;
  }
  w.events.emit('enemyShot', { x: e.pos.x, y: e.pos.y, z: e.pos.z, big: count > 3 });
}

/** Ring burst in a random plane around e. */
export function ringBurst(w: World, x: number, y: number, z: number, n: number, speed: number, dmg: number, kind: number, phase = 0, plane?: Vector3, size = 0.8): void {
  const nrm = plane ?? _o.set(w.rng.next() - 0.5, w.rng.next() - 0.5, w.rng.next() - 0.5).normalize();
  _s.crossVectors(nrm, _up);
  if (_s.lengthSq() < 0.01) _s.set(1, 0, 0);
  _s.normalize();
  _t.crossVectors(nrm, _s).normalize();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase;
    const c = Math.cos(a);
    const s = Math.sin(a);
    _d.set(_s.x * c + _t.x * s, _s.y * c + _t.y * s, _s.z * c + _t.z * s).multiplyScalar(speed);
    w.spawnEnemyShot(x, y, z, _d.x, _d.y, _d.z, dmg, kind, size);
  }
  w.events.emit('enemyShot', { x, y, z, big: true });
}

export function faceDir(e: Enemy, dir: Vector3, dt: number, rate = 6): void {
  if (dir.lengthSq() < 1e-6) return;
  // own scratch: callers often pass the module scratch vectors as `dir`
  _fd.copy(e.pos).sub(dir);
  _m.lookAt(e.pos, _fd, _up);
  _qq.setFromRotationMatrix(_m);
  e.quat.slerp(_qq, Math.min(1, dt * rate));
}

function steerTo(e: Enemy, dx: number, dy: number, dz: number, speed: number, dt: number, k = 3): void {
  e.vel.x = damp(e.vel.x, dx * speed, k, dt);
  e.vel.y = damp(e.vel.y, dy * speed, k, dt);
  e.vel.z = damp(e.vel.z, dz * speed, k, dt);
}

export function updateEnemyAI(w: World, dt: number): void {
  const coop = w.wingmen.length > 0;
  const stasisR2 = (34 * w.build.ship.stasis) ** 2;
  const wake = w.build.flags.has('wakeFire');
  const hasBurnAura = w.build.triggers.some((t) => t.do === 'burnAura');
  for (const e of w.enemies) {
    if (!e.alive) continue;
    // each enemy hunts the nearer living pilot; every nested call (fireAt, moves,
    // affixes, contact damage) then reads w.player as that target
    if (coop) w.player = w.nearestPlayer(e.pos.x, e.pos.y, e.pos.z);
    const pl = w.player;
    const target = w.decoys.length ? w.decoys[0]!.pos : pl.pos;
    const stasis = pl.stasisT > 0;
    const ramBoost = pl.boosting && w.build.flags.has('ramBoost');
    const burnAura = pl.boosting && hasBurnAura;
    e.prev.copy(e.pos);
    e.prevQuat.copy(e.quat);
    const def = e.def;
    if (def.role === 'part' || (def.role === 'boss' && e.parent)) continue;
    let sp = def.speed * e.speedMul * (1 - e.cryo * 0.12 * (e.affixMask && e.has('relentless') ? 0 : 1));
    _d.copy(target).sub(e.pos);
    const dist = _d.length() || 1;
    _d.multiplyScalar(1 / dist);
    const relentless = e.affixMask !== 0 && e.has('relentless');
    const inStasis = stasis && !relentless && dist * dist < stasisR2;
    if (e.buffT > 0) sp *= 1.25;
    let tdt = dt;
    if (inStasis) {
      tdt *= 0.25;
      sp *= 0.25;
    }
    if (e.frozen) {
      e.vel.multiplyScalar(1 - dt * 5);
      e.pos.addScaledVector(e.vel, dt);
      continue;
    }
    if (e.spawnT > 0) {
      e.pos.addScaledVector(e.vel, dt);
      e.vel.multiplyScalar(1 - dt * 3);
      continue;
    }
    if (def.role === 'boss') {
      continue; // boss controller moves the core
    }
    e.timer -= tdt;

    switch (def.role) {
      case 'swarmer': {
        const weave = Math.sin(w.time * 3 + e.id) * 0.35;
        _s.crossVectors(_d, _up).normalize();
        steerTo(e, _d.x + _s.x * weave, _d.y + _s.y * weave, _d.z + _s.z * weave, sp, tdt, 2.5);
        faceDir(e, e.vel, tdt);
        break;
      }
      case 'mimic': {
        if (!e.revealed) {
          e.vel.multiplyScalar(1 - tdt);
          e.pos.y += Math.sin(w.time * 2 + e.id) * 0.02;
          if (dist < 24) {
            e.revealed = true;
            e.flash = 1.5;
            w.events.emit('spawn', { x: e.pos.x, y: e.pos.y, z: e.pos.z, faction: def.faction, big: false });
          }
        } else {
          steerTo(e, _d.x, _d.y, _d.z, sp * 1.3, tdt, 4);
          faceDir(e, e.vel, tdt);
        }
        break;
      }
      case 'charger': {
        if (e.state === 0) {
          // approach and circle at mid range
          _s.crossVectors(_d, _up).normalize().multiplyScalar(e.orbitDir);
          const want = dist > 45 ? 1 : dist < 30 ? -0.5 : 0;
          steerTo(e, _d.x * want + _s.x * 0.8, _d.y * want + _s.y * 0.8, _d.z * want + _s.z * 0.8, sp, tdt);
          faceDir(e, _d, tdt);
          if (e.timer <= 0 && dist < 70 && w.takeToken(e)) {
            e.state = 1;
            e.timer = 0.85;
            e.target.copy(target).addScaledVector(pl.vel, 0.35);
            w.addTelegraph({ kind: 'line', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.target.x, by: e.target.y, bz: e.target.z, radius: e.radius, dur: 0.85, owner: e.id });
          }
        } else if (e.state === 1) {
          e.vel.multiplyScalar(1 - tdt * 4);
          e.emissive = 1 - e.timer;
          _t.copy(e.target).sub(e.pos).normalize();
          faceDir(e, _t, tdt, 12);
          if (e.timer <= 0) {
            e.state = 2;
            e.timer = 0.7;
            e.aimDir.copy(_t);
            e.vel.copy(_t).multiplyScalar(sp * 5.5);
          }
        } else if (e.state === 2) {
          e.emissive = 1;
          if (e.timer <= 0) {
            e.state = 3;
            e.timer = 1.4;
            w.releaseToken(e);
          }
        } else {
          e.emissive = 0;
          e.vel.multiplyScalar(1 - tdt * 2);
          if (e.timer <= 0) {
            e.state = 0;
            e.timer = 1.5 + w.rng.next() * 2;
          }
        }
        break;
      }
      case 'sniper':
      case 'lancer': {
        const pref = e.speedMul > 2 ? 22 : def.role === 'sniper' ? 80 : 60;
        _s.crossVectors(_d, _up).normalize().multiplyScalar(e.orbitDir);
        const want = dist > pref + 15 ? 1 : dist < pref - 15 ? -1 : 0;
        const moveK = e.state === 0 ? 1 : 0.15;
        steerTo(e, (_d.x * want + _s.x * 0.6) * moveK, (_d.y * want + _s.y * 0.6) * moveK, (_d.z * want + _s.z * 0.6) * moveK, sp, tdt);
        faceDir(e, _d, tdt, 8);
        const f = def.fire!;
        if (e.state === 0) {
          if (e.timer <= 0 && dist < 150 && w.takeToken(e)) {
            e.state = 1;
            e.timer = def.role === 'lancer' ? 1.3 : 0.9;
            e.timer2 = e.timer;
            e.aimDir.copy(_d);
            w.addTelegraph({ kind: 'line', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: e.pos.x + _d.x * 160, by: e.pos.y + _d.y * 160, bz: e.pos.z + _d.z * 160, radius: def.role === 'lancer' ? 2.2 : 0.8, dur: e.timer, owner: e.id });
          }
        } else if (e.state === 1) {
          // track until last 35% of the telegraph, then lock
          if (e.timer > e.timer2 * 0.35) {
            _t.copy(target).addScaledVector(pl.vel, def.role === 'sniper' ? 0.4 : 0).sub(e.pos).normalize();
            e.aimDir.lerp(_t, Math.min(1, tdt * 6)).normalize();
          }
          e.emissive = 1 - e.timer / e.timer2;
          for (const tg of w.telegraphs)
            if (tg.owner === e.id) {
              tg.ax = e.pos.x;
              tg.ay = e.pos.y;
              tg.az = e.pos.z;
              tg.bx = e.pos.x + e.aimDir.x * 160;
              tg.by = e.pos.y + e.aimDir.y * 160;
              tg.bz = e.pos.z + e.aimDir.z * 160;
            }
          if (e.timer <= 0) {
            if (def.role === 'sniper') {
              _t.copy(e.aimDir).multiplyScalar(f.speed);
              w.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, _t.x, _t.y, _t.z, f.damage * e.dmgMul, f.kind, 1.0);
              w.events.emit('enemyShot', { x: e.pos.x, y: e.pos.y, z: e.pos.z, big: true });
              e.state = 3;
              e.timer = 0.4;
            } else {
              e.state = 2;
              e.timer = 0.45;
              w.events.emit('enemyShot', { x: e.pos.x, y: e.pos.y, z: e.pos.z, big: true });
            }
          }
        } else if (e.state === 2) {
          // lancer beam: damage while active
          const ax = e.pos.x;
          const ay = e.pos.y;
          const az = e.pos.z;
          w.beams.push({ ax, ay, az, bx: ax + e.aimDir.x * 160, by: ay + e.aimDir.y * 160, bz: az + e.aimDir.z * 160, width: 1.6, r: 1, g: 0.3, b: 0.2, enemy: true });
          const t = raySphere(ax, ay, az, e.aimDir.x, e.aimDir.y, e.aimDir.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + 1.4);
          if (t >= 0 && t < 160) w.hurtPlayerBeam(f.damage * e.dmgMul, def.name + ' beam', e);
          if (e.timer <= 0) {
            e.state = 3;
            e.timer = 0.5;
          }
        } else {
          e.emissive = 0;
          if (e.timer <= 0) {
            w.releaseToken(e);
            e.state = 0;
            e.timer = (1 / (f.rate * e.fireMul * BAL.enemyFireRate * (e.buffT > 0 ? 1.25 : 1))) * (0.7 + w.rng.next() * 0.6);
          }
        }
        break;
      }
      case 'gunner':
      case 'orbiter': {
        const pref = e.speedMul > 2 ? 20 : def.role === 'gunner' ? 48 : 38;
        _s.crossVectors(_d, _up).normalize().multiplyScalar(e.orbitDir);
        const want = dist > pref + 10 ? 1 : dist < pref - 8 ? -0.8 : 0;
        const tang = def.role === 'orbiter' ? 1.2 : 0.7;
        steerTo(e, _d.x * want + _s.x * tang, _d.y * want + _s.y * tang + Math.sin(w.time + e.id) * 0.2, _d.z * want + _s.z * tang, sp, tdt);
        faceDir(e, _d, tdt, 8);
        const f = def.fire!;
        if (e.timer <= 0.35 && e.timer > 0) e.emissive = 1 - e.timer / 0.35;
        if (e.timer <= 0 && dist < 120) {
          if (w.takeToken(e)) {
            fireAt(w, e, f.speed, f.damage, f.kind, f.count, f.spread, 0.6);
            w.releaseToken(e);
            e.emissive = 0;
            e.timer = (1 / (f.rate * e.fireMul * BAL.enemyFireRate * (e.buffT > 0 ? 1.25 : 1))) * (0.8 + w.rng.next() * 0.5);
          } else e.timer = 0.3;
        }
        break;
      }
      case 'bomber': {
        const want = dist > 55 ? 1 : dist < 35 ? -0.6 : 0.1;
        steerTo(e, _d.x * want, _d.y * want, _d.z * want, sp, tdt);
        e.spin += tdt * 0.8;
        faceDir(e, _d, tdt, 2);
        const f = def.fire!;
        if (e.state === 0 && e.timer <= 0 && dist < 110 && w.takeToken(e)) {
          e.state = 1;
          e.timer = 0.9;
          w.addTelegraph({ kind: 'sphere', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: 0, by: 0, bz: 0, radius: e.radius * 2.5, dur: 0.9, owner: e.id });
        } else if (e.state === 1) {
          e.emissive = 1 - e.timer / 0.9;
          if (e.timer <= 0) {
            ringBurst(w, e.pos.x, e.pos.y, e.pos.z, f.count, f.speed, f.damage * e.dmgMul, f.kind, e.spin);
            if (e.elite) ringBurst(w, e.pos.x, e.pos.y, e.pos.z, f.count, f.speed * 0.8, f.damage * e.dmgMul, f.kind, e.spin + 0.3);
            w.releaseToken(e);
            e.state = 0;
            e.emissive = 0;
            e.timer = 1 / (f.rate * e.fireMul * BAL.enemyFireRate * (e.buffT > 0 ? 1.25 : 1));
          }
        }
        break;
      }
      case 'turret': {
        e.vel.set(0, 0, 0);
        e.spin += tdt * 0.6;
        faceDir(e, _d, tdt, 3);
        const f = def.fire!;
        if (e.timer < 0.5 && e.timer > 0) e.emissive = 1 - e.timer / 0.5;
        if (e.timer <= 0 && dist < 130) {
          _o.set(Math.sin(e.spin), 1, Math.cos(e.spin)).normalize();
          ringBurst(w, e.pos.x, e.pos.y, e.pos.z, f.count, f.speed, f.damage * e.dmgMul, f.kind, e.spin * 2, _o.clone().cross(_d).normalize());
          fireAt(w, e, f.speed * 1.5, f.damage * e.dmgMul, 1, 1, 0, 0.7);
          e.emissive = 0;
          e.timer = 1 / (f.rate * e.fireMul * BAL.enemyFireRate * (e.buffT > 0 ? 1.25 : 1));
        }
        break;
      }
      case 'shielder': {
        // drift toward allies' centroid, keep mid range from player
        let cx = 0;
        let cy = 0;
        let cz = 0;
        let n = 0;
        w.forEnemiesNear(e.pos.x, e.pos.y, e.pos.z, 30, (o) => {
          if (o === e || o.def.role === 'inert') return;
          cx += o.pos.x;
          cy += o.pos.y;
          cz += o.pos.z;
          n++;
          o.shieldedBy = 0.5;
        });
        if (n > 0) {
          _t.set(cx / n, cy / n, cz / n).sub(e.pos);
          const l = _t.length() || 1;
          _t.multiplyScalar(1 / l);
          steerTo(e, _t.x * 0.6 + _d.x * 0.3, _t.y * 0.6 + _d.y * 0.3, _t.z * 0.6 + _d.z * 0.3, sp, tdt);
        } else steerTo(e, _d.x, _d.y, _d.z, sp, tdt);
        faceDir(e, _d, tdt, 3);
        e.emissive = 0.5 + 0.5 * Math.sin(w.time * 4);
        break;
      }
      case 'healer': {
        let best: Enemy | null = null;
        let bestR = 1;
        w.forEnemiesNear(e.pos.x, e.pos.y, e.pos.z, 45, (o) => {
          if (o === e || o.def.role === 'inert' || o.def.role === 'boss') return;
          const r = o.hp / o.maxHp;
          if (r < bestR) {
            bestR = r;
            best = o;
          }
        });
        const flee = dist < 30 ? -1 : 0;
        if (best) {
          const b = best as Enemy;
          _t.copy(b.pos).sub(e.pos);
          const l = _t.length() || 1;
          _t.multiplyScalar(1 / l);
          steerTo(e, _t.x * (l > 10 ? 1 : 0) + _d.x * flee, _t.y * (l > 10 ? 1 : 0) + _d.y * flee, _t.z * (l > 10 ? 1 : 0) + _d.z * flee, sp, tdt);
          if (l < 20) {
            b.hp = Math.min(b.maxHp, b.hp + 10 * tdt);
            e.emissive = 1;
            if (Math.floor(w.time * 10) % 3 === 0)
              w.arcs.push({ ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: b.pos.x, by: b.pos.y, bz: b.pos.z, t: 0.1, color: 2, seed: e.id });
          }
        } else steerTo(e, _d.x * (dist > 50 ? 1 : flee), _d.y * (dist > 50 ? 1 : flee), _d.z * (dist > 50 ? 1 : flee), sp, tdt);
        faceDir(e, _d, tdt, 3);
        break;
      }
      case 'carrier': {
        const want = dist > 70 ? 1 : dist < 50 ? -0.5 : 0;
        _s.crossVectors(_d, _up).normalize().multiplyScalar(e.orbitDir * 0.4);
        steerTo(e, _d.x * want + _s.x, _d.y * want + _s.y, _d.z * want + _s.z, sp, tdt);
        faceDir(e, _d, tdt, 1.5);
        if (e.timer < 0.6 && e.timer > 0) e.emissive = 1 - e.timer / 0.6;
        if (e.timer <= 0) {
          const child = def.faction === 'salvage' ? 'scrapper' : def.faction === 'choir' ? 'shardling' : 'moteeater';
          if (w.liveEnemyCount() < 260) {
            for (let i = 0; i < 3; i++) {
              const c = w.spawnEnemy(child, e.pos.x + w.rng.range(-3, 3), e.pos.y + w.rng.range(-3, 3), e.pos.z + w.rng.range(-3, 3));
              c.spawnT = 0.2;
              c.vel.copy(_d).multiplyScalar(30).add(_t.set(w.rng.range(-15, 15), w.rng.range(-15, 15), w.rng.range(-15, 15)));
            }
          }
          e.emissive = 0;
          e.timer = 4.5;
        }
        break;
      }
      case 'minelayer': {
        _s.crossVectors(_d, _up).normalize().multiplyScalar(e.orbitDir);
        const want = dist > 60 ? 1 : dist < 35 ? -0.5 : 0;
        steerTo(e, _d.x * want + _s.x, _d.y * want + _s.y, _d.z * want + _s.z, sp, tdt);
        faceDir(e, e.vel, tdt, 4);
        if (e.timer <= 0) {
          w.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, 16 * e.dmgMul, 4, 1.2, 12);
          e.timer = 1.8;
        }
        break;
      }
      case 'splitter': {
        steerTo(e, _d.x, _d.y, _d.z, sp, tdt, 1.5);
        faceDir(e, _d, tdt, 2);
        break;
      }
      case 'inert': {
        e.vel.multiplyScalar(1 - tdt * 0.4);
        e.spin += tdt * 0.2;
        break;
      }
    }

    if (e.subtype >= 0 && e.revealed && !inStasis) updateMoves(w, e, tdt, dist, SUBTYPES[def.id]![e.subtype]!.moves);
    updateAffixAI(w, e, tdt, dist);

    // separation (cheap): only against a few neighbors
    if (def.role !== 'inert' && def.role !== 'turret') {
      let px = 0;
      let py = 0;
      let pz = 0;
      w.forEnemiesNear(e.pos.x, e.pos.y, e.pos.z, e.radius + 1, (o) => {
        if (o === e) return;
        const dx = e.pos.x - o.pos.x;
        const dy = e.pos.y - o.pos.y;
        const dz = e.pos.z - o.pos.z;
        const l = Math.hypot(dx, dy, dz) || 0.01;
        const push = (e.radius + o.radius - l) / l;
        if (push > 0) {
          px += dx * push;
          py += dy * push;
          pz += dz * push;
        }
      });
      e.vel.x += px * 8 * dt;
      e.vel.y += py * 8 * dt;
      e.vel.z += pz * 8 * dt;
    }

    // keep in arena
    const R = w.arenaRadius + 30;
    const pd = e.pos.length();
    if (pd > R) e.vel.addScaledVector(e.pos, (-(pd - R) / pd) * 4 * dt * 10);

    e.pos.addScaledVector(e.vel, dt * (inStasis ? 0.25 : 1));

    // contact with player
    if (pl.alive && def.role !== 'inert' && e.revealed) {
      const rr = e.radius + pl.radius;
      const dx = pl.pos.x - e.pos.x;
      const dy = pl.pos.y - e.pos.y;
      const dz = pl.pos.z - e.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) {
        if (ramBoost) {
          w.damageEnemy(e, 60 * w.build.ship.globalDamage, w.triggerSrc, e.pos.x, e.pos.y, e.pos.z, dx, dy, dz, { kinetic: true, knock: 40 });
        } else if (pl.iframeT <= 0) {
          w.hurtPlayer(def.contact * e.dmgMul, def.name, e);
          const l = Math.sqrt(d2) || 1;
          e.vel.x -= (dx / l) * 30;
          e.vel.y -= (dy / l) * 30;
          e.vel.z -= (dz / l) * 30;
          if (def.role === 'swarmer' || def.role === 'mimic') w.damageEnemy(e, 999, w.triggerSrc, e.pos.x, e.pos.y, e.pos.z, 0, 1, 0, { noTrigger: true });
        }
      }
      if ((burnAura || wake) && d2 < 64 && w.rng.next() < 0.1) w.applyStatus(e, 'burn', 1);
    } else if (def.role === 'inert' && pl.alive) {
      // asteroid bounce
      const rr = e.radius * 1 + pl.radius;
      const dx = pl.pos.x - e.pos.x;
      const dy = pl.pos.y - e.pos.y;
      const dz = pl.pos.z - e.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) {
        const l = Math.sqrt(d2) || 1;
        const vn = (pl.vel.x * dx + pl.vel.y * dy + pl.vel.z * dz) / l;
        if (vn < 0) pl.vel.addScaledVector(_t.set(dx / l, dy / l, dz / l), -vn * 1.6);
        pl.pos.set(e.pos.x + (dx / l) * rr, e.pos.y + (dy / l) * rr, e.pos.z + (dz / l) * rr);
        if (vn < -40) w.hurtPlayer(6, 'Asteroid');
      }
    }
  }
  w.player = w.p1;
}
