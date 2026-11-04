import { Quaternion, Vector3 } from 'three';
import type { World } from './world';
import { raySphere } from './world';
import { Enemy } from './entities';
import type { EnemyDef } from './types';
import { BOSSES, type BossDef } from '../data/world';
import { fireAt, ringBurst, faceDir } from './ai';
import type { MeshKind } from '../render/meshes';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const UP = new Vector3(0, 1, 0);
const AX_Z = new Vector3(0, 0, 1);
const _d = new Vector3();

type Pattern = 'volley' | 'ring' | 'spiral' | 'sweep' | 'charge' | 'summon' | 'mines' | 'homing' | 'pull' | 'wall' | 'beams';

interface BossBeam {
  dir: Vector3;
  rate: number;
  len: number;
  width: number;
  on: boolean;
  warm: number;
}

function bossDef(id: string, name: string, role: 'boss' | 'part', mesh: MeshKind, hp: number, radius: number, scale: number, accent: string): EnemyDef {
  return { id, name, faction: 'none', role, mesh, scale, hp, speed: 0, radius, contact: 20, accent, light: role === 'boss' ? 120 : 10, threat: 0, desc: '' };
}

export class BossController {
  def: BossDef;
  core!: Enemy;
  parts: Enemy[] = [];
  phase = 0;
  phaseT = 0;
  invulnT = 0;
  patternT = 2.5;
  patternIdx = 0;
  active: Pattern | null = null;
  activeT = 0;
  spiralPhase = 0;
  dying = 0;
  dead = false;
  beams: BossBeam[] = [];
  /** 0..1 palette drain requested by the Last Dark */
  hush = 0;
  trail: Vector3[] = [];
  orbitA = 0;
  intro = 3;
  pulseT = 0;
  bpm = 120;
  private chargeDir = new Vector3();
  private sweepAxis = new Vector3();
  private spin = 0;
  totalMaxHp = 1;

  constructor(public id: string, w: World, hpScale: number, bpm: number) {
    this.def = BOSSES[id]!;
    this.bpm = bpm;
    this.setup(w, hpScale);
  }

  get name(): string {
    return this.def.name;
  }

  hpFrac(): number {
    if (this.dead) return 0;
    let hp = Math.max(0, this.core.hp);
    let max = this.core.maxHp;
    for (const p of this.parts) {
      max += p.maxHp * 0.5;
      if (p.alive) hp += p.hp * 0.5;
    }
    return hp / max;
  }

