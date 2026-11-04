import { Vector3 } from 'three';
import { BAL } from '../data/balance';
import { Rng } from '../core/rng';
import { Emitter } from '../core/events';
import { SpatialHash } from '../core/spatial';
import { clamp } from '../core/math';
import { ENEMY_BY_ID } from '../data/enemies';
import { SUBTYPES, pickSubtype } from '../data/subtypes';
import { DROP_KINDS, dropChance, type DropKind } from '../data/drops';
import { AFFIX_BY_ID, AFFIX_INDEX, RARITY, rollAffixes, uniqueName, type AffixId, type Rarity } from '../data/affixes';
import type { EnemyDef, Faction, StatusKind, TriggerDef, TriggerOn, WeaponParams } from './types';
import { Build, WeaponInstance } from './build';
import {
  ArcFx,
  BeamFx,
  Debris,
  Decoy,
  Drone,
  Enemy,
  Motes,
  PF_CHILD,
  PF_ECHO,
  PF_ENEMY,
  PF_GRAZED,
  PF_KINETIC,
  PF_MINE,
  PF_MISSILE,
  Projectiles,
  Telegraph,
  Well,
} from './entities';
import { Player, type Controls } from './player';
import { updateEnemyAI } from './ai';
import { updateWeapons, syncDrones, type RailFx } from './weapons';
import type { BossController } from './bosses';
import { hexToRgb } from '../core/math';

export interface WorldEvents {
  shot: {
    x: number;
    y: number;
    z: number;
    dx: number;
    dy: number;
    dz: number;
    w: WeaponInstance;
    secondary: boolean;
  };
  hit: {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    dmg: number;
    crit: boolean;
    e: Enemy;
    kinetic: boolean;
  };
  block: { x: number; y: number; z: number };
  /** a heavy hull crossed an HP threshold and shed plating (stage 1/2) */
  breakup: { e: Enemy; x: number; y: number; z: number; stage: number };
  kill: { e: Enemy; x: number; y: number; z: number; chain: number; big: number };
  explosion: {
    x: number;
    y: number;
    z: number;
    radius: number;
    r: number;
    g: number;
    b: number;
    enemy: boolean;
  };
  pickup: { x: number; y: number; z: number; value: number; combo: number };
  /** a drop appeared (picked=false) or was collected (picked=true) */
  drop: { kind: DropKind; x: number; y: number; z: number; picked: boolean };
  graze: { x: number; y: number; z: number; count: number };
  hurt: { dmg: number; hull: boolean; x: number; y: number; z: number };
  shieldBreak: Record<string, never>;
  dodge: Record<string, never>;
  flare: { on: boolean };
  enemyShot: { x: number; y: number; z: number; big: boolean };
  telegraph: { x: number; y: number; z: number; kind: string };
  status: { kind: StatusKind; x: number; y: number; z: number };
  reaction: { id: string; x: number; y: number; z: number };
  ability: { kind: 'shockwave' | 'stasis' };
  spawn: { x: number; y: number; z: number; faction: Faction; big: boolean };
  bossPhase: { phase: number };
  bossDeath: { x: number; y: number; z: number };
  playerDeath: { cause: string };
  evolve: { name: string };
  beamTick: { secondary: boolean };
  lumenFull: Record<string, never>;
}

export type DamageSrc = number; // index into params registry, -1 = environment/ability

export interface ExplodeOpts {
  color?: [number, number, number];
  depth?: number;
  noSelf?: boolean;
  status?: Partial<Record<StatusKind, number>>;
  knock?: number;
  enemy?: boolean; // hurts player instead
  implode?: boolean;
}

const _a = new Vector3();
const _b = new Vector3();
const _brk = new Vector3();
const _brk2 = new Vector3();
const _c = new Vector3();

export interface RunStats {
  kills: number;
  damageTaken: number;
  grazes: number;
  sectorGrazes: number;
  flareKills: number;
  maxFlareKills: number;
  maxChain: number;
  eliteKills: number;
  bossKills: number;
  reactions: Set<string>;
  enemiesSeen: Set<string>;
}

export class World {
  rng: Rng;
  time = 0;
  build: Build;
  player: Player;
  enemies: Enemy[] = [];
  private pool: Enemy[] = [];
  /** per-world id counter (a module-wide one made seeded runs diverge between sessions) */
  private nextEnemyId = 1;
  /** alternating primary gun (left/right), per world so seeded runs stay deterministic */
  gunSide = 1;
  private chainSets: Set<number>[] = Array.from({ length: 8 }, () => new Set<number>());
  private chainDepth = 0;
  private colorCache = new Map<string, [number, number, number]>();
  proj = new Projectiles(4096);
  eproj = new Projectiles(3072);
  motes = new Motes(2048);
  debris = new Debris(900);
  wells: Well[] = [];
  drones: Drone[] = [];
  decoys: Decoy[] = [];
  telegraphs: Telegraph[] = [];
  arcs: ArcFx[] = [];
  beams: BeamFx[] = [];
  rails: RailFx[] = [];
  heartT = 0;
  events = new Emitter<WorldEvents>();
  hash = new SpatialHash(14, 1024, 2048);
  private hx = new Float32Array(1024);
  private hy = new Float32Array(1024);
  private hz = new Float32Array(1024);
  private hIndex: Enemy[] = [];
  /** one buffer per nesting depth: area effects can trigger further area effects */
  private qbufs: Int32Array[] = Array.from({ length: 12 }, () => new Int32Array(512));
  private qdepth = 0;
  /** dedicated buffer for the projectile sweep */
  private pbuf = new Int32Array(512);
  arenaRadius = 230;
  boss: BossController | null = null;
  /** Params registry: build weapons first, then trigger/virtual weapons. */
  params: WeaponParams[] = [];
  weaponsByIndex: (WeaponInstance | null)[] = [];
  triggerParams!: WeaponParams;
  stats: RunStats = {
    kills: 0,
    damageTaken: 0,
    grazes: 0,
    sectorGrazes: 0,
    flareKills: 0,
    maxFlareKills: 0,
    maxChain: 0,
    eliteKills: 0,
    bossKills: 0,
    reactions: new Set(),
    enemiesSeen: new Set(),
  };
  tokens = 0;
  maxTokens = 4;
  heat = 0;
  /** chain-kill tracker for escalating fireworks */
  chain = 0;
  chainT = 0;
  moteCombo = 0;
  moteComboT = 0;
  private triggerDepth = 0;
  private triggerCd = new Map<TriggerDef, number>();
  combatActive = false;
  /** Global sim slow (assist, flare activation slowmo handled by loop). */
  enemyTimeScale = 1;
  hitDealt = 0;
  killsThisTick = 0;

  constructor(seed: string | number, build: Build) {
    this.rng = new Rng(seed);
    this.build = build;
    this.player = new Player(this);
    this.player.reset(this);
    this.refreshParams();
  }

  // ------------------------------------------------------------ setup

  refreshParams(): void {
    const ws = this.build.weapons;
    this.params = ws.map((w) => w.params);
    this.weaponsByIndex = ws.map((w, i) => {
      w.slotIndex = i;
      return w;
    });
    const tp: WeaponParams = {
      ...this.build.primary.params,
      damage: 14 * this.build.ship.globalDamage,
      pierce: 0,
      ricochet: 0,
      split: 0,
      explode: 0,
      homing: 0,
      count: 1,
    };
    this.triggerParams = tp;
    this.params.push(tp);
    this.weaponsByIndex.push(null);
    syncDrones(this);
  }

  get triggerSrc(): number {
    return this.params.length - 1;
  }

  clearArena(): void {
    this.drops.length = 0;
    for (const e of this.enemies) this.release(e);
    this.enemies.length = 0;
    this.proj.clear();
    this.eproj.clear();
    this.wells.length = 0;
    this.decoys.length = 0;
    this.telegraphs.length = 0;
    this.arcs.length = 0;
    this.boss = null;
    this.tokens = 0;
    this.rails.length = 0;
    this.beams.length = 0;
  }

  private release(e: Enemy): void {
    e.alive = false;
    this.pool.push(e);
  }

