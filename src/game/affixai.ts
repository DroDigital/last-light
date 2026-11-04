import type { World } from './world';
import type { Enemy } from './entities';
import { ringBurst } from './ai';

/**
 * Behaviour affixes that act every tick (stat affixes are applied on spawn,
 * hit/kill affixes live in World). Each one telegraphs before it hurts.
 */
export function updateAffixAI(w: World, e: Enemy, dt: number, dist: number): void {
  if (!e.affixMask) return;
  const pl = w.player;
  e.affT -= dt;
  e.affT2 -= dt;

  if (e.has('cloaked')) e.cloak = e.state === 1 || e.state === 2 || e.emissive > 0.5 ? 0 : 0.85;

  if (e.has('frostbound') && dist < 18) {
    pl.slowT = Math.max(pl.slowT, 0.3);
    if (w.rng.next() < dt * 4) w.events.emit('status', { kind: 'cryo', x: pl.pos.x, y: pl.pos.y, z: pl.pos.z });
  }

  if (e.has('molten') && e.affT2 <= 0) {
    e.affT2 = 0.8;
    w.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, 10 * e.dmgMul, 4, 0.9, 5);
  }

  if (e.has('enraged') && !e.enragedOn && e.hp < e.maxHp * 0.35) {
    e.enragedOn = true;
    e.speedMul *= 2;
    e.fireMul *= 2;
    e.flash = 1.5;
    w.events.emit('reaction', { id: 'r_melt', x: e.pos.x, y: e.pos.y, z: e.pos.z });
  }
  if (e.enragedOn) e.emissive = Math.max(e.emissive, 0.6 + Math.sin(w.time * 20) * 0.3);

  if (e.has('empowering') || e.has('warden')) {
    if (Math.floor(w.time * 4) !== Math.floor((w.time - dt) * 4)) {
      const emp = e.has('empowering');
      const war = e.has('warden');
      w.forEnemiesNear(e.pos.x, e.pos.y, e.pos.z, 26, (o) => {
        if (o === e || o.def.role === 'inert') return;
        if (emp) o.buffT = 0.6;
        if (war) o.shieldedBy = 0.6;
      });
    }
  }

  if (e.has('phasing')) {
    // 1 s out of phase in every 4: flickering and untouchable
    const ph = (w.time + e.id * 0.37) % 4;
    const out = ph > 3;
    e.invuln = out;
    if (out) e.cloak = Math.floor(w.time * 18) & 1 ? 0.7 : 0.2;
    else if (!e.has('cloaked')) e.cloak = 0;
  }

  // one periodic signature move per enemy, on affT
  if (e.affT > 0) return;
  if (e.has('summoner') && w.liveEnemyCount() < 200) {
    e.affT = 6.5;
    const child = e.def.faction === 'salvage' ? 'scrapper' : e.def.faction === 'choir' ? 'shardling' : 'moteeater';
    for (let i = 0; i < 2; i++) {
      const c = w.spawnEnemy(child, e.pos.x + w.rng.range(-4, 4), e.pos.y + w.rng.range(-4, 4), e.pos.z + w.rng.range(-4, 4));
      c.spawnT = 0.3;
    }
    e.emissive = 1;
    return;
  }
  if (e.has('warping') && dist < 70) {
    e.affT = 4 + w.rng.next() * 2;
    w.events.emit('explosion', { x: e.pos.x, y: e.pos.y, z: e.pos.z, radius: 3, r: 0.6, g: 0.5, b: 1, enemy: false });
    const a = w.rng.next() * Math.PI * 2;
    const r = 35 + w.rng.next() * 20;
    e.pos.set(pl.pos.x + Math.cos(a) * r, pl.pos.y + w.rng.range(-10, 10), pl.pos.z + Math.sin(a) * r);
    e.prev.copy(e.pos);
    e.vel.set(0, 0, 0);
    w.events.emit('spawn', { x: e.pos.x, y: e.pos.y, z: e.pos.z, faction: e.def.faction, big: false });
    return;
  }
  if (e.has('unstable') && dist < 90) {
    // telegraph, then nova
    if (!e.affArm) {
      e.affT = 0.9;
      e.affArm = true;
      w.addTelegraph({ kind: 'sphere', ax: e.pos.x, ay: e.pos.y, az: e.pos.z, bx: 0, by: 0, bz: 0, radius: 13, dur: 0.9, owner: e.id });
      return;
    }
    e.affArm = false;
    e.affT = 5.5;
    ringBurst(w, e.pos.x, e.pos.y, e.pos.z, 16, 30, 9 * e.dmgMul, 1, w.time);
    if (dist < 13) w.hurtPlayer(14 * e.dmgMul, `${e.def.name} nova`, e);
    w.events.emit('explosion', { x: e.pos.x, y: e.pos.y, z: e.pos.z, radius: 13, r: 1, g: 0.4, b: 0.6, enemy: true });
    return;
  }
  if (e.has('barrage') && dist < 110) {
    e.affT = 5 + w.rng.next() * 2;
    ringBurst(w, e.pos.x, e.pos.y, e.pos.z, 12, 26, 8 * e.dmgMul, 2, w.time);
    return;
  }
  e.affT = 3;
}