  private setup(w: World, hpScale: number): void {
    const hp = this.def.hp * hpScale;
    const start = _a.copy(w.player.pos).normalize().multiplyScalar(-90);
    if (start.lengthSq() < 1) start.set(0, 10, -90);
    const coreDef = (mesh: MeshKind, radius: number, scale: number, accent: string) => bossDef(this.id, this.def.name, 'boss', mesh, hp, radius, scale, accent);
    const part = (mesh: MeshKind, php: number, radius: number, scale: number, accent: string, off: Vector3, idx: number) => {
      const p = w.spawnEnemy(bossDef(this.id + '_part', this.def.name, 'part', mesh, php * hpScale, radius, scale, accent), start.x + off.x, start.y + off.y, start.z + off.z);
      p.offset.copy(off);
      p.parent = this.core;
      p.partIndex = idx;
      p.spawnT = 0;
      this.parts.push(p);
      return p;
    };
    switch (this.id) {
      case 'foreman': {
        this.core = w.spawnEnemy(coreDef('bossCore', 6.5, 2.4, '#ffb040'), start.x, start.y, start.z);
        this.core.dmgTaken = 0.3;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          part('salvRam', 320, 2.6, 2.4, '#ff8030', new Vector3(Math.cos(a) * 11, Math.sin(a) * 11, 0), i);
        }
        part('salvTurret', 260, 2.6, 2, '#ffa040', new Vector3(0, 8, 4), 4);
        part('salvTurret', 260, 2.6, 2, '#ffa040', new Vector3(0, -8, 4), 5);
        break;
      }
      case 'leviathan': {
        this.core = w.spawnEnemy(coreDef('hushDart', 5, 4.5, '#ff7030'), start.x, start.y, start.z);
        this.core.dmgTaken = 0.25;
        for (let i = 0; i < 14; i++) part('segment', 140, 3.2, 1.6 - i * 0.04, '#ff6020', new Vector3(0, 0, (i + 1) * 5.5), i);
        for (let i = 0; i < 60; i++) this.trail.push(new Vector3(start.x, start.y, start.z + i * 1.5));
        break;
      }
      case 'glasschoir': {
        this.core = w.spawnEnemy(coreDef('choirPrism', 7, 4.5, '#ff90e0'), start.x, start.y, start.z);
        this.core.invuln = true;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          part('choirShard', 380, 3, 3.2, '#ffb0f0', new Vector3(Math.cos(a) * 18, 0, Math.sin(a) * 18), i);
        }
        break;
      }
      case 'pulsarheart': {
        this.core = w.spawnEnemy(coreDef('hushEye', 6.5, 5, '#d080ff'), start.x, start.y, start.z);
        this.core.dmgTaken = 1;
        for (let i = 0; i < 2; i++) part('choirHalo', 500, 3.5, 2.2, '#c0a0ff', new Vector3(i ? -14 : 14, 0, 0), i);
        this.beams.push({ dir: new Vector3(1, 0, 0), rate: 0.5, len: 220, width: 2.4, on: false, warm: 0 });
        this.beams.push({ dir: new Vector3(-1, 0, 0), rate: 0.5, len: 220, width: 2.4, on: false, warm: 0 });
        break;
      }
      default: {
        // lastdark
        this.core = w.spawnEnemy(coreDef('hushBlob', 8, 5.5, '#b060ff'), start.x, start.y, start.z);
        this.core.dmgTaken = 0.4;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          part('hushEye', 420, 3, 2.2, '#e070ff', new Vector3(Math.cos(a) * 16, Math.sin(a) * 6, Math.sin(a) * 16), i);
        }
      }
    }
    this.core.isBossCore = true;
    this.core.spawnT = 0;
    this.core.bossKey = this.id;
    this.totalMaxHp = this.core.maxHp;
  }

  private patternsFor(): Pattern[] {
    const p = this.phase;
    switch (this.id) {
      case 'foreman':
        return [['volley', 'summon', 'ring', 'volley'], ['sweep', 'ring', 'volley', 'summon'], ['charge', 'spiral', 'charge', 'ring']][p]! as Pattern[];
      case 'leviathan':
        return [['volley', 'ring', 'volley', 'summon'], ['charge', 'volley', 'charge', 'ring'], ['spiral', 'charge', 'homing', 'summon']][p]! as Pattern[];
      case 'glasschoir':
        return [['sweep', 'volley', 'sweep', 'ring'], ['homing', 'ring', 'sweep', 'summon'], ['spiral', 'homing', 'wall', 'sweep']][p]! as Pattern[];
      case 'pulsarheart':
        return [['beams', 'volley', 'beams', 'summon'], ['beams', 'homing', 'beams', 'wall'], ['beams', 'spiral', 'beams', 'homing']][p]! as Pattern[];
      default:
        return [['summon', 'pull', 'ring', 'volley'], ['wall', 'homing', 'pull', 'summon'], ['spiral', 'homing', 'wall', 'charge']][p]! as Pattern[];
    }
  }

  onPartKilled(w: World, e: Enemy): void {
    if (e === this.core) {
      if (!this.dead && this.dying <= 0) {
        // keep the core around for the multi-stage death
        e.alive = true;
        e.hp = 1;
        e.invuln = true;
        this.dying = 3.2;
        w.events.emit('bossPhase', { phase: 99 });
        w.eproj.clear();
        w.telegraphs.length = 0;
        for (const b of this.beams) b.on = false;
      }
      return;
    }
    const idx = this.parts.indexOf(e);
    if (idx < 0 || e.parent !== this.core) return;
    // Enemies are pooled: detach the dead part so a recycled object (e.g. a
    // summoned minion) is never mistaken for a piece of the boss.
    const ghost = new Enemy();
    ghost.def = e.def;
    ghost.partIndex = e.partIndex;
    ghost.pos.copy(e.pos);
    ghost.prev.copy(e.pos);
    ghost.maxHp = e.maxHp;
    ghost.alive = false;
    this.parts[idx] = ghost;
    const alive = this.parts.filter((p) => p.alive).length;
    const total = this.parts.length;
    switch (this.id) {
      case 'foreman':
        if (e.partIndex < 4) this.core.dmgTaken = 0.3 + 0.7 * (1 - this.parts.slice(0, 4).filter((p) => p.alive).length / 4);
        break;
      case 'leviathan':
        this.core.dmgTaken = 0.25 + 0.75 * (1 - alive / total);
        break;
      case 'glasschoir':
        if (alive <= 3) this.core.invuln = false;
        break;
      case 'pulsarheart':
        this.beams[e.partIndex]!.on = false;
        break;
    }
    w.explode(e.pos.x, e.pos.y, e.pos.z, 10, 0, -1, { color: [1, 0.7, 0.4] });
  }

  update(w: World, dt: number): void {
    const core = this.core;
    if (this.dead) return;
    if (this.dying > 0) {
      this.dying -= dt;
      core.vel.multiplyScalar(0.95);
      core.prev.copy(core.pos);
      core.prevQuat.copy(core.quat);
      this.spin += dt * (3 - this.dying);
      // staged explosions
      if (w.rng.next() < dt * 10) {
        const src = w.rng.chance(0.5) && this.parts.length ? this.parts[w.rng.int(0, this.parts.length - 1)]! : core;
        _a.set(w.rng.range(-1, 1), w.rng.range(-1, 1), w.rng.range(-1, 1)).multiplyScalar(core.radius * 1.5).add(src.pos);
        w.explode(_a.x, _a.y, _a.z, 8 + w.rng.next() * 8, 0, -1, { color: [1, 0.8, 0.5] });
        core.flash = 1;
      }
      for (const p of this.parts) if (p.alive && w.rng.next() < dt * 1.5) w.killEnemy(p, 999);
      this.positionParts(w, dt);
      if (this.dying <= 0) {
        this.dead = true;
        core.invuln = false;
        for (const p of this.parts) if (p.alive) w.killEnemy(p, 999);
        core.hp = 0;
        core.alive = true;
        w.killEnemy(core, 9999);
        w.stats.bossKills++;
        w.events.emit('bossDeath', { x: core.pos.x, y: core.pos.y, z: core.pos.z });
        w.dropMotes(core.pos.x, core.pos.y, core.pos.z, 150, 10);
      }
      return;
    }
    core.prev.copy(core.pos);
    core.prevQuat.copy(core.quat);
    const pl = w.player;
    if (this.intro > 0) this.intro -= dt;
    // phase transitions
    const frac = core.hp / core.maxHp;
    const want = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0;
    if (want > this.phase) {
      this.phase = want;
      this.patternIdx = 0;
      this.invulnT = 1.6;
      this.active = null;
      this.patternT = 1.8;
      w.events.emit('bossPhase', { phase: this.phase });
      w.eproj.clear();
      w.telegraphs.length = 0;
      ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 18, 30, 8, 1, 0, _c.set(0, 1, 0));
      if (this.id === 'lastdark') this.hush = this.phase === 1 ? 0.85 : 0.35;
      if (this.id === 'pulsarheart' && this.phase === 2) {
        this.beams.push({ dir: new Vector3(0, 0, 1), rate: -0.6, len: 220, width: 2.2, on: false, warm: 0 });
        this.beams.push({ dir: new Vector3(0, 0, -1), rate: -0.6, len: 220, width: 2.2, on: false, warm: 0 });
      }
      if (this.id === 'foreman' && this.phase >= 1) this.core.dmgTaken = Math.max(this.core.dmgTaken, 0.7);
    }
    if (this.invulnT > 0) {
      this.invulnT -= dt;
      core.flash = Math.max(core.flash, 0.3);
    }

    // movement
    _a.copy(pl.pos).sub(core.pos);
    const dist = _a.length() || 1;
    _a.multiplyScalar(1 / dist);
    const speedMul = 1 + this.phase * 0.25;
    if (this.active !== 'charge') {
      if (this.id === 'leviathan') {
        this.orbitA += dt * (0.35 + this.phase * 0.12);
        const r = 85;
        _b.set(Math.cos(this.orbitA) * r, Math.sin(this.orbitA * 1.7) * 25, Math.sin(this.orbitA) * r);
        _c.copy(_b).sub(core.pos);
        core.vel.lerp(_c.multiplyScalar(1.4), Math.min(1, dt * 2));
      } else {
        // hover at preferred range, slow orbit
        const pref = this.id === 'pulsarheart' ? 70 : 55;
        const radial = dist > pref + 15 ? 1 : dist < pref - 10 ? -1 : 0;
        _b.crossVectors(_a, UP).normalize();
        _c.copy(_a).multiplyScalar(radial * 14 * speedMul).addScaledVector(_b, 6 * speedMul);
        core.vel.lerp(_c, Math.min(1, dt * 1.5));
      }
    }
    core.pos.addScaledVector(core.vel, dt);
    const R = w.arenaRadius * 0.8;
    if (core.pos.length() > R) core.pos.multiplyScalar(R / core.pos.length());
    if (this.id === 'leviathan') faceDir(core, core.vel, dt, 4);
    else faceDir(core, _a, dt, 2);
    this.spin += dt * (this.id === 'foreman' ? 0.6 + this.phase * 0.9 : 0.5);

    this.positionParts(w, dt);
    this.updateBeams(w, dt);

    // contact damage from core + parts
    const pr = pl.radius;
    const check = (e: Enemy) => {
      if (!e.alive) return;
      const rr = e.radius + pr;
      if (e.pos.distanceToSquared(pl.pos) < rr * rr) {
        w.hurtPlayer(18 * e.dmgMul, this.def.name, e);
        _b.copy(pl.pos).sub(e.pos).normalize();
        pl.vel.addScaledVector(_b, 50);
      }
    };
    check(core);
    for (const p of this.parts) check(p);

    // pulsar heartbeat synced to the sector tempo
    if (this.id === 'pulsarheart') {
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        this.pulseT = (60 / this.bpm) * (this.phase >= 2 ? 2 : 4);
        if (this.intro <= 0 && this.invulnT <= 0) ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 14 + this.phase * 4, 26, 8, 1, this.spin, _c.set(0, 1, 0));
        core.emissive = 1;
      }
      core.emissive *= 0.92;
    }

    if (this.intro > 0 || this.invulnT > 0) return;
    this.runPatterns(w, dt, dist);
  }

  private positionParts(w: World, dt: number): void {
    const core = this.core;
    if (this.id === 'leviathan') {
      // segments follow the head's trail
      const last = this.trail[0]!;
      if (last.distanceToSquared(core.pos) > 1.5) {
        const v = this.trail.pop()!;
        v.copy(core.pos);
        this.trail.unshift(v);
      }
      for (const p of this.parts) {
        p.prev.copy(p.pos);
        p.prevQuat.copy(p.quat);
        const idx = Math.min(this.trail.length - 1, (p.partIndex + 1) * 4);
        p.pos.lerp(this.trail[idx]!, Math.min(1, dt * 12));
        const ahead = this.trail[Math.max(0, idx - 2)]!;
        _a.copy(ahead).sub(p.pos);
        faceDir(p, _a.negate(), dt, 8);
      }
      return;
    }
    _q.setFromAxisAngle(UP, this.spin);
    for (const p of this.parts) {
      p.prev.copy(p.pos);
      p.prevQuat.copy(p.quat);
      if (!p.alive) continue;
      _a.copy(p.offset);
      if (this.id === 'foreman' && p.partIndex < 4) {
        _a.applyAxisAngle(AX_Z, this.spin * 2);
        _a.applyQuaternion(core.quat);
      } else if (this.id === 'glasschoir' || this.id === 'lastdark') {
        _a.applyQuaternion(_q);
        _a.y += Math.sin(w.time * 1.5 + p.partIndex) * 3;
      } else if (this.id === 'pulsarheart') {
        // emitters ride the beam directions
        const b = this.beams[p.partIndex];
        if (b) _a.copy(b.dir).multiplyScalar(14);
      } else _a.applyQuaternion(core.quat);
      p.pos.copy(core.pos).add(_a);
      _b.copy(w.player.pos).sub(p.pos);
      faceDir(p, _b, dt, 4);
    }
  }

  private updateBeams(w: World, dt: number): void {
    const core = this.core;
    const pl = w.player;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i]!;
      const emitterAlive = i >= 2 || this.parts[i]?.alive;
      // rotate around a tilted axis so beams sweep through the player's space
      _c.set(0.3, 1, 0.2).normalize();
      b.dir.applyAxisAngle(_c, b.rate * dt * (1 + this.phase * 0.3) * (this.active === 'beams' ? 1.4 : 0.6)).normalize();
      if (!b.on || !emitterAlive) continue;
      if (b.warm < 1) {
        b.warm += dt * 0.8;
        w.telegraphs.push({ kind: 'line', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: core.pos.x + b.dir.x * b.len, by: core.pos.y + b.dir.y * b.len, bz: core.pos.z + b.dir.z * b.len, radius: b.width, t: 0.98, dur: 1, owner: core.id });
        continue;
      }
      w.beams.push({ ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: core.pos.x + b.dir.x * b.len, by: core.pos.y + b.dir.y * b.len, bz: core.pos.z + b.dir.z * b.len, width: b.width, r: 1, g: 0.35, b: 0.3, enemy: true });
      const t = raySphere(core.pos.x, core.pos.y, core.pos.z, b.dir.x, b.dir.y, b.dir.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + b.width * 0.5);
      if (t >= 0 && t < b.len) w.hurtPlayerBeam(16, this.def.name + ' beam', core);
    }
  }

  private runPatterns(w: World, dt: number, dist: number): void {
    const core = this.core;
    const pl = w.player;
    const heatSpd = w.heat >= 6 ? 1.2 : 1;
    if (!this.active) {
      this.patternT -= dt * heatSpd;
      if (this.patternT > 0) return;
      const list = this.patternsFor();
      this.active = list[this.patternIdx % list.length]!;
      this.patternIdx++;
      this.activeT = 0;
      this.startPattern(w);
      return;
    }
    this.activeT += dt * heatSpd;
    const t = this.activeT;
    const ph = this.phase;
    switch (this.active) {
      case 'volley': {
        if (t > 0.6) {
          const shooters = this.parts.filter((p) => p.alive);
          const srcs = shooters.length ? shooters : [core];
          for (const s of srcs) fireAt(w, s, 70 + ph * 10, 10, 2, 3 + ph, 0.08, 0.7, 0.9);
          if (!shooters.length || this.id === 'leviathan') fireAt(w, core, 60, 12, 1, 5 + ph * 2, 0.2, 0.5, 1.1);
          this.end(2.2 - ph * 0.3);
        }
        break;
      }
      case 'ring': {
        if (t > 0.9) {
          const n = 22 + ph * 6;
          ringBurst(w, core.pos.x, core.pos.y, core.pos.z, n, 28 + ph * 4, 10, 1, this.spin);
          _c.copy(pl.pos).sub(core.pos).normalize();
          ringBurst(w, core.pos.x, core.pos.y, core.pos.z, n, 24, 10, 2, this.spin + 0.2, _c.clone().cross(UP).normalize());
          this.end(2 - ph * 0.3);
        }
        break;
      }
      case 'spiral': {
        if (t > 0.8) {
          this.spiralPhase += dt * 5;
          if (Math.floor(t * 20) !== Math.floor((t - dt) * 20)) {
            for (let k = 0; k < 3; k++) {
              const a = this.spiralPhase + (k * Math.PI * 2) / 3;
              _b.set(Math.cos(a), Math.sin(a * 0.3) * 0.4, Math.sin(a)).normalize().multiplyScalar(30 + ph * 4);
              w.spawnEnemyShot(core.pos.x, core.pos.y, core.pos.z, _b.x, _b.y, _b.z, 9, k % 2 ? 1 : 2, 0.8);
            }
          }
          if (t > 4) this.end(1.6);
        }
        break;
      }
      case 'sweep': {
        if (t < 1.2) {
          // telegraph the sweep arc
          for (let k = -2; k <= 2; k++) {
            _b.copy(pl.pos).sub(core.pos).normalize().applyAxisAngle(this.sweepAxis, k * 0.35);
            if (Math.floor(t * 30) % 2 === 0)
              w.telegraphs.push({ kind: 'line', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: core.pos.x + _b.x * 180, by: core.pos.y + _b.y * 180, bz: core.pos.z + _b.z * 180, radius: 1.5, t: 0.95, dur: 1, owner: core.id });
          }
        } else if (t < 3.4) {
          const k = (t - 1.2) / 2.2;
          const ang = (k - 0.5) * 1.6;
          _b.copy(this.chargeDir).applyAxisAngle(this.sweepAxis, ang);
          const srcs = this.id === 'glasschoir' ? this.parts.filter((p) => p.alive).slice(0, 3) : [core];
          for (const s of srcs.length ? srcs : [core]) {
            _c.copy(_b);
            if (s !== core) _c.copy(pl.pos).sub(s.pos).normalize().applyAxisAngle(this.sweepAxis, ang * 0.6);
            w.beams.push({ ax: s.pos.x, ay: s.pos.y, az: s.pos.z, bx: s.pos.x + _c.x * 180, by: s.pos.y + _c.y * 180, bz: s.pos.z + _c.z * 180, width: 2, r: 1, g: 0.35, b: 0.3, enemy: true });
            const tt = raySphere(s.pos.x, s.pos.y, s.pos.z, _c.x, _c.y, _c.z, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + 1);
            if (tt >= 0 && tt < 180) w.hurtPlayerBeam(15, this.def.name + ' beam', s);
          }
        } else this.end(1.4);
        break;
      }
      case 'charge': {
        if (t < 1.0) {
          core.vel.multiplyScalar(0.9);
          core.emissive = t;
        } else if (t < 2.0) {
          core.vel.copy(this.chargeDir).multiplyScalar(140 + ph * 20);
          if (this.id === 'leviathan' && Math.floor(t * 12) !== Math.floor((t - dt) * 12)) {
            for (const p of this.parts) if (p.alive && w.rng.chance(0.3)) w.spawnEnemyShot(p.pos.x, p.pos.y, p.pos.z, w.rng.range(-8, 8), w.rng.range(-8, 8), w.rng.range(-8, 8), 10, 1, 0.9, 5);
          }
        } else {
          core.vel.multiplyScalar(0.85);
          core.emissive = 0;
          if (t > 2.4) this.end(1.2);
        }
        break;
      }
      case 'summon': {
        if (t > 0.8) {
          const pool = this.id === 'foreman' ? 'scrapper' : this.id === 'leviathan' ? 'gloom' : this.id === 'glasschoir' ? 'shardling' : this.id === 'pulsarheart' ? 'seraph' : 'moteeater';
          const n = (pool === 'seraph' || pool === 'gloom' ? 3 : 8) + ph * 2;
          if (w.liveEnemyCount() < 60) {
            for (let i = 0; i < n; i++) {
              _b.set(w.rng.range(-1, 1), w.rng.range(-1, 1), w.rng.range(-1, 1)).normalize().multiplyScalar(core.radius + 4);
              const e = w.spawnEnemy(pool, core.pos.x + _b.x, core.pos.y + _b.y, core.pos.z + _b.z);
              e.vel.copy(_b).multiplyScalar(6);
              e.spawnT = 0.3;
            }
          }
          this.end(2.5);
        }
        break;
      }
      case 'homing': {
        if (t > 0.7) {
          for (let i = 0; i < 6 + ph * 2; i++) {
            _b.set(w.rng.range(-1, 1), w.rng.range(-1, 1), w.rng.range(-1, 1)).normalize().multiplyScalar(22);
            const k = w.spawnEnemyShot(core.pos.x, core.pos.y, core.pos.z, _b.x, _b.y, _b.z, 12, 1, 1.4, 7);
            if (k >= 0) w.eproj.homing[k] = 1.1;
          }
          w.events.emit('enemyShot', { x: core.pos.x, y: core.pos.y, z: core.pos.z, big: true });
          this.end(2.2);
        }
        break;
      }
      case 'pull': {
        if (t > 0.8 && t < 3) {
          _b.copy(core.pos).sub(pl.pos);
          const l = _b.length() || 1;
          pl.vel.addScaledVector(_b, (dt * 28) / l * Math.min(1, 80 / l));
          if (Math.floor(t * 8) !== Math.floor((t - dt) * 8)) ringBurst(w, core.pos.x, core.pos.y, core.pos.z, 10, 20, 8, 2, t);
        } else if (t >= 3) this.end(1.5);
        break;
      }
      case 'wall': {
        if (t > 1) {
          // a wall of bullets with one gap, flying at the player
          _b.copy(pl.pos).sub(core.pos).normalize();
          _c.crossVectors(_b, UP).normalize();
          const up2 = _d.crossVectors(_c, _b).normalize();
          const gx = w.rng.int(-3, 3);
          const gy = w.rng.int(-2, 2);
          for (let ix = -5; ix <= 5; ix++)
            for (let iy = -3; iy <= 3; iy++) {
              if (Math.abs(ix - gx) <= 1 && Math.abs(iy - gy) <= 1) continue;
              const ox = core.pos.x + _c.x * ix * 4 + up2.x * iy * 4;
              const oy = core.pos.y + _c.y * ix * 4 + up2.y * iy * 4;
              const oz = core.pos.z + _c.z * ix * 4 + up2.z * iy * 4;
              w.spawnEnemyShot(ox, oy, oz, _b.x * 34, _b.y * 34, _b.z * 34, 10, 2, 0.9, 5);
            }
          w.events.emit('enemyShot', { x: core.pos.x, y: core.pos.y, z: core.pos.z, big: true });
          this.end(2.4);
        }
        break;
      }
      case 'beams': {
        if (t > 4.5) {
          for (const b of this.beams) b.on = false;
          this.end(1.5);
        }
        break;
      }
      case 'mines': {
        for (let i = 0; i < 10; i++) w.spawnEnemyShot(pl.pos.x + w.rng.range(-30, 30), pl.pos.y + w.rng.range(-15, 15), pl.pos.z + w.rng.range(-30, 30), 0, 0, 0, 14, 4, 1.2, 9);
        this.end(2);
        break;
      }
    }
    void dist;
  }

  private startPattern(w: World): void {
    const core = this.core;
    const pl = w.player;
    switch (this.active) {
      case 'ring':
      case 'volley':
      case 'homing':
      case 'summon':
        w.addTelegraph({ kind: 'sphere', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: 0, by: 0, bz: 0, radius: core.radius * 2.2, dur: 0.8, owner: core.id });
        core.emissive = 1;
        break;
      case 'spiral':
      case 'wall':
        w.addTelegraph({ kind: 'ring', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: 0, by: 1, bz: 0, radius: core.radius * 3, dur: 1, owner: core.id });
        break;
      case 'sweep':
        this.chargeDir.copy(pl.pos).sub(core.pos).normalize();
        this.sweepAxis.set(w.rng.range(-0.3, 0.3), 1, w.rng.range(-0.3, 0.3)).normalize();
        break;
      case 'charge':
        _b.copy(pl.pos).addScaledVector(pl.vel, 0.3);
        this.chargeDir.copy(_b).sub(core.pos).normalize();
        w.addTelegraph({ kind: 'line', ax: core.pos.x, ay: core.pos.y, az: core.pos.z, bx: core.pos.x + this.chargeDir.x * 160, by: core.pos.y + this.chargeDir.y * 160, bz: core.pos.z + this.chargeDir.z * 160, radius: core.radius, dur: 1, owner: core.id });
        break;
      case 'pull':
        w.addTelegraph({ kind: 'ring', ax: pl.pos.x, ay: pl.pos.y, az: pl.pos.z, bx: 0, by: 1, bz: 0, radius: 12, dur: 0.8, owner: core.id });
        break;
      case 'beams':
        for (const b of this.beams) {
          b.on = true;
          b.warm = 0;
        }
        break;
    }
  }

  private end(cool: number): void {
    this.active = null;
    this.patternT = cool;
  }
}
