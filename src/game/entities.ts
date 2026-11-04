import { Quaternion, Vector3 } from 'three';
import type { EnemyDef } from './types';
import type { EliteMod } from '../data/enemies';
import type { MeshKind } from '../render/meshes';


export class Enemy {
  id = 0;
  def!: EnemyDef;
  alive = false;
  dying = 0; // >0 while playing death dissolve
  pos = new Vector3();
  prev = new Vector3();
  vel = new Vector3();
  quat = new Quaternion();
  prevQuat = new Quaternion();
  hp = 1;
  maxHp = 1;
  shield = 0;
  maxShield = 0;
  armor = 0;
  radius = 1;
  scale = 1;
  mesh: MeshKind = 'hushSpike';
  tint = new Vector3(1, 1, 1);
  elite: EliteMod | null = null;
  speedMul = 1;
  fireMul = 1;
  hpMul = 1;
  dmgMul = 1;
  // AI
  state = 0;
  timer = 0;
  timer2 = 0;
  orbitDir = 1;
  hasToken = false;
  aimDir = new Vector3(0, 0, -1);
  target = new Vector3();
  spin = 0;
  revealed = true;
  // statuses
  burn = 0; // stacks
  burnT = 0;
  cryo = 0;
  cryoT = 0;
  frozenT = 0;
  shockT = 0;
  corrode = 0;
  corrodeT = 0;
  voidT = 0;
  radiantT = 0;
  slowT = 0; // stasis
  // visuals
  flash = 0;
  cloak = 0;
  emissive = 0;
  wobble = 0;
  hitCdHalo = 0;
  // linkage (boss parts)
  parent: Enemy | null = null;
  offset = new Vector3();
  invuln = false;
  partIndex = -1;
  bossKey = '';
  shieldedBy = 0; // >0 when a shielder protects it
  lastSrc = -1;
  spawnT = 0;
  /** staged break-apart for heavy ships: 0 intact, 1 cracked, 2 venting */
  breakStage = 0;
  isBossCore = false;
  dmgTaken = 1;

  /** ids come from the owning World so a seeded run always numbers its enemies the same way */
  reset(def: EnemyDef, id: number): this {
    this.id = id;
    this.def = def;
    this.alive = true;
    this.dying = 0;
    this.vel.set(0, 0, 0);
    this.quat.identity();
    this.hp = this.maxHp = def.hp;
    this.shield = this.maxShield = 0;
    this.armor = def.armor ?? 0;
    this.radius = def.radius;
    this.scale = def.scale;
    this.mesh = def.mesh;
    this.elite = null;
    this.speedMul = this.fireMul = this.hpMul = this.dmgMul = 1;
    this.state = 0;
    this.timer = 0;
    this.timer2 = 0;
    this.orbitDir = 1;
    this.hasToken = false;
    this.spin = 0;
    this.revealed = def.role !== 'mimic';
    this.burn = this.burnT = this.cryo = this.cryoT = this.frozenT = this.shockT = 0;
    this.corrode = this.corrodeT = this.voidT = this.radiantT = this.slowT = 0;
    this.flash = this.cloak = this.emissive = this.wobble = this.hitCdHalo = 0;
    this.parent = null;
    this.offset.set(0, 0, 0);
    this.invuln = false;
    this.partIndex = -1;
    this.bossKey = '';
    this.shieldedBy = 0;
    this.lastSrc = -1;
    this.breakStage = 0;
    this.spawnT = 0.6;
    this.isBossCore = false;
    this.dmgTaken = 1;
    return this;
  }

  /** Heavy hulls (carriers, bombers, shielders) break apart in stages. */
  get heavy(): boolean {
    return this.def.threat >= 5 && this.def.role !== 'boss' && this.def.role !== 'part';
  }

  get frozen(): boolean {
    return this.frozenT > 0;
  }
}

/** Player + enemy projectiles in SoA typed arrays. */
export const PF_ENEMY = 1;
export const PF_MISSILE = 2;
export const PF_MINE = 4;
export const PF_ECHO = 8;
export const PF_CHILD = 16;
export const PF_GRAZED = 32;
export const PF_WELL = 64;
export const PF_KINETIC = 128;