  /** Spawn an enemy. rarity > 0 rolls affixes from the table (or uses `affixes` when given). */
  spawnEnemy(def: EnemyDef | string, x: number, y: number, z: number, rarity: Rarity = 0, affixes?: AffixId[]): Enemy {
    const d = typeof def === 'string' ? ENEMY_BY_ID[def]! : def;
    const e = (this.pool.pop() ?? new Enemy()).reset(d, this.nextEnemyId++);
    e.pos.set(x, y, z);
    e.prev.copy(e.pos);
    const heatHp = 1 + (this.heat >= 1 ? 0.15 : 0) + (this.heat >= 5 ? 0.3 : 0);
    const isBoss = d.role === 'boss' || d.role === 'part';
    // bosses grow more slowly per sector than the rank and file, or late fights turn into sponges
    const sectorHp = isBoss ? 1 + (this.sectorHpScale - 1) * BAL.bossSectorHp : this.sectorHpScale;
    e.hpMul = heatHp * sectorHp * (isBoss ? BAL.bossHp : d.role === 'inert' ? 1 : BAL.enemyHp);
    e.hp = e.maxHp = d.hp * e.hpMul;
    e.dmgMul = this.heat >= 8 ? 1.25 : 1;
    const [r, g, b] = hexToRgb(d.accent);
    e.tint.set(r, g, b);
    e.orbitDir = this.rng.chance(0.5) ? 1 : -1;
    e.timer = this.rng.range(0.5, 2.5);
    e.moveT = this.rng.range(1.5, 4);
    if (!isBoss && d.role !== 'inert') {
      e.subtype = pickSubtype(d.id, this.sectorIdx, (w) => this.rng.weighted(w));
      const st = e.subtype >= 0 ? SUBTYPES[d.id]![e.subtype] : undefined;
      if (st) {
        if (st.hp) e.hp = e.maxHp = e.maxHp * st.hp;
        if (st.speed) e.speedMul *= st.speed;
        if (st.fire) e.fireMul *= st.fire;
      }
    }
    if (rarity > 0 && !isBoss && d.role !== 'inert') this.applyRank(e, rarity, affixes ?? rollAffixes(this.rng, rarity, d.role, this.sectorIdx));
    this.enemies.push(e);
    this.stats.enemiesSeen.add(d.id);
    this.events.emit('spawn', { x, y, z, faction: d.faction, big: d.threat >= 5 || rarity > 0 });
    return e;
  }

  sectorHpScale = 1;
  /** enemy damage growth for the current sector (set by the Director) */
  sectorDmgScale = 1;
  private beamHitT = 0;

  /** loot on the field (few at a time, so plain objects) */
  drops: { x: number; y: number; z: number; vx: number; vy: number; vz: number; kind: DropKind; age: number }[] = [];
  /** banked drafts, paid out when the fight ends */
  bank = { shard: 0, prism: 0, cache: 0 };

  /** Roll every drop kind for a kill against the drop table. */
  private rollDrops(e: Enemy, x: number, y: number, z: number): void {
    const gilded = e.affixMask !== 0 && e.has('gilded');
    let shard = false;
    for (const k of DROP_KINDS) {
      const hit = this.rng.next() < dropChance(e.def, k, e.rarity, gilded, this.build.ship.luck, e.isBossCore) || (k === 'shard' && e.rarity === 3 && !shard);
      if (!hit) continue;
      if (k === 'shard') shard = true;
      _brk.set(this.rng.next() - 0.5, this.rng.next() * 0.6, this.rng.next() - 0.5).normalize().multiplyScalar(10 + this.rng.next() * 8);
      this.drops.push({ x, y, z, vx: _brk.x, vy: _brk.y, vz: _brk.z, kind: k, age: 0 });
      this.events.emit('drop', { kind: k, x, y, z, picked: false });
    }
  }

  private updateDrops(dt: number): void {
    const pl = this.player;
    const reach = this.build.ship.magnet * 1.4;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.age += dt;
      const dx = pl.pos.x - d.x;
      const dy = pl.pos.y - d.y;
      const dz = pl.pos.z - d.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      if (pl.alive && d.age > 0.6 && (dist < reach || d.age > 12)) {
        const k = (70 + Math.max(0, reach - dist) * 5) / dist;
        d.vx += dx * k * dt;
        d.vy += dy * k * dt;
        d.vz += dz * k * dt;
        d.vx *= 1 - dt * 3;
        d.vy *= 1 - dt * 3;
        d.vz *= 1 - dt * 3;
        if (dist < 2.6) {
          this.collectDrop(i);
          continue;
        }
      } else {
        d.vx *= 1 - dt * 1.5;
        d.vy *= 1 - dt * 1.5;
        d.vz *= 1 - dt * 1.5;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
    }
  }

  /** Collect drop i (or all of them at the end of a fight). */
  collectDrop(i: number): void {
    const d = this.drops[i]!;
    const pl = this.player;
    if (d.kind === 'repair') pl.hull = Math.min(pl.maxHull, pl.hull + 18);
    else if (d.kind === 'cell') pl.lumen = Math.min(100, pl.lumen + 35);
    else this.bank[d.kind]++;
    this.events.emit('drop', { kind: d.kind, x: d.x, y: d.y, z: d.z, picked: true });
    this.drops.splice(i, 1);
  }

  /** current sector (0-based), set by the Director; gates affixes */
  sectorIdx = 0;

  /** Promote an enemy to a rarity tier with the given affixes. */
  applyRank(e: Enemy, rarity: Rarity, affixes: AffixId[]): void {
    const R = RARITY[rarity];
    e.rarity = rarity;
    e.affixes = affixes.slice();
    e.affixMask = 0;
    for (const a of affixes) e.affixMask |= 1 << AFFIX_INDEX[a];
    e.elite = affixes[0] ?? null;
    let hp = R.hp;
    let scale = R.scale;
    for (const a of affixes) {
      const d = AFFIX_BY_ID[a];
      if (d.hp) hp *= d.hp;
      if (d.scale) scale *= d.scale;
      if (d.speed) e.speedMul *= d.speed;
      if (d.fire) e.fireMul *= d.fire;
      if (d.dmg) e.dmgMul *= d.dmg;
      if (d.armor) e.armor += d.armor;
      if (d.taken) e.dmgTaken *= d.taken;
    }
    e.hp = e.maxHp = e.maxHp * hp;
    e.scale *= scale;
    e.radius *= scale;
    if (e.has('shielded')) e.shield = e.maxShield = e.maxHp * 0.5;
    if (e.has('cloaked')) e.cloak = 0.8;
    e.affT = 2 + this.rng.next() * 3;
    e.affT2 = 1 + this.rng.next() * 2;
    if (rarity === 3) e.rankName = uniqueName(this.rng, e.def.name);
    // a pack leader arrives with escorts of its own kind
    if (e.has('packleader')) {
      for (let i = 0; i < 2; i++) {
        const c = this.spawnEnemy(e.def, e.pos.x + this.rng.range(-6, 6), e.pos.y + this.rng.range(-4, 4), e.pos.z + this.rng.range(-6, 6));
        c.speedMul *= 1.2;
        c.fireMul *= 1.2;
        c.spawnT = 0.3;
      }
    }
  }

  // ------------------------------------------------------------ main update

  update(c: Controls, dt: number): void {
    this.time += dt;
    if (this.beamHitT > 0) this.beamHitT -= dt;
    this.killsThisTick = 0;
    this.player.update(c, dt);
    const edt = dt * this.enemyTimeScale;
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
    }
    if (this.moteComboT > 0) {
      this.moteComboT -= dt;
      if (this.moteComboT <= 0) this.moteCombo = 0;
    }
    for (const [t, v] of this.triggerCd) if (v > 0) this.triggerCd.set(t, v - dt);