export class Projectiles {
  readonly cap: number;
  n = 0;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  life: Float32Array;
  age: Float32Array;
  dmg: Float32Array;
  size: Float32Array;
  pierce: Int16Array;
  homing: Float32Array;
  ricochet: Int16Array;
  split: Int16Array;
  explode: Float32Array;
  src: Int16Array;
  flags: Uint16Array;
  kind: Uint8Array;
  lastHit: Int32Array;
  ox: Float32Array; // origin (echo)
  oy: Float32Array;
  oz: Float32Array;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.dmg = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.pierce = new Int16Array(cap);
    this.homing = new Float32Array(cap);
    this.ricochet = new Int16Array(cap);
    this.split = new Int16Array(cap);
    this.explode = new Float32Array(cap);
    this.src = new Int16Array(cap);
    this.flags = new Uint16Array(cap);
    this.kind = new Uint8Array(cap);
    this.lastHit = new Int32Array(cap);
    this.ox = new Float32Array(cap);
    this.oy = new Float32Array(cap);
    this.oz = new Float32Array(cap);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    dmg: number,
    size: number,
    flags: number,
    kind: number,
    src: number,
  ): number {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.age[i] = 0;
    this.dmg[i] = dmg;
    this.size[i] = size;
    this.flags[i] = flags;
    this.kind[i] = kind;
    this.src[i] = src;
    this.pierce[i] = 0;
    this.homing[i] = 0;
    this.ricochet[i] = 0;
    this.split[i] = 0;
    this.explode[i] = 0;
    this.lastHit[i] = 0;
    this.ox[i] = x;
    this.oy[i] = y;
    this.oz[i] = z;
    return i;
  }

  /** swap-remove */
  kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j]!;
    this.y[i] = this.y[j]!;
    this.z[i] = this.z[j]!;
    this.vx[i] = this.vx[j]!;
    this.vy[i] = this.vy[j]!;
    this.vz[i] = this.vz[j]!;
    this.life[i] = this.life[j]!;
    this.age[i] = this.age[j]!;
    this.dmg[i] = this.dmg[j]!;
    this.size[i] = this.size[j]!;
    this.pierce[i] = this.pierce[j]!;
    this.homing[i] = this.homing[j]!;
    this.ricochet[i] = this.ricochet[j]!;
    this.split[i] = this.split[j]!;
    this.explode[i] = this.explode[j]!;
    this.src[i] = this.src[j]!;
    this.flags[i] = this.flags[j]!;
    this.kind[i] = this.kind[j]!;
    this.lastHit[i] = this.lastHit[j]!;
    this.ox[i] = this.ox[j]!;
    this.oy[i] = this.oy[j]!;
    this.oz[i] = this.oz[j]!;
  }

  clear(): void {
    this.n = 0;
  }
}

/** Light motes. */
export class Motes {
  readonly cap: number;
  n = 0;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  value: Float32Array;
  age: Float32Array;
  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.value = new Float32Array(cap);
    this.age = new Float32Array(cap);
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, value: number): void {
    if (this.n >= this.cap) {
      // merge into a random existing mote so Light is never lost
      this.value[(this.n * 7919) % this.cap] += value;
      return;
    }
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.value[i] = value;
    this.age[i] = 0;
  }
  kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j]!;
    this.y[i] = this.y[j]!;
    this.z[i] = this.z[j]!;
    this.vx[i] = this.vx[j]!;
    this.vy[i] = this.vy[j]!;
    this.vz[i] = this.vz[j]!;
    this.value[i] = this.value[j]!;
    this.age[i] = this.age[j]!;
  }
}

/** Physics debris chunks (fractured enemies/asteroids). */
export class Debris {
  readonly cap: number;
  n = 0;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  ax: Float32Array; // rotation axis
  ay: Float32Array;
  az: Float32Array;
  ang: Float32Array;
  spin: Float32Array;
  scale: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  heat: Float32Array; // emissive burn
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  dmg: Float32Array;
  constructor(cap: number) {
    this.cap = cap;
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.ax = f();
    this.ay = f();
    this.az = f();
    this.ang = f();
    this.spin = f();
    this.scale = f();
    this.life = f();
    this.maxLife = f();
    this.heat = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.dmg = f();
  }
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    scale: number,
    life: number,
    heat: number,
    r: number,
    g: number,
    b: number,
    rnd: () => number,
    dmg = 0,
  ): void {
    let i: number;
    if (this.n >= this.cap) {
      // recycle oldest-ish
      i = Math.floor(rnd() * this.cap);
    } else i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    const ax = rnd() - 0.5;
    const ay = rnd() - 0.5;
    const az = rnd() - 0.5;
    const l = Math.hypot(ax, ay, az) || 1;
    this.ax[i] = ax / l;
    this.ay[i] = ay / l;
    this.az[i] = az / l;
    this.ang[i] = rnd() * 6.28;
    this.spin[i] = (rnd() - 0.5) * 14;
    this.scale[i] = scale;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.heat[i] = heat;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.dmg[i] = dmg;
  }
  kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'ax', 'ay', 'az', 'ang', 'spin', 'scale', 'life', 'maxLife', 'heat', 'r', 'g', 'b', 'dmg'] as const) {
      this[k][i] = this[k][j]!;
    }
  }
}

export interface Telegraph {
  kind: 'line' | 'ring' | 'sphere' | 'cone';
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
  t: number;
  dur: number;
  owner: number; // enemy id
}

export interface ArcFx {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  t: number;
  color: number; // 0 player shock, 1 enemy
  seed: number;
}

export interface BeamFx {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  width: number;
  r: number;
  g: number;
  b: number;
  enemy: boolean;
}

export interface Well {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  life: number;
  maxLife: number;
  pull: number;
  dmg: number;
  src: number;
  tick: number;
  shock: boolean;
  explode: number;
  active: boolean;
}

export interface Drone {
  kind: 'interceptor' | 'wisp' | 'mirror' | 'layer';
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  quat: Quaternion;
  cd: number;
  src: number;
  phase: number;
  target: number; // enemy id
}

export interface Decoy {
  pos: Vector3;
  life: number;
}