    updateWeapons(this, c, dt);
    this.rebuildHash();
    this.boss?.update(this, edt);
    updateEnemyAI(this, edt);
    this.updateStatuses(edt);
    this.rebuildHash();
    this.updateProjectiles(dt);
    this.updateEnemyProjectiles(edt);
    this.updateWells(dt);
    this.updateMotes(dt);
    this.updateDrops(dt);
    this.updateDebris(dt);
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i]!;
      d.life -= dt;
      if (d.life <= 0) this.decoys.splice(i, 1);
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i]!;
      t.t += edt;
      if (t.t >= t.dur) this.telegraphs.splice(i, 1);
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]!;
      a.t += dt;
      if (a.t > 0.18) this.arcs.splice(i, 1);
    }
    // cleanup dead
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      if (!e.alive) {
        if (e.dying > 0) {
          e.dying -= dt;
          if (e.dying > 0) continue;
        }
        if (e.hasToken) this.tokens--;
        this.enemies.splice(i, 1);
        this.release(e);
      }
    }
    if (this.player.flareT <= 0 && this.stats.flareKills > 0) {
      this.stats.maxFlareKills = Math.max(this.stats.maxFlareKills, this.stats.flareKills);
      this.stats.flareKills = 0;
    }
  }

  rebuildHash(): void {
    const list = this.hIndex;
    list.length = 0;
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive || n >= 1024) continue;
      this.hx[n] = e.pos.x;
      this.hy[n] = e.pos.y;
      this.hz[n] = e.pos.z;
      list.push(e);
      n++;
    }
    this.hash.build(n, this.hx, this.hy, this.hz);
  }

  /** Query live enemies near a point. Callback returns true to stop. */
  forEnemiesNear(x: number, y: number, z: number, r: number, fn: (e: Enemy) => boolean | void): void {
    const buf = this.qbufs[this.qdepth] ?? new Int32Array(512);
    this.qdepth++;
    try {
      const cnt = this.hash.query(x, y, z, r + 6, buf);
      for (let k = 0; k < cnt; k++) {
        const e = this.hIndex[buf[k]!];
        if (!e || !e.alive) continue;
        const dx = e.pos.x - x;
        const dy = e.pos.y - y;
        const dz = e.pos.z - z;
        const rr = r + e.radius;
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        if (fn(e)) return;
      }
    } finally {
      this.qdepth--;
    }
  }

  /** exclude: a set of ids, or a single id (allocation-free for the common case) */
  nearestEnemy(x: number, y: number, z: number, maxR: number, exclude?: Set<number> | number): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxR * maxR;
    const exId = typeof exclude === 'number' ? exclude : -1;
    const exSet = typeof exclude === 'object' ? exclude : null;
    for (const e of this.enemies) {
      if (!e.alive || !e.revealed || e.def.role === 'inert') continue;
      if (e.id === exId || (exSet && exSet.has(e.id))) continue;
      const d = e.pos.distanceToSquared(_a.set(x, y, z));
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ damage pipeline

  damageEnemy(
    e: Enemy,
    amount: number,
    src: DamageSrc,
    hx: number,
    hy: number,
    hz: number,
    nx: number,
    ny: number,
    nz: number,
    opts: {
      kinetic?: boolean;
      noStatus?: boolean;
      noTrigger?: boolean;
      forceCrit?: boolean;
      knock?: number;
    } = {},
  ): void {
    if (!e.alive) return;
    if (e.invuln) {
      this.events.emit('block', { x: hx, y: hy, z: hz });
      return;
    }
    if (e.affixMask && src >= 0 && e.has('deflecting') && this.rng.next() < 0.25) {
      this.events.emit('block', { x: hx, y: hy, z: hz });
      return;
    }
    const p = src >= 0 ? this.params[src] : undefined;
    const pl = this.player;
    let dmg = amount * pl.damageMul();
    const w = src >= 0 ? this.weaponsByIndex[src] : null;
    if (this.build.flags.has('coherence') && w?.hasTag('energy') && pl.shield > 0) dmg *= 1.25;
    if (this.build.flags.has('starEater') && (e.def.role === 'boss' || e.def.role === 'part')) dmg *= 1.4;
    if (e.corrode > 0) dmg *= 1 + 0.08 * e.corrode;
    dmg *= e.dmgTaken;
    // Shatter reaction: kinetic on frozen
    let shatter = false;
    if (
      e.frozen &&
      (opts.kinetic || this.build.flags.has('stoppedClock') || (w?.def.id === 'timeshard' && w.evolved))
    ) {
      dmg *= 2.5;
      shatter = true;
      e.frozenT = 0;
      e.cryo = 0;
      this.reaction('r_shatter', e.pos.x, e.pos.y, e.pos.z);
      this.radialShards(e.pos.x, e.pos.y, e.pos.z, 6, amount * 0.4);
    }
    // crits
    let crit = !!opts.forceCrit;
    const critChance = (p?.crit ?? 0.05) + (pl.critBuff ? 1 : 0);
    if (!crit && this.rng.next() < critChance) crit = true;
    if (!crit && e.frozen && (p?.radiant ?? 0) > 0) {
      crit = true;
      this.reaction('r_glint', e.pos.x, e.pos.y, e.pos.z);
    }
    if (crit) {
      dmg *= p?.critMul ?? 2;
      pl.critBuff = false;
    }
    // armor
    const armor = e.armor * (e.corrode > 0 ? Math.max(0, 1 - e.corrode * 0.2) : 1);
    dmg = Math.max(dmg * 0.2, dmg - armor);
    if (e.shieldedBy > 0) dmg *= 0.5;
    // elite shield
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, dmg);
      e.shield -= absorbed;
      dmg -= absorbed;
    }
    e.hp -= dmg;
    e.flash = 1;
    e.wobble = Math.min(1, e.wobble + 0.4);
    e.lastSrc = src;
    this.hitDealt += dmg;
    if (w) w.damageDealt += dmg;
    // knockback
    const kb = (opts.knock ?? p?.knock ?? 0) / Math.max(1, e.radius * e.radius * 0.6);
    if (kb > 0 && e.def.role !== 'boss' && e.def.role !== 'part' && e.def.role !== 'turret' && !(e.affixMask && e.has('relentless'))) {
      e.vel.x -= nx * kb;
      e.vel.y -= ny * kb;
      e.vel.z -= nz * kb;
    }
    this.events.emit('hit', { x: hx, y: hy, z: hz, nx, ny, nz, dmg, crit, e, kinetic: !!opts.kinetic });

    // statuses
    if (p && !opts.noStatus) {
      const pw = p.statusPower;
      if (p.burn > 0 && this.rng.next() < p.burn) this.applyStatus(e, 'burn', pw);
      if (p.cryo > 0 && this.rng.next() < p.cryo) this.applyStatus(e, 'cryo', pw);
      if (p.shock > 0 && this.rng.next() < p.shock) this.applyStatus(e, 'shock', pw, dmg);
      if (p.corrode > 0 && this.rng.next() < p.corrode) this.applyStatus(e, 'corrode', pw);
      if (p.void > 0 && this.rng.next() < p.void) this.applyStatus(e, 'void', pw);
      if (p.radiant > 0 && this.rng.next() < p.radiant) this.applyStatus(e, 'radiant', pw);
    }
    if (!opts.noTrigger) {
      this.fireTriggers('hit', hx, hy, hz, dmg);
      if (crit) {
        this.fireTriggers('crit', hx, hy, hz, dmg);
        if (this.build.flags.has('critChain')) this.chainLightning(e, 1, dmg * 0.5, src);
      }
    }
    if (shatter) e.flash = 1.5;
    // Thorned: a hard hit spits a shard back at the shooter
    if (e.affixMask && e.hp > 0 && dmg > 6 && e.thornT <= 0 && e.has('thorned')) {
      e.thornT = 0.6;
      _brk.copy(this.player.pos).sub(e.pos).normalize().multiplyScalar(80);
      this.spawnEnemyShot(e.pos.x, e.pos.y, e.pos.z, _brk.x, _brk.y, _brk.z, 9 * e.dmgMul, 2, 0.8, 3);
    }
    if (e.hp <= 0) this.killEnemy(e, dmg);
    else if (e.heavy) this.checkBreakup(e);
  }

  /** Staged destruction: heavy hulls shed plating at 66% and 33% HP. */
  private checkBreakup(e: Enemy): void {
    const f = e.hp / e.maxHp;
    const stage = f < 0.33 ? 2 : f < 0.66 ? 1 : 0;
    if (stage <= e.breakStage) return;
    e.breakStage = stage;
    // shed point: a seeded spot on the hull surface
    _brk.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).normalize();
    const rr = e.radius * 0.8;
    const x = e.pos.x + _brk.x * rr;
    const y = e.pos.y + _brk.y * rr;
    const z = e.pos.z + _brk.z * rr;
    if (e.def.faction !== 'hush') {
      const n = 3 + stage * 2;
      for (let i = 0; i < n; i++) {
        const sp = 10 + this.rng.next() * 16;
        _brk2.set(_brk.x + this.rng.next() - 0.5, _brk.y + this.rng.next() - 0.5, _brk.z + this.rng.next() - 0.5).normalize();
        this.debris.spawn(
          x, y, z,
          e.vel.x * 0.5 + _brk2.x * sp,
          e.vel.y * 0.5 + _brk2.y * sp,
          e.vel.z * 0.5 + _brk2.z * sp,
          (0.35 + this.rng.next() * 0.5) * Math.min(2, e.scale * 0.7),
          2 + this.rng.next() * 2,
          e.def.faction === 'choir' ? 1 : 0.8,
          e.tint.x, e.tint.y, e.tint.z,
          () => this.rng.next(),
          0,
        );
      }
    }
    e.wobble = 1;
    this.events.emit('breakup', { e, x, y, z, stage });
  }

  applyStatus(e: Enemy, kind: StatusKind, power: number, baseDmg = 10): void {
    switch (kind) {
      case 'burn':
        if (e.corrode > 0 && e.burn === 0) this.reaction('r_melt', e.pos.x, e.pos.y, e.pos.z);
        e.burn = Math.min(5, e.burn + 1);
        e.burnT = 3 * power;
        break;
      case 'cryo': {
        const need = this.build.flags.has('deepfreeze') ? 3 : 5;
        e.cryo = Math.min(need, e.cryo + 1);
        e.cryoT = 3;
        if (e.cryo >= need && e.frozenT <= 0) {
          e.frozenT = (this.build.flags.has('deepfreeze') ? 2.6 : 1.8) * power;
          this.events.emit('status', { kind: 'cryo', x: e.pos.x, y: e.pos.y, z: e.pos.z });
        }
        break;
      }
      case 'shock': {
        if (e.burn > 0) {
          this.reaction('r_overload', e.pos.x, e.pos.y, e.pos.z);
          e.burn = 0;
          this.explode(e.pos.x, e.pos.y, e.pos.z, 9 + e.radius, baseDmg * 1.5 + 12, this.triggerSrc, {
            color: [1, 0.7, 0.3],
          });
        }
        e.shockT = 1.2;
        const range = this.build.flags.has('stormfront') ? 2 : 1;
        this.chainLightning(e, 2, baseDmg * 0.4 * power, this.triggerSrc, 26 * range, e.corrode > 0);
        break;
      }
      case 'corrode':
        e.corrode = Math.min(8, e.corrode + 1);
        e.corrodeT = 5 * power;
        break;
      case 'void':
        e.voidT = 1.5 * power;
        break;
      case 'radiant':
        e.radiantT = 4;
        break;
    }
    if (kind !== 'cryo') this.events.emit('status', { kind, x: e.pos.x, y: e.pos.y, z: e.pos.z });
  }

  reaction(id: string, x: number, y: number, z: number): void {
    this.stats.reactions.add(id);
    this.events.emit('reaction', { id, x, y, z });
  }

  private updateStatuses(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 12);
      if (e.wobble > 0) e.wobble = Math.max(0, e.wobble - dt * 3);
      if (e.spawnT > 0) e.spawnT -= dt;
      if (e.burn > 0) {
        e.burnT -= dt;
        let bd = e.burn * 5 * dt * (this.build.flags.has('meltdown') && e.corrode > 0 ? 1.5 : 1);
        if (e.corrode > 0) bd *= 2;
        e.hp -= bd;
        if (e.burnT <= 0) e.burn = 0;
        if (e.hp <= 0) {
          this.killEnemy(e, bd);
          continue;
        }
      }
      if (e.cryoT > 0) {
        e.cryoT -= dt;
        if (e.cryoT <= 0) e.cryo = 0;
      }
      if (e.frozenT > 0) e.frozenT -= dt;
      if (e.shockT > 0) e.shockT -= dt;
      if (e.corrodeT > 0) {
        e.corrodeT -= dt;
        if (e.corrodeT <= 0) e.corrode = 0;
      }
      if (e.radiantT > 0) e.radiantT -= dt;
      if (e.voidT > 0) {
        e.voidT -= dt;
        // pull toward nearby enemies' centroid
        let cx = 0;
        let cy = 0;
        let cz = 0;
        let n = 0;
        this.forEnemiesNear(e.pos.x, e.pos.y, e.pos.z, 18, (o) => {
          if (o === e) return;
          cx += o.pos.x;
          cy += o.pos.y;
          cz += o.pos.z;
          n++;
        });
        if (n > 0) {
          const k = (this.build.flags.has('eventhorizon') ? 30 : 18) * dt;
          _a.set(cx / n, cy / n, cz / n)
            .sub(e.pos)
            .normalize();
          e.vel.addScaledVector(_a, k);
        }
      }
      if (e.hitCdHalo > 0) e.hitCdHalo -= dt;
      if (e.shieldedBy > 0) e.shieldedBy -= dt;
      if (e.buffT > 0) e.buffT -= dt;
      if (e.thornT > 0) e.thornT -= dt;
      if (e.affixMask && e.has('regenerating') && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.03 * dt);
      if (e.affixMask && e.has('shielded') && e.shield < e.maxShield)
        e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.06 * dt);
    }
  }

  killEnemy(e: Enemy, overkill: number): void {
    if (!e.alive) return;
    e.alive = false;
    const d = e.def;
    const x = e.pos.x;
    const y = e.pos.y;
    const z = e.pos.z;
    if (d.faction === 'hush') e.dying = 0.4;
    this.killsThisTick++;
    if (d.role !== 'inert') {
      this.stats.kills++;
      this.chain++;
      this.chainT = 0.45;
      this.stats.maxChain = Math.max(this.stats.maxChain, this.chain);
      if (this.player.flareT > 0) {
        this.stats.flareKills++;
        if (this.build.flags.has('flareChain'))
          this.player.flareT = Math.min(this.player.flareT + 0.25, this.build.ship.flareDur + 4);
      }
      const w = e.lastSrc >= 0 ? this.weaponsByIndex[e.lastSrc] : null;
      if (w) w.kills++;
    }
    const big = clamp((e.radius * e.scale) / 3, 0.2, 3) + (e.elite ? 0.6 : 0) + (d.role === 'boss' ? 3 : 0);
    this.events.emit('kill', { e, x, y, z, chain: this.chain, big });

    // a boss core 'dies' twice (staged death sequence); only the final kill pays out
    if (!e.isBossCore || this.boss?.dead) this.rollDrops(e, x, y, z);
    // Light motes
    let light = d.light * RARITY[e.rarity].light * (e.affixMask && e.has('gilded') ? 3 : 1);
    if (e.radiantT > 0) light *= 2;
    this.dropMotes(x, y, z, light, e.radius);
    // debris
    if (d.faction !== 'hush') {
      const n = Math.min(14, Math.round(4 + e.radius * e.scale * 2));
      const [r, g, b] = [e.tint.x, e.tint.y, e.tint.z];
      const dmgD = this.build.flags.has('debrisHoming') ? 8 * this.build.ship.debrisDamage : 0;
      for (let i = 0; i < n; i++) {
        _a.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).normalize();
        const sp = 8 + this.rng.next() * 22;
        this.debris.spawn(
          x + _a.x * e.radius * 0.5,
          y + _a.y * e.radius * 0.5,
          z + _a.z * e.radius * 0.5,
          e.vel.x * 0.5 + _a.x * sp,
          e.vel.y * 0.5 + _a.y * sp,
          e.vel.z * 0.5 + _a.z * sp,
          (0.4 + this.rng.next() * 0.7) * Math.min(2.4, e.scale * 0.8),
          2.5 + this.rng.next() * 2.5,
          d.faction === 'choir' ? 1 : 0.8,
          r,
          g,
          b,
          () => this.rng.next(),
          dmgD,
        );
      }
    }
    // splitters
    if (d.role === 'splitter' && e.parent === null) {
      const child = d.faction === 'choir' ? 'shardling' : 'moteeater';
      for (let i = 0; i < 3; i++) {
        const c = this.spawnEnemy(
          child,
          x + this.rng.range(-2, 2),
          y + this.rng.range(-2, 2),
          z + this.rng.range(-2, 2),
        );
        c.vel.set(this.rng.range(-20, 20), this.rng.range(-20, 20), this.rng.range(-20, 20));
        c.spawnT = 0;
      }
    }
    if (e.affixMask && e.has('volatile')) {
      this.addTelegraph({ kind: 'sphere', ax: x, ay: y, az: z, bx: 0, by: 0, bz: 0, radius: 10, dur: 0.35, owner: -1 });
      this.explode(x, y, z, 10, 26 * e.dmgMul, -1, { enemy: true, color: [1, 0.5, 0.2] });
    }
    if (e.affixMask && e.has('cursed')) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.spawnEnemyShot(x + Math.cos(a) * 7, y + this.rng.range(-2, 2), z + Math.sin(a) * 7, 0, 0, 0, 14 * e.dmgMul, 4, 1.2, 9);
      }
    }
    if (e.affixMask && e.has('splitting')) {
      for (let i = 0; i < 2; i++) {
        const c = this.spawnEnemy(d, x + this.rng.range(-3, 3), y, z + this.rng.range(-3, 3));
        c.hp = c.maxHp = c.maxHp * 0.35;
        c.scale *= 0.75;
        c.spawnT = 0;
      }
    }
    if (d.role === 'inert') return;
    // reactions/flags on kill
    if (e.burn > 0 && this.build.flags.has('wildfire')) {
      this.forEnemiesNear(x, y, z, 12, (o) => {
        this.applyStatus(o, 'burn', 1);
      });
    }
    if (e.frozen && this.build.flags.has('frozenSpread')) {
      this.forEnemiesNear(x, y, z, 14, (o) => {
        this.applyStatus(o, 'cryo', 1);
        this.applyStatus(o, 'cryo', 1);
      });
    }
    if (e.rarity > 0) {
      this.stats.eliteKills++;
      this.fireTriggers('eliteKill', x, y, z, overkill);
    }
    this.fireTriggers('kill', x, y, z, Math.max(overkill, e.maxHp * 0.5));
    this.boss?.onPartKilled(this, e);
  }

  dropMotes(x: number, y: number, z: number, light: number, spread: number): void {
    const n = Math.min(12, Math.max(1, Math.round(light / 2)));
    const v = light / n;
    for (let i = 0; i < n; i++) {
      _a.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).normalize();
      const sp = 6 + this.rng.next() * 14;
      this.motes.spawn(
        x + _a.x * spread * 0.3,
        y + _a.y * spread * 0.3,
        z + _a.z * spread * 0.3,
        _a.x * sp,
        _a.y * sp,
        _a.z * sp,
        v,
      );
    }
  }

  /** AoE damage. Enemy explosions damage the player instead. */
  explode(
    x: number,
    y: number,
    z: number,
    radius: number,
    dmg: number,
    src: DamageSrc,
    opts: ExplodeOpts = {},
  ): void {
    const col = opts.color ?? [1, 0.6, 0.3];
    this.events.emit('explosion', { x, y, z, radius, r: col[0], g: col[1], b: col[2], enemy: !!opts.enemy });
    if (opts.enemy) {
      const d = this.player.pos.distanceTo(_a.set(x, y, z));
      if (d < radius + this.player.radius) this.hurtPlayer(dmg * (1 - (d / (radius + 1)) * 0.5), 'Explosion');
      return;
    }
    const depth = opts.depth ?? 0;
    if (depth > 6) return;
    const implode = !!opts.implode;
    this.forEnemiesNear(x, y, z, radius, (e) => {
      _a.copy(e.pos).sub(_b.set(x, y, z));
      const d = _a.length() || 1;
      _a.multiplyScalar(1 / d);
      const fall = 1 - Math.min(1, d / (radius + e.radius)) * 0.5;
      if (e.voidT > 0 && !implode) {
        this.reaction('r_implosion', e.pos.x, e.pos.y, e.pos.z);
      }
      const kb = opts.knock ?? radius * 1.2;
      if (implode || e.voidT > 0) e.vel.addScaledVector(_a, -kb * 0.8);
      this.damageEnemy(e, dmg * fall, src, e.pos.x, e.pos.y, e.pos.z, -_a.x, -_a.y, -_a.z, {
        knock: implode || e.voidT > 0 ? 0 : kb,
        noTrigger: depth > 0 && !this.build.flags.has('chainreaction'),
      });
      if (opts.status)
        for (const [k, v] of Object.entries(opts.status))
          if (this.rng.next() < v) this.applyStatus(e, k as StatusKind, 1);
    });
    // push debris
    for (let i = 0; i < this.debris.n; i++) {
      const dx = this.debris.x[i]! - x;
      const dy = this.debris.y[i]! - y;
      const dz = this.debris.z[i]! - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < radius * radius * 2.2 && d2 > 0.01) {
        const k = (radius * 2.5) / Math.sqrt(d2);
        this.debris.vx[i] += dx * k * 0.3;
        this.debris.vy[i] += dy * k * 0.3;
        this.debris.vz[i] += dz * k * 0.3;
        this.debris.heat[i] = Math.max(this.debris.heat[i]!, 0.8);
      }
    }
  }

  chainLightning(
    from: Enemy,
    jumps: number,
    dmg: number,
    src: DamageSrc,
    range = 26,
    spreadCorrode = false,
  ): void {
    let cur = from;
    // reuse one Set per nesting depth (a chain kill can trigger another chain)
    const seen = this.chainSets[this.chainDepth] ?? new Set<number>();
    this.chainDepth++;
    seen.clear();
    seen.add(from.id);
    try {
      for (let j = 0; j < jumps; j++) {
        const next = this.nearestEnemy(cur.pos.x, cur.pos.y, cur.pos.z, range, seen);
        if (!next) break;
        seen.add(next.id);
        this.arcs.push({
          ax: cur.pos.x,
          ay: cur.pos.y,
          az: cur.pos.z,
          bx: next.pos.x,
          by: next.pos.y,
          bz: next.pos.z,
          t: 0,
          color: 0,
          seed: this.rng.next(),
        });
        _a.copy(next.pos).sub(cur.pos).normalize();
        if (spreadCorrode) {
          this.applyStatus(next, 'corrode', 1);
          this.reaction('r_static', next.pos.x, next.pos.y, next.pos.z);
        }
        this.damageEnemy(next, dmg, src, next.pos.x, next.pos.y, next.pos.z, -_a.x, -_a.y, -_a.z, {
          noStatus: true,
          noTrigger: true,
        });
        cur = next;
      }
    } finally {
      this.chainDepth--;
    }
  }

  radialShards(x: number, y: number, z: number, n: number, dmg: number, src = this.triggerSrc): void {
    for (let i = 0; i < n; i++) {
      _a.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).normalize();
      const k = this.proj.spawn(
        x,
        y,
        z,
        _a.x * 160,
        _a.y * 160,
        _a.z * 160,
        0.5,
        dmg,
        0.25,
        PF_CHILD,
        0,
        src,
      );
      if (k >= 0) this.proj.homing[k] = 2.5;
    }
  }

  // ------------------------------------------------------------ triggers

  fireTriggers(on: TriggerOn, x: number, y: number, z: number, power: number): void {
    if (this.triggerDepth > 3) return;
    this.triggerDepth++;
    const pl = this.player;
    for (const t of this.build.triggers) {
      if (t.on !== on) continue;
      if (t.chance !== undefined && this.rng.next() >= t.chance) continue;
      if (t.cd) {
        const c = this.triggerCd.get(t) ?? 0;
        if (c > 0) continue;
        this.triggerCd.set(t, t.cd);
      }
      const gd = this.build.ship.globalDamage;
      switch (t.do) {
        case 'nova': {
          const dmg = on === 'kill' ? power * t.p : 40 * t.p * gd;
          const r = on === 'kill' ? 8 : 10 + t.p * 4;
          this.explode(x, y, z, r, dmg, this.triggerSrc, { color: [1, 0.75, 0.4], depth: this.triggerDepth });
          break;
        }
        case 'chain': {
          const e = this.nearestEnemy(x, y, z, 30);
          if (e) this.chainLightning(e, t.p, Math.max(10, power * 0.4), this.triggerSrc);
          break;
        }
        case 'missiles':
          for (let i = 0; i < t.p; i++) {
            _a.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).normalize();
            const k = this.proj.spawn(
              x,
              y,
              z,
              _a.x * 60,
              _a.y * 60,
              _a.z * 60,
              2.5,
              22 * gd,
              0.35,
              PF_MISSILE,
              5,
              this.triggerSrc,
            );
            if (k >= 0) {
              this.proj.homing[k] = 5;
              this.proj.explode[k] = 4;
            }
          }
          break;
        case 'shield':
          pl.shield = Math.min(pl.maxShield, pl.shield + t.p);
          break;
        case 'heal':
          pl.hull = Math.min(pl.maxHull, pl.hull + t.p);
          break;
        case 'motes':
          this.dropMotes(x, y, z, t.p, 2);
          break;
        case 'lumen':
          this.addLumen(t.p);
          break;
        case 'reload':
          this.build.secondary.cd = 0;
          break;
        case 'mine':
          for (let i = 0; i < t.p; i++) {
            const k = this.proj.spawn(
              pl.pos.x,
              pl.pos.y,
              pl.pos.z,
              this.rng.range(-15, 15),
              this.rng.range(-15, 15),
              this.rng.range(-15, 15),
              8,
              35 * gd,
              0.6,
              PF_MINE,
              4,
              this.triggerSrc,
            );
            if (k >= 0) this.proj.explode[k] = 8;
          }
          break;
        case 'shards':
          this.radialShards(x, y, z, t.p, 10 * gd);
          break;
        case 'freeze':
          this.forEnemiesNear(x, y, z, 14 + t.p * 10, (e) => {
            for (let i = 0; i < 5; i++) this.applyStatus(e, 'cryo', 1);
          });
          this.events.emit('explosion', { x, y, z, radius: 14, r: 0.5, g: 0.9, b: 1, enemy: false });
          break;
        case 'pull':
          this.wells.push({
            x,
            y,
            z,
            vx: 0,
            vy: 0,
            vz: 0,
            radius: 12,
            life: 1.2,
            maxLife: 1.2,
            pull: 40,
            dmg: 2,
            src: this.triggerSrc,
            tick: 0,
            shock: false,
            explode: 0,
            active: true,
          });
          break;
        case 'buff':
          break; // handled in damageMul
        case 'burnAura':
          break; // handled per tick while boosting
        case 'decoy':
          this.decoys.push({ pos: pl.pos.clone(), life: 3 });
          break;
      }
    }
    this.triggerDepth--;
  }

  addLumen(v: number): void {
    const pl = this.player;
    if (pl.flareT > 0) return;
    const before = pl.lumen;
    pl.lumen = Math.min(100, pl.lumen + v * this.build.ship.flareGain);
    if (pl.lumen >= 100 && before < 100) this.events.emit('lumenFull', {});
    if (pl.lumen >= 100 && this.build.flags.has('shieldOverflow'))
      pl.shield = Math.min(pl.maxShield, pl.shield + v);
  }

  // ------------------------------------------------------------ player events

  onDodge(): void {
    this.events.emit('dodge', {});
    const pl = this.player;
    this.fireTriggers('dodge', pl.pos.x, pl.pos.y, pl.pos.z, 0);
  }

  onFlare(): void {
    this.events.emit('flare', { on: true });
    const pl = this.player;
    this.stats.flareKills = 0;
    this.fireTriggers('flare', pl.pos.x, pl.pos.y, pl.pos.z, 0);
  }

  shockwave(): void {
    const pl = this.player;
    const s = this.build.ship.shockwave;
    const r = 20 * s;
    this.events.emit('ability', { kind: 'shockwave' });
    this.explode(pl.pos.x, pl.pos.y, pl.pos.z, r, 25 * s * this.build.ship.globalDamage, this.triggerSrc, {
      color: [0.7, 1, 0.95],
      knock: 45 * s,
    });
    // clear enemy bullets in radius
    const ep = this.eproj;
    for (let i = ep.n - 1; i >= 0; i--) {
      const dx = ep.x[i]! - pl.pos.x;
      const dy = ep.y[i]! - pl.pos.y;
      const dz = ep.z[i]! - pl.pos.z;
      if (dx * dx + dy * dy + dz * dz < r * r * 1.4) {
        this.motes.spawn(ep.x[i]!, ep.y[i]!, ep.z[i]!, 0, 0, 0, 0.5);
        ep.kill(i);
      }
    }
  }

  hurtPlayer(amount: number, cause: string, attacker?: Enemy): void {
    const pl = this.player;
    if (!pl.alive || pl.iframeT > 0 || pl.hurtT > 0) return;
    const bossK = this.boss && !this.boss.dead ? BAL.bossDamage : 1;
    let dmg = amount * BAL.enemyDamage * bossK * this.sectorDmgScale * this.build.ship.damageTaken * (this.heat >= 8 ? 1.25 : 1);
    dmg = Math.max(1, dmg - this.build.ship.armor);
    pl.hurtT = BAL.hitGrace;
    pl.shieldDelayT = this.build.ship.shieldDelay;
    let hullHit = false;
    if (pl.shield > 0) {
      const a = Math.min(pl.shield, dmg);
      pl.shield -= a;
      dmg -= a;
      if (pl.shield <= 0.01) {
        this.events.emit('shieldBreak', {});
        this.fireTriggers('shieldBreak', pl.pos.x, pl.pos.y, pl.pos.z, 0);
      }
    }
    if (dmg > 0) {
      pl.hull -= dmg;
      pl.hullDamageTaken += dmg;
      hullHit = true;
      this.fireTriggers('hurt', pl.pos.x, pl.pos.y, pl.pos.z, dmg);
    }
    this.stats.damageTaken += amount;
    if (attacker?.affixMask && attacker.has('vampiric')) attacker.hp = Math.min(attacker.maxHp, attacker.hp + amount * 2);
    if (attacker?.affixMask && attacker.has('leeching')) pl.lumen = Math.max(0, pl.lumen - 12);
    this.events.emit('hurt', { dmg: amount, hull: hullHit, x: pl.pos.x, y: pl.pos.y, z: pl.pos.z });
    if (pl.hull <= 0) this.killPlayer(cause);
  }

  /** Beams hit at most once per BAL.beamCooldown, so a sweep is a threat, not a one-shot. */
  hurtPlayerBeam(amount: number, cause: string, attacker?: Enemy): void {
    if (this.beamHitT > 0) return;
    const before = this.player.hurtT;
    this.hurtPlayer(amount, cause, attacker);
    if (this.player.hurtT !== before || !this.player.alive) this.beamHitT = BAL.beamCooldown;
  }

  killPlayer(cause: string): void {
    const pl = this.player;
    if (!pl.alive) return;
    pl.alive = false;
    pl.hull = 0;
    pl.deathCause = cause;
    this.events.emit('playerDeath', { cause });
  }

  // ------------------------------------------------------------ projectiles

  private updateProjectiles(dt: number): void {
    const P = this.proj;
    const pl = this.player;
    for (let i = P.n - 1; i >= 0; i--) {
      P.age[i] += dt;
      P.life[i] -= dt;
      const fl = P.flags[i]!;
      if (P.life[i]! <= 0) {
        if (P.explode[i]! > 0)
          this.explode(P.x[i]!, P.y[i]!, P.z[i]!, P.explode[i]!, P.dmg[i]!, P.src[i]!, {
            color: this.colorOf(P.src[i]!),
          });
        if (P.split[i]! > 0 && fl & PF_MISSILE) this.splitProjectile(i, P.x[i]!, P.y[i]!, P.z[i]!);
        if (fl & PF_ECHO) {
          // return as echo toward origin
          const k = P.spawn(
            P.x[i]!,
            P.y[i]!,
            P.z[i]!,
            -P.vx[i]!,
            -P.vy[i]!,
            -P.vz[i]!,
            P.age[i]! * 0.9,
            P.dmg[i]! * 0.7,
            P.size[i]!,
            PF_CHILD,
            5,
            P.src[i]!,
          );
          if (k >= 0) P.pierce[k] = 99;
          const p = this.params[P.src[i]!];
          if (p && p.split > 0) {
            for (let s = 0; s < p.split; s++) {
              _a.set(-P.vx[i]!, -P.vy[i]!, -P.vz[i]!).normalize();
              _a.x += this.rng.range(-0.4, 0.4);
              _a.y += this.rng.range(-0.4, 0.4);
              _a.normalize().multiplyScalar(150);
              const q = P.spawn(
                P.x[i]!,
                P.y[i]!,
                P.z[i]!,
                _a.x,
                _a.y,
                _a.z,
                0.8,
                P.dmg[i]! * 0.5,
                P.size[i]! * 0.7,
                PF_CHILD,
                5,
                P.src[i]!,
              );
              if (q >= 0) P.pierce[q] = 99;
            }
          }
        }
        P.kill(i);
        continue;
      }
      // homing
      const hom = P.homing[i]!;
      if (hom > 0 && P.age[i]! > 0.08) {
        const t = this.nearestEnemy(P.x[i]!, P.y[i]!, P.z[i]!, 70);
        if (t) {
          const sp = Math.hypot(P.vx[i]!, P.vy[i]!, P.vz[i]!);
          _a.set(t.pos.x - P.x[i]!, t.pos.y - P.y[i]!, t.pos.z - P.z[i]!)
            .normalize()
            .multiplyScalar(sp);
          const k = Math.min(1, hom * dt);
          P.vx[i] += (_a.x - P.vx[i]!) * k;
          P.vy[i] += (_a.y - P.vy[i]!) * k;
          P.vz[i] += (_a.z - P.vz[i]!) * k;
          if (fl & PF_MISSILE) {
            const nsp = Math.min(sp * (1 + dt * 1.5), 260);
            const l = Math.hypot(P.vx[i]!, P.vy[i]!, P.vz[i]!) || 1;
            P.vx[i] *= nsp / l;
            P.vy[i] *= nsp / l;
            P.vz[i] *= nsp / l;
          }
        }
      }
      if (fl & PF_MINE) {
        P.vx[i] *= 1 - dt * 2;
        P.vy[i] *= 1 - dt * 2;
        P.vz[i] *= 1 - dt * 2;
      }
      const x0 = P.x[i]!;
      const y0 = P.y[i]!;
      const z0 = P.z[i]!;
      const x1 = x0 + P.vx[i]! * dt;
      const y1 = y0 + P.vy[i]! * dt;
      const z1 = z0 + P.vz[i]! * dt;
      P.x[i] = x1;
      P.y[i] = y1;
      P.z[i] = z1;
      // out of arena
      if (x1 * x1 + y1 * y1 + z1 * z1 > (this.arenaRadius + 150) ** 2) {
        P.kill(i);
        continue;
      }
      // Mines: proximity
      if (fl & PF_MINE) {
        if (P.age[i]! < 0.4) continue;
        let trig = false;
        this.forEnemiesNear(x1, y1, z1, P.explode[i]! * 0.6, (e) => {
          if (e.def.role === 'inert') return;
          trig = true;
          return true;
        });
        if (trig) {
          this.explode(x1, y1, z1, P.explode[i]!, P.dmg[i]!, P.src[i]!, { color: this.colorOf(P.src[i]!) });
          P.kill(i);
        }
        continue;
      }
      // segment vs enemies
      const mx = (x0 + x1) * 0.5;
      const my = (y0 + y1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      const segLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const sz = P.size[i]!;
      let hitE: Enemy | null = null;
      let bestT = 2;
      const cnt = this.hash.query(mx, my, mz, segLen * 0.5 + sz + 6, this.pbuf);
      for (let k = 0; k < cnt; k++) {
        const e = this.hIndex[this.pbuf[k]!];
        if (!e || !e.alive || e.id === P.lastHit[i] || !e.revealed) continue;
        const t = segSphere(x0, y0, z0, x1, y1, z1, e.pos.x, e.pos.y, e.pos.z, e.radius * 1.15 + sz + 0.9);
        if (t >= 0 && t < bestT) {
          bestT = t;
          hitE = e;
        }
      }
      if (!hitE) continue;
      const e = hitE;
      const hx = x0 + (x1 - x0) * bestT;
      const hy = y0 + (y1 - y0) * bestT;
      const hz = z0 + (z1 - z0) * bestT;
      const vl = Math.hypot(P.vx[i]!, P.vy[i]!, P.vz[i]!) || 1;
      const nx = -P.vx[i]! / vl;
      const ny = -P.vy[i]! / vl;
      const nz = -P.vz[i]! / vl;
      P.lastHit[i] = e.id;
      const src = P.src[i]!;
      const dmg = P.dmg[i]!;
      const kinetic = !!(fl & PF_KINETIC);
      if (P.explode[i]! > 0 && P.pierce[i]! <= 0) {
        this.damageEnemy(e, dmg * 0.5, src, hx, hy, hz, nx, ny, nz, { kinetic });
        this.explode(hx, hy, hz, P.explode[i]!, dmg * 0.7, src, { color: this.colorOf(src) });
        if (P.split[i]! > 0) this.splitProjectile(i, hx, hy, hz);
        P.kill(i);
        continue;
      }
      this.damageEnemy(e, dmg, src, hx, hy, hz, nx, ny, nz, { kinetic });
      if (P.split[i]! > 0 && !(fl & PF_CHILD && !this.build.flags.has('prismatic') && P.age[i]! > 5))
        this.splitProjectile(i, hx, hy, hz);
      if (P.ricochet[i]! > 0) {
        P.ricochet[i]--;
        const t = this.nearestEnemy(hx, hy, hz, 60, e.id);
        if (t) {
          _a.set(t.pos.x - hx, t.pos.y - hy, t.pos.z - hz)
            .normalize()
            .multiplyScalar(vl);
          P.vx[i] = _a.x;
          P.vy[i] = _a.y;
          P.vz[i] = _a.z;
          P.x[i] = hx;
          P.y[i] = hy;
          P.z[i] = hz;
          P.life[i] = Math.max(P.life[i]!, 0.6);
          if (this.params[src]?.split && P.split[i]! === 0 && this.weaponsByIndex[src]?.evolved)
            this.splitProjectile(i, hx, hy, hz, 1);
          continue;
        }
      }
      if (P.pierce[i]! > 0) {
        P.pierce[i]--;
        P.dmg[i] *= 0.85;
        continue;
      }
      P.kill(i);
    }
    void pl;
  }

  private splitProjectile(i: number, x: number, y: number, z: number, forceN = 0): void {
    const P = this.proj;
    const n = forceN || P.split[i]!;
    const vl = Math.hypot(P.vx[i]!, P.vy[i]!, P.vz[i]!) || 100;
    const prism = this.build.flags.has('prismatic');
    for (let s = 0; s < n; s++) {
      _a.set(P.vx[i]!, P.vy[i]!, P.vz[i]!).normalize();
      _b.set(this.rng.next() - 0.5, this.rng.next() - 0.5, this.rng.next() - 0.5).normalize();
      _a.addScaledVector(_b, 0.9)
        .normalize()
        .multiplyScalar(vl * 0.8);
      const k = P.spawn(
        x,
        y,
        z,
        _a.x,
        _a.y,
        _a.z,
        0.45,
        P.dmg[i]! * (prism ? 1 : 0.45),
        P.size[i]! * 0.7,
        PF_CHILD | (P.flags[i]! & PF_KINETIC),
        0,
        P.src[i]!,
      );
      if (k >= 0) {
        P.lastHit[k] = P.lastHit[i]!;
        P.ricochet[k] = P.ricochet[i]! > 0 ? 1 : 0;
      }
    }
    P.split[i] = 0;
  }

  colorOf(src: number): [number, number, number] {
    const w = src >= 0 ? this.weaponsByIndex[src] : null;
    if (!w) return DEFAULT_COLOR;
    const hex = w.color;
    let c = this.colorCache.get(hex);
    if (!c) this.colorCache.set(hex, (c = hexToRgb(hex)));
    return c;
  }

  private updateEnemyProjectiles(dt: number): void {
    const P = this.eproj;
    const pl = this.player;
    const pr = pl.radius;
    const gr = this.build.ship.grazeRadius;
    const stasis = pl.stasisT > 0;
    const stR2 = (34 * this.build.ship.stasis) ** 2;
    for (let i = P.n - 1; i >= 0; i--) {
      P.life[i] -= dt;
      P.age[i] += dt;
      if (P.life[i]! <= 0) {
        P.kill(i);
        continue;
      }
      let k = 1;
      const x0 = P.x[i]!;
      const y0 = P.y[i]!;
      const z0 = P.z[i]!;
      const dxp = x0 - pl.pos.x;
      const dyp = y0 - pl.pos.y;
      const dzp = z0 - pl.pos.z;
      const d2 = dxp * dxp + dyp * dyp + dzp * dzp;
      if (stasis && d2 < stR2) k = 0.15;
      // homing enemy orbs (boss)
      if (P.homing[i]! > 0 && P.age[i]! < 2.5) {
        const sp = Math.hypot(P.vx[i]!, P.vy[i]!, P.vz[i]!);
        _a.set(-dxp, -dyp, -dzp).normalize().multiplyScalar(sp);
        const h = Math.min(1, P.homing[i]! * dt);
        P.vx[i] += (_a.x - P.vx[i]!) * h;
        P.vy[i] += (_a.y - P.vy[i]!) * h;
        P.vz[i] += (_a.z - P.vz[i]!) * h;
      }
      const x1 = x0 + P.vx[i]! * dt * k;
      const y1 = y0 + P.vy[i]! * dt * k;
      const z1 = z0 + P.vz[i]! * dt * k;
      P.x[i] = x1;
      P.y[i] = y1;
      P.z[i] = z1;
      if (!pl.alive) continue;
      const sz = P.size[i]!;
      const t = segSphere(x0, y0, z0, x1, y1, z1, pl.pos.x, pl.pos.y, pl.pos.z, pr + sz * 0.6);
      if (t >= 0) {
        if (pl.iframeT > 0) {
          // dodged through: wraith crit buff
          if (this.build.flags.has('wraith')) pl.critBuff = true;
          continue;
        }
        this.hurtPlayer(P.dmg[i]!, P.kind[i] === 4 ? 'Mine' : 'Enemy fire');
        P.kill(i);
        continue;
      }
      // graze
      if (!(P.flags[i]! & PF_GRAZED)) {
        const tg = segSphere(x0, y0, z0, x1, y1, z1, pl.pos.x, pl.pos.y, pl.pos.z, gr);
        if (tg >= 0) {
          P.flags[i] |= PF_GRAZED;
          this.onGraze(x1, y1, z1);
        }
      }
      // Sentinel pods block shots
      if (this.blockers.length) {
        for (let b = 0; b < this.blockers.length; b += 4) {
          const bx = this.blockers[b]!;
          const by = this.blockers[b + 1]!;
          const bz = this.blockers[b + 2]!;
          const br = this.blockers[b + 3]!;
          const dx = x1 - bx;
          const dy = y1 - by;
          const dz = z1 - bz;
          if (dx * dx + dy * dy + dz * dz < (br + sz) ** 2) {
            this.events.emit('block', { x: x1, y: y1, z: z1 });
            P.kill(i);
            break;
          }
        }
      }
    }
  }

  /** flattened [x,y,z,r] of things that block enemy shots this tick */
  blockers: number[] = [];

  onGraze(x: number, y: number, z: number): void {
    const s = this.build.ship;
    this.stats.grazes++;
    this.stats.sectorGrazes++;
    const mul = this.build.flags.has('moth') ? 2 : 1;
    this.addLumen(2.2 * s.grazeGain * mul);
    this.player.light += 0.5 * s.lightGain;
    if (this.build.flags.has('grazeReload')) this.build.secondary.cd = 0;
    if (this.build.flags.has('threadneedle')) this.player.buffT = 1;
    this.events.emit('graze', { x, y, z, count: this.stats.grazes });
    this.fireTriggers('graze', x, y, z, 0);
  }

  spawnEnemyShot(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    dmg: number,
    kind: number,
    size = 0.6,
    life = 6,
  ): number {
    const heatSpeed = (this.heat >= 2 ? 1.15 : 1) * BAL.enemyShotSpeed;
    const i = this.eproj.spawn(
      x,
      y,
      z,
      vx * heatSpeed,
      vy * heatSpeed,
      vz * heatSpeed,
      life,
      dmg,
      size,
      PF_ENEMY,
      kind,
      -1,
    );
    return i;
  }

  // ------------------------------------------------------------ wells, motes, debris

  private updateWells(dt: number): void {
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i]!;
      w.life -= dt;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.z += w.vz * dt;
      w.vx *= 1 - dt * 1.5;
      w.vy *= 1 - dt * 1.5;
      w.vz *= 1 - dt * 1.5;
      w.tick -= dt;
      const doTick = w.tick <= 0;
      if (doTick) w.tick = 0.2;
      const pull = w.pull * (this.build.flags.has('eventhorizon') ? 1.4 : 1);
      this.forEnemiesNear(w.x, w.y, w.z, w.radius, (e) => {
        if (e.def.role === 'boss' || e.def.role === 'part' || e.def.role === 'turret') {
          if (doTick) this.damageEnemy(e, w.dmg, w.src, e.pos.x, e.pos.y, e.pos.z, 0, 1, 0, { knock: 0 });
          return;
        }
        _a.set(w.x - e.pos.x, w.y - e.pos.y, w.z - e.pos.z);
        const d = _a.length() || 1;
        _a.multiplyScalar(1 / d);
        e.vel.addScaledVector(_a, pull * dt * (1.2 - d / (w.radius + e.radius)));
        e.vel.multiplyScalar(1 - dt * 2);
        if (doTick) {
          this.damageEnemy(e, w.dmg, w.src, e.pos.x, e.pos.y, e.pos.z, _a.x, _a.y, _a.z, {
            knock: 0,
            noTrigger: true,
          });
          if (w.shock && this.rng.next() < 0.3) this.applyStatus(e, 'shock', 1, w.dmg);
        }
      });
      // also suck in enemy bullets a little (singularity eats shots)
      if (w.pull > 80) {
        const P = this.eproj;
        for (let k = P.n - 1; k >= 0; k--) {
          const dx = P.x[k]! - w.x;
          const dy = P.y[k]! - w.y;
          const dz = P.z[k]! - w.z;
          if (dx * dx + dy * dy + dz * dz < w.radius * w.radius * 0.3) P.kill(k);
        }
      }
      if (w.life <= 0) {
        if (w.explode > 0)
          this.explode(w.x, w.y, w.z, w.explode, w.dmg * 12, w.src, { color: [0.8, 0.5, 1], implode: true });
        this.wells.splice(i, 1);
      }
    }
  }

  private updateMotes(dt: number): void {
    const M = this.motes;
    const pl = this.player;
    const s = this.build.ship;
    const mag = s.magnet;
    const mag2 = mag * mag;
    const lodestar = this.build.flags.has('lodestar');
    for (let i = M.n - 1; i >= 0; i--) {
      M.age[i] += dt;
      const dx = pl.pos.x - M.x[i]!;
      const dy = pl.pos.y - M.y[i]!;
      const dz = pl.pos.z - M.z[i]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (pl.alive && (d2 < mag2 || M.age[i]! > 9) && M.age[i]! > 0.25) {
        const d = Math.sqrt(d2) || 1;
        // spiral in: radial pull + tangential swirl
        const pullK = (90 + (mag - d) * 6) / d;
        M.vx[i] += dx * pullK * dt;
        M.vy[i] += dy * pullK * dt;
        M.vz[i] += dz * pullK * dt;
        const sw = lodestar ? 60 : 30;
        M.vx[i] += (-dz / d) * sw * dt;
        M.vz[i] += (dx / d) * sw * dt;
        M.vx[i] *= 1 - dt * 2.5;
        M.vy[i] *= 1 - dt * 2.5;
        M.vz[i] *= 1 - dt * 2.5;
        if (d < 2.2) {
          this.collectMote(i);
          continue;
        }
      } else {
        M.vx[i] *= 1 - dt * 1.8;
        M.vy[i] *= 1 - dt * 1.8;
        M.vz[i] *= 1 - dt * 1.8;
      }
      M.x[i] += M.vx[i]! * dt;
      M.y[i] += M.vy[i]! * dt;
      M.z[i] += M.vz[i]! * dt;
    }
  }

  private collectMote(i: number): void {
    const M = this.motes;
    const pl = this.player;
    const s = this.build.ship;
    const v = M.value[i]! * s.lightGain;
    pl.light += v;
    pl.lightTotal += v;
    const kindle = this.build.flags.has('kindle') ? 1.15 : 1;
    this.addLumen(v * 0.9 * kindle);
    this.moteCombo++;
    this.moteComboT = 0.6;
    this.events.emit('pickup', { x: M.x[i]!, y: M.y[i]!, z: M.z[i]!, value: v, combo: this.moteCombo });
    if (this.build.flags.has('moteBombs') && this.rng.next() < 0.25)
      this.explode(M.x[i]!, M.y[i]!, M.z[i]!, 6, 12 * s.globalDamage, this.triggerSrc, {
        color: [1, 0.95, 0.6],
      });
    this.fireTriggers('pickup', M.x[i]!, M.y[i]!, M.z[i]!, 0);
    M.kill(i);
  }

  private updateDebris(dt: number): void {
    const D = this.debris;
    const homing = this.build.flags.has('debrisHoming');
    for (let i = D.n - 1; i >= 0; i--) {
      D.life[i] -= dt;
      if (D.life[i]! <= 0) {
        D.kill(i);
        continue;
      }
      D.vx[i] *= 1 - dt * 0.6;
      D.vy[i] *= 1 - dt * 0.6;
      D.vz[i] *= 1 - dt * 0.6;
      D.ang[i] += D.spin[i]! * dt;
      D.heat[i] = Math.max(0, D.heat[i]! - dt * 0.5);
      if (homing && D.dmg[i]! > 0) {
        const t = this.nearestEnemy(D.x[i]!, D.y[i]!, D.z[i]!, 40);
        if (t) {
          _a.set(t.pos.x - D.x[i]!, t.pos.y - D.y[i]!, t.pos.z - D.z[i]!).normalize();
          D.vx[i] += _a.x * 120 * dt;
          D.vy[i] += _a.y * 120 * dt;
          D.vz[i] += _a.z * 120 * dt;
          D.heat[i] = Math.max(D.heat[i]!, 0.6);
        }
      }
      D.x[i] += D.vx[i]! * dt;
      D.y[i] += D.vy[i]! * dt;
      D.z[i] += D.vz[i]! * dt;
      // fast debris damages enemies
      const sp2 = D.vx[i]! ** 2 + D.vy[i]! ** 2 + D.vz[i]! ** 2;
      if (sp2 > 400 && (i & 3) === ((this.time * 60) & 3)) {
        let hit: Enemy | null = null;
        this.forEnemiesNear(D.x[i]!, D.y[i]!, D.z[i]!, D.scale[i]!, (e) => {
          if (e.def.role === 'inert') return;
          hit = e;
          return true;
        });
        if (hit) {
          const e = hit as Enemy;
          const dmg = (D.dmg[i]! > 0 ? D.dmg[i]! : 3) * this.build.ship.debrisDamage * Math.sqrt(sp2) * 0.05;
          this.damageEnemy(e, dmg, this.triggerSrc, D.x[i]!, D.y[i]!, D.z[i]!, 0, 1, 0, {
            kinetic: true,
            noTrigger: true,
            noStatus: true,
            knock: 2,
          });
          D.vx[i] *= -0.3;
          D.vy[i] *= -0.3;
          D.vz[i] *= -0.3;
        }
      }
    }
  }

  /** Request an attack token (prevents unfair simultaneous attacks). */
  takeToken(e: Enemy): boolean {
    if (e.hasToken) return true;
    if (this.tokens >= this.maxTokens) return false;
    e.hasToken = true;
    this.tokens++;
    return true;
  }

  releaseToken(e: Enemy): void {
    if (!e.hasToken) return;
    e.hasToken = false;
    this.tokens--;
  }

  addTelegraph(t: Omit<Telegraph, 't'>): Telegraph {
    const tg = { ...t, t: 0 };
    this.telegraphs.push(tg);
    this.events.emit('telegraph', { x: t.ax, y: t.ay, z: t.az, kind: t.kind });
    return tg;
  }

  liveEnemyCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.def.role !== 'inert' && e.def.role !== 'part') n++;
    return n;
  }
}

const DEFAULT_COLOR: [number, number, number] = [1, 0.7, 0.4];

/** Segment-sphere intersection. Returns t in [0,1] of first contact, or -1. */
export function segSphere(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const fz = z0 - cz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Ray vs sphere: distance along ray or -1. dir must be normalized. */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

export const _unused = _c;
