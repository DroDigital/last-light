import { Rng } from '../core/rng';
import { BAL } from '../data/balance';
import { Hazard } from './hazards';
import { SECTORS, type SectorDef } from '../data/world';
import { ENEMY_BY_ID } from '../data/enemies';
import { RARITY, rollRarity, type Rarity } from '../data/affixes';
import type { World } from './world';
import type { Enemy } from './entities';
import { Vector3 } from 'three';
import { BossController } from './bosses';

export const ROOM_RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythical'] as const;
export type RoomRarity = (typeof ROOM_RARITIES)[number];
export const ROOM_TIER: Record<RoomRarity, { color: string; budget: number; strength: number; damage: number; tokens: number }> = {
  common: { color: '#b8c5d1', budget: 1, strength: 1, damage: 1, tokens: 0 },
  rare: { color: '#66cfff', budget: 1.16, strength: 1.08, damage: 1.04, tokens: 1 },
  epic: { color: '#c58cff', budget: 1.34, strength: 1.16, damage: 1.08, tokens: 2 },
  legendary: { color: '#ffbe69', budget: 1.55, strength: 1.25, damage: 1.13, tokens: 3 },
  mythical: { color: '#ff769e', budget: 1.8, strength: 1.35, damage: 1.18, tokens: 4 },
};

export type NodeType = 'combat' | 'elite' | 'derelict' | 'shop' | 'event' | 'forge' | 'rest' | 'rift' | 'boss' | 'start';

export function isThreatRoom(type: NodeType): boolean {
  return type === 'combat' || type === 'elite' || type === 'derelict' || type === 'rift';
}

export interface MapNode {
  id: number;
  row: number;
  col: number;
  type: NodeType;
  rarity: RoomRarity;
  links: number[];
  x: number;
  y: number;
  z: number;
  visited: boolean;
  seed: number;
}

export interface SectorMap {
  sector: number;
  nodes: MapNode[];
  rows: number;
}

export const NODE_INFO: Record<NodeType, { name: string; desc: string; icon: string }> = {
  start: { name: 'Arrival', desc: 'Where you warped in.', icon: '◇' },
  combat: { name: 'Combat', desc: 'A wave arena. Reward: upgrade draft, Light.', icon: '✶' },
  elite: { name: 'Elite', desc: 'Tougher arena with elite modifiers. Reward: guaranteed rare.', icon: '✷' },
  derelict: { name: 'Derelict', desc: 'Relight a wreck\'s beacons while ambushed. Reward: loot, lore.', icon: '⌬' },
  shop: { name: 'Shop', desc: 'Ash\'s trading post. Spend Light.', icon: '⛁' },
  event: { name: 'Event', desc: 'Something strange in the dark.', icon: '?' },
  forge: { name: 'Forge', desc: 'Fuse, upgrade or reroll items.', icon: '⚒' },
  rest: { name: 'Rest', desc: 'Repair the hull or train a weapon.', icon: '☾' },
  rift: { name: 'Rift', desc: 'Optional high-risk challenge. Reward: legendary + a curse.', icon: '✺' },
  boss: { name: 'Dying Star', desc: 'The sector boss guards the star.', icon: '☀' },
};

/**
 * Deterministic branching map: MAP_ROWS rows (choice rows + the boss). Long
 * enough that a build has room to come together before the star: about five
 * fights, an elite, a shop and a rest on any path.
 */
export const MAP_ROWS = 8;
const ROW_Z = 28;
export function generateMap(seed: number, sector: number, opts: { rifts: boolean; heat: number }): SectorMap {
  const rng = new Rng(seed);
  const rowsN = MAP_ROWS;
  const nodes: MapNode[] = [];
  let id = 0;
  const rowNodes: MapNode[][] = [];
  const rift = opts.rifts ? ([['rift', 1.2]] as [NodeType, number][]) : [];
  const rest = opts.heat >= 7 ? 0.8 : 2;
  // early rows teach and feed the build, the middle diversifies, the run-in to the star is dangerous
  const early: [NodeType, number][] = [['combat', 4], ['event', 2], ['derelict', 1.2], ['shop', 1]];
  const mid: [NodeType, number][] = [['combat', 3], ['elite', 1.6], ['shop', 1.6], ['forge', 1.3], ['event', 2], ['rest', 1], ['derelict', 1], ...rift];
  const late: [NodeType, number][] = [['combat', 3], ['elite', 2], ['rest', rest], ['shop', 1.4], ['forge', 1], ['derelict', 1], ...rift];
  const weights: Record<number, [NodeType, number][]> = { 0: [['combat', 1]], 1: early, 2: early, 3: mid, 4: mid, 5: late, 6: late };
  for (let r = 0; r < rowsN; r++) {
    const count = r === rowsN - 1 ? 1 : r === 0 ? 3 : 3 + rng.int(0, 1);
    const row: MapNode[] = [];
    for (let c = 0; c < count; c++) {
      let type: NodeType;
      if (r === rowsN - 1) type = 'boss';
      else {
        const w = weights[r]!;
        type = w[rng.weighted(w.map((x) => x[1]))]![0];
      }
      const spread = count > 1 ? (c / (count - 1) - 0.5) * 2 : 0;
      const n: MapNode = {
        id: id++, row: r, col: c, type,
        rarity: r === 0 ? 'common' : ROOM_RARITIES[rng.weighted([54, 25, 13, 6, 2])]!, links: [],
        x: spread * 34 + rng.range(-4, 4), y: rng.range(-8, 8), z: -r * ROW_Z + 40,
        visited: false, seed: Math.floor(rng.next() * 1e9),
      };
      row.push(n);
      nodes.push(n);
    }
    rowNodes.push(row);
  }
  // guarantees: a shop early-ish, a rest and an elite before the star
  const kept = new Set<NodeType>();
  const ensure = (t: NodeType, rows: number[]) => {
    kept.add(t);
    if (nodes.some((n) => n.type === t && rows.includes(n.row))) return;
    // never overwrite another guaranteed node type
    const pool = nodes.filter((n) => rows.includes(n.row) && !kept.has(n.type));
    if (pool.length) pool[rng.int(0, pool.length - 1)]!.type = t;
  };
  ensure('shop', [2, 3, 4]);
  ensure('rest', [5, 6]);
  ensure('elite', [3, 4, 5]);
  for (const node of nodes) if (!isThreatRoom(node.type)) node.rarity = 'common';
  // Each node offers at least two routes until the boss; every node has an incoming link.
  for (let r = 0; r < rowsN - 1; r++) {
    const a = rowNodes[r]!;
    const b = rowNodes[r + 1]!;
    for (const n of a) {
      const sorted = [...b].sort((p, q) => Math.abs(p.x - n.x) - Math.abs(q.x - n.x));
      n.links.push(sorted[0]!.id);
      if (sorted[1]) n.links.push(sorted[1].id);
      if (sorted[2] && rng.chance(0.3)) n.links.push(sorted[2].id);
    }
    for (const m of b) {
      if (!a.some((n) => n.links.includes(m.id))) {
        const nearest = [...a].sort((p, q) => Math.abs(p.x - m.x) - Math.abs(q.x - m.x))[0]!;
        nearest.links.push(m.id);
      }
    }
  }
  return { sector, nodes, rows: rowsN };
}

export type EncounterKind = 'combat' | 'elite' | 'derelict' | 'rift' | 'boss' | 'endless' | 'ambush' | 'tutorial';

export interface Beacon {
  pos: Vector3;
  progress: number;
  lit: boolean;
}

/**
 * Combat director: authored formations mixed procedurally, paced as
 * build-up -> peak -> breather -> peak. Adapts to build power and health.
 */
export class Director {
  kind: EncounterKind;
  sector: SectorDef;
  sectorIdx: number;
  budget: number;
  spent = 0;
  time = 0;
  done = false;
  cleared = false;
  elitesLeft = 0;
  hazard: Hazard | null = null;
  wave = 0;
  private spawnCd = 1.5;
  private rng: Rng;
  beacons: Beacon[] = [];
  boss: BossController | null = null;
  endlessWave = 0;
  private calm = 0;
  intensity = 0;
  private density = 1;
  private straggleT = 0;
  private lastKills = 0;
  private noKillT = 0;
  /** how long the last few hostiles have been sitting far away */
  private farT = 0;
  /** Act II: countdown to the next warp ambush */
  private ambushT = 14;

  /**
   * @param depth row of the sector map (0 = first jump). Fights get tougher row by
   * row, so the long sectors keep pace with the build.
   */
  constructor(kind: EncounterKind, sectorIdx: number, seed: number, private w: World, heat: number, depth = 0, rarity: RoomRarity = 'common') {
    this.kind = kind;
    this.sectorIdx = sectorIdx;
    this.sector = SECTORS[Math.min(sectorIdx, SECTORS.length - 1)]!;
    this.rng = new Rng(seed);
    const depthK = 1 + depth * BAL.perRow;
    const base = (BAL.budgetBase + sectorIdx * BAL.budgetPerSector) * depthK;
    const heatMul = 1 + (heat >= 9 ? 0.25 : 0);
    // Tutorial and bosses retain their authored pacing.
    const tier = ROOM_TIER[kind === 'tutorial' || kind === 'boss' ? 'common' : rarity];
    this.density = 1 + tier.tokens * 0.12;
    this.budget = Math.round(
      {
        combat: base,
        tutorial: 22,
        elite: base * 1.15,
        derelict: base * 0.8,
        rift: base * 1.6,
        boss: 0,
        endless: base * 1.2,
        ambush: base * 0.6,
      }[kind] * heatMul * tier.budget,
    );
    this.elitesLeft = kind === 'elite' ? 2 + Math.floor(sectorIdx / 2) : kind === 'rift' ? 4 : 0;
    if (w.build.flags.has('hunted')) this.elitesLeft += 1;
    if (heat >= 3 && kind === 'combat') this.elitesLeft += 1;
    w.maxTokens = BAL.tokensBase + Math.floor(sectorIdx * BAL.tokensPerSector) + (kind === 'rift' ? 2 : 0) + tier.tokens;
    // bosses have their own HP multiplier and sector growth; row depth only scales the rank and file
    w.sectorHpScale = (1 + sectorIdx * BAL.sectorHp + (kind === 'endless' ? 0.3 : 0)) * (kind === 'boss' ? 1 : depthK) * tier.strength;
    w.sectorIdx = sectorIdx;
    w.sectorDmgScale = (1 + sectorIdx * BAL.enemyDamagePerSector + (kind === 'endless' ? 0.15 : 0)) * (1 + depth * BAL.perRow * 0.5) * tier.damage;
    this.dress();
    // the Horizon Eater IS the gravity well; don't stack a second one under it
    if (this.sector.hazard && kind !== 'tutorial' && !(kind === 'boss' && this.sector.hazard === 'gravity')) {
      this.hazard = new Hazard(this.sector.hazard, kind === 'boss' ? 0.6 : 1, (x, y, z) => this.spawnRift(x, y, z));
      w.hazard = this.hazard;
    }
    if (kind === 'boss') {
      this.boss = new BossController(this.sector.boss, w, 1 + (heat >= 5 ? 0.25 : 0), this.sector.music.bpm);
      w.boss = this.boss;
    }
    if (kind === 'derelict') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + this.rng.next();
        this.beacons.push({ pos: new Vector3(Math.cos(a) * 70, this.rng.range(-20, 20), Math.sin(a) * 70), progress: 0, lit: false });
      }
    }
  }

  /** Arena dressing: asteroids (and turret rigs bolted to some). */
  private dress(): void {
    const w = this.w;
    // the arena is big: rocks gather in a few dense fields (cover, landmarks)
    // with a thin scatter between them
    const n = this.kind === 'boss' ? 18 : Math.min(110, Math.round(this.sector.asteroids * 2.2));
    const fields: Vector3[] = [];
    const nf = 3 + this.rng.int(0, 1);
    for (let f = 0; f < nf; f++)
      fields.push(new Vector3(this.rng.range(-1, 1), this.rng.range(-0.35, 0.35), this.rng.range(-1, 1)).normalize().multiplyScalar(this.rng.range(120, w.arenaRadius * 0.8)));
    for (let i = 0; i < n; i++) {
      const inField = this.kind !== 'boss' && i % 5 < 3;
      const p = inField
        ? new Vector3(this.rng.range(-1, 1), this.rng.range(-0.6, 0.6), this.rng.range(-1, 1)).multiplyScalar(this.rng.range(15, 110)).add(fields[i % nf]!)
        : new Vector3(this.rng.range(-1, 1), this.rng.range(-0.5, 0.5), this.rng.range(-1, 1)).normalize().multiplyScalar(this.rng.range(30, w.arenaRadius * 0.9));
      if (p.distanceTo(w.player.pos) < 25) continue;
      const a = w.spawnEnemy('asteroid', p.x, p.y, p.z);
      const s = this.rng.range(0.6, 2.2);
      a.scale *= s;
      a.radius *= s;
      a.hp = a.maxHp = 60 * s * s;
      a.spawnT = 0;
      a.spin = this.rng.next() * 6;
      a.vel.set(this.rng.range(-1, 1), this.rng.range(-0.5, 0.5), this.rng.range(-1, 1));
      if (this.kind !== 'boss' && this.sector.pool.some(([id]) => id === 'turretrig') && this.rng.chance(0.12)) {
        const t = w.spawnEnemy('turretrig', p.x, p.y + a.radius + 1, p.z);
        t.spawnT = 0;
        // a rig on a rock is cover and a bonus, not a chore: it never holds the fight open
        t.optional = true;
      }
    }
  }

  private expectedDps(): number {
    return 90 * Math.pow(1.55, this.sectorIdx);
  }

  /** target live threat for the current point in the timeline */
  private targetThreat(): number {
    const t = this.time;
    const frac = this.spent / Math.max(1, this.budget);
    let k: number;
    if (this.kind === 'endless') k = 1 + Math.sin(t * 0.15) * 0.3;
    else if (frac < 0.3) k = 0.45 + frac * 1.5;
    else if (frac < 0.55) k = 1.0;
    else if (frac < 0.65) k = 0.35; // breather
    else k = 1.25;
    const w = this.w;
    const power = Math.max(0.7, Math.min(BAL.maxPower, w.build.dpsEstimate() / this.expectedDps()));
    const health = w.player.hull / w.player.maxHull;
    const hk = health < 0.3 ? 0.65 : health < 0.55 ? 0.85 : 1;
    this.intensity = k;
    return (BAL.liveThreatBase + this.sectorIdx * BAL.liveThreatPerSector) * k * power * hk * (this.kind === 'tutorial' ? 0.5 : 1) * this.density;
  }

  liveThreat(): number {
    let t = 0;
    for (const e of this.w.enemies) if (e.alive && !e.optional && e.def.role !== 'inert' && e.def.role !== 'part' && e.def.role !== 'boss') t += e.def.threat * RARITY[e.rarity].threat;
    return t;
  }

  update(dt: number): void {
    const w = this.w;
    this.time += dt;
    this.hazard?.update(w, dt);
    if (this.kind === 'boss') {
      if (this.boss?.dead) {
        this.calm += dt;
        if (this.calm > 3.5) this.done = true;
      }
      return;
    }
    if (this.kind === 'derelict') {
      let all = true;
      for (const b of this.beacons) {
        if (!b.lit) {
          all = false;
          if (b.pos.distanceTo(w.player.pos) < 14) {
            b.progress += dt / 2.5;
            if (b.progress >= 1) {
              b.lit = true;
              w.dropMotes(b.pos.x, b.pos.y, b.pos.z, 30, 4);
              w.events.emit('explosion', { x: b.pos.x, y: b.pos.y, z: b.pos.z, radius: 16, r: 1, g: 0.95, b: 0.6, enemy: false });
            }
          } else b.progress = Math.max(0, b.progress - dt * 0.1);
        }
      }
      if (all && this.spent < this.budget) this.spent = this.budget; // stop spawning once relit
    }
    // stall guard: if nothing has died for a while, wrap the fight up
    if (w.stats.kills !== this.lastKills) {
      this.lastKills = w.stats.kills;
      this.noKillT = 0;
    } else this.noKillT += dt;
    if (this.noKillT > 25 && this.spent > this.budget * 0.5) {
      this.spent = this.budget;
      this.elitesLeft = 0;
    }
    this.convergeStragglers(dt);
    if (this.sector.act === 2 && this.kind !== 'tutorial') this.updateAmbush(dt);
    // endless waves are finite too: each wave ends, pays a draft, and the next one is harder
    const exhausted = this.spent >= this.budget && this.elitesLeft <= 0;
    if (exhausted) {
      // safety net: stragglers hunt the player, then retreat into the dark
      this.straggleT += dt;
      if (this.straggleT > 18) {
        for (const e of w.enemies) {
          if (!e.alive || e.def.role === 'inert' || e.def.role === 'part' || e.def.role === 'boss') continue;
          e.speedMul = 2.2;
          if (e.def.role === 'turret' || this.straggleT > 32) {
            e.dying = e.def.faction === 'hush' ? 0.4 : 0;
            e.alive = false;
            w.events.emit('explosion', { x: e.pos.x, y: e.pos.y, z: e.pos.z, radius: 4, r: 0.6, g: 0.5, b: 1, enemy: false });
          }
        }
      }
      if (w.liveEnemyCount() === 0 && (this.kind !== 'derelict' || this.beacons.every((b) => b.lit))) {
        this.calm += dt;
        if (this.calm > 1.2) {
          this.cleared = true;
          this.done = true;
        }
      }
      return;
    }
    this.spawnCd -= dt;
    if (this.spawnCd > 0) return;
    const live = this.liveThreat();
    const target = this.targetThreat();
    if (live < target) {
      this.spawnGroup(target - live);
      // the Deep keeps the pressure on: reinforcements arrive faster
      this.spawnCd = (1.2 + this.rng.next() * 1.4) * (this.sector.act === 2 ? 0.7 : 1);
    } else this.spawnCd = 0.5;
  }

  /**
   * Nobody should fly a lap of the arena to find the last two ships. When only
   * a few hostiles are left and all of them hang back far away, they warp in
   * around the player (telegraphed) and the fight comes to you.
   */
  private convergeStragglers(dt: number): void {
    const w = this.w;
    const pl = w.player;
    let n = 0;
    let near = false;
    for (const e of w.enemies) {
      if (!e.alive || e.optional || e.def.role === 'inert' || e.def.role === 'part' || e.def.role === 'boss') continue;
      n++;
      if (e.pos.distanceTo(pl.pos) < 110) near = true;
    }
    if (n === 0 || n > 5 || near) {
      this.farT = 0;
      return;
    }
    this.farT += dt;
    if (this.farT < 3.5) return;
    this.farT = 0;
    const fwd = pl.forward(new Vector3());
    let k = 0;
    for (const e of w.enemies) {
      if (!e.alive || e.optional || e.def.role === 'inert' || e.def.role === 'part' || e.def.role === 'boss') continue;
      const a = (k++ / n) * Math.PI * 1.2 - 0.6;
      const p = fwd.clone().applyAxisAngle(new Vector3(0, 1, 0), a).multiplyScalar(this.rng.range(42, 60)).add(pl.pos);
      p.y += this.rng.range(-8, 8);
      this.warpTo(e, p);
    }
  }

  /** Telegraph and move an enemy to `p` (a short blink, so the arrival reads). */
  private warpTo(e: Enemy, p: Vector3): void {
    const w = this.w;
    w.events.emit('explosion', { x: e.pos.x, y: e.pos.y, z: e.pos.z, radius: 4, r: 0.6, g: 0.5, b: 1, enemy: false });
    w.addTelegraph({ kind: 'sphere', ax: p.x, ay: p.y, az: p.z, bx: 0, by: 0, bz: 0, radius: e.radius * 2.5, dur: 0.7, owner: e.id });
    e.pos.copy(p);
    e.prev.copy(p);
    e.vel.set(0, 0, 0);
    e.spawnT = 0.7;
  }

  /**
   * Act II warp ambush: every 14-22 s a ring of the sector's hostiles folds in
   * around you from the dark. Paid from the fight's budget, so fights get
   * denser, not longer.
   */
  private updateAmbush(dt: number): void {
    if (this.spent >= this.budget) return;
    this.ambushT -= dt;
    if (this.ambushT > 0) return;
    this.ambushT = this.rng.range(14, 22);
    const w = this.w;
    const pl = w.player;
    let id = this.pickEnemy();
    for (let tries = 0; tries < 6 && ['turret', 'carrier', 'sniper'].includes(ENEMY_BY_ID[id]!.role); tries++) id = this.pickEnemy();
    const def = ENEMY_BY_ID[id]!;
    const n = Math.max(3, Math.min(def.role === 'swarmer' ? 12 : 6, Math.round(14 / Math.max(1, def.threat))));
    // the ring stands across your flight path
    const fwd = pl.forward(new Vector3());
    const side = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
    if (side.lengthSq() < 0.5) side.set(1, 0, 0);
    const up = new Vector3().crossVectors(side, fwd).normalize();
    const center = pl.pos.clone().addScaledVector(fwd, 20);
    w.addTelegraph({ kind: 'ring', ax: center.x, ay: center.y, az: center.z, bx: fwd.x, by: fwd.y, bz: fwd.z, radius: 36, dur: 1.1, owner: -1 });
    w.events.emit('telegraph', { x: center.x, y: center.y, z: center.z, kind: 'ambush' });
    w.later(1.1, () => {
      if (this.done) return;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = center.clone().addScaledVector(side, Math.cos(a) * 36).addScaledVector(up, Math.sin(a) * 36);
        const rarity = rollRarity(this.rng, this.sectorIdx, w.heat, this.kind);
        const e = w.spawnEnemy(def, p.x, p.y, p.z, rarity);
        e.spawnT = 0.5;
        e.vel.copy(p).sub(pl.pos).normalize().multiplyScalar(-8);
        this.spent += def.threat * RARITY[rarity].threat;
      }
      w.events.emit('explosion', { x: center.x, y: center.y, z: center.z, radius: 30, r: 0.7, g: 0.5, b: 1.2, enemy: false });
    });
  }

  /** a void rift spills three hostiles of the sector's pool */
  private spawnRift(x: number, y: number, z: number): void {
    const w = this.w;
    if (w.liveEnemyCount() > 160) return;
    for (let i = 0; i < 3; i++) {
      const id = this.pickEnemy();
      const e = w.spawnEnemy(id, x + this.rng.range(-4, 4), y + this.rng.range(-3, 3), z + this.rng.range(-4, 4), rollRarity(this.rng, this.sectorIdx, w.heat, this.kind));
      e.spawnT = 0.4;
    }
  }

  private pickEnemy(): string {
    const pool = this.sector.pool.filter(([id]) => (ENEMY_BY_ID[id]!.minSector ?? 0) <= this.sectorIdx + 1);
    // early tutorial: only simple roles
    const p = this.kind === 'tutorial' ? pool.filter(([id]) => ['swarmer', 'charger'].includes(ENEMY_BY_ID[id]!.role)) : pool;
    const list = p.length ? p : pool;
    return list[this.rng.weighted(list.map((x) => x[1]))]![0];
  }

  /** Spawn an authored formation for the chosen enemy type. */
  private spawnGroup(need: number): void {
    const w = this.w;
    const id = this.pickEnemy();
    const def = ENEMY_BY_ID[id]!;
    const pl = w.player;
    // spawn mostly in the front hemisphere so threats are readable
    const fwd = pl.forward(new Vector3());
    const side = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
    const ang = this.rng.range(-1.1, 1.1);
    const dir = fwd.clone().applyAxisAngle(new Vector3(0, 1, 0), ang).add(new Vector3(0, this.rng.range(-0.35, 0.35), 0)).normalize();
    if (this.rng.chance(0.2)) dir.negate(); // occasional flank from behind
    // turrets cannot come to you, so they drop in close instead (and never in big lines)
    const turret = def.role === 'turret';
    const dist = turret ? this.rng.range(38, 58) : this.rng.range(80, 120);
    const center = pl.pos.clone().addScaledVector(dir, dist);
    if (center.length() > w.arenaRadius * 0.95) center.setLength(w.arenaRadius * 0.9);
    let count = Math.max(1, Math.min(def.role === 'swarmer' ? 22 : 6, Math.round(need / Math.max(1, def.threat))));
    if (this.w.heat >= 9 && def.role === 'swarmer') count = Math.round(count * 1.3);
    if (turret) count = Math.min(count, 2);
    const formation = def.role === 'swarmer' ? this.rng.pick(['cluster', 'ring', 'line'] as const) : this.rng.pick(['cluster', 'line'] as const);
    // guaranteed elites (elite/rift nodes, Heat, Hunted) arrive alone as Rare, sometimes Unique
    let forced: Rarity = 0;
    if (this.elitesLeft > 0 && (this.spent / this.budget > 0.25 || this.kind === 'rift') && def.role !== 'swarmer' && this.rng.chance(0.5)) {
      forced = this.rng.chance(0.1 + this.sectorIdx * 0.03) ? 3 : 2;
      this.elitesLeft--;
      count = 1;
    }
    for (let i = 0; i < count; i++) {
      const p = center.clone();
      if (formation === 'ring') {
        const a = (i / count) * Math.PI * 2;
        p.addScaledVector(side, Math.cos(a) * 18).add(new Vector3(0, Math.sin(a) * 18, 0));
      } else if (formation === 'line') {
        p.addScaledVector(side, (i - count / 2) * 5).y += this.rng.range(-2, 2);
      } else p.add(new Vector3(this.rng.range(-10, 10), this.rng.range(-8, 8), this.rng.range(-10, 10)));
      // every spawn rolls its own rarity; swarm members roll at a third of the odds
      const roll = this.kind === 'tutorial' ? 0 : rollRarity(this.rng, this.sectorIdx, w.heat, this.kind);
      const rarity = (i === 0 && forced ? forced : def.role === 'swarmer' && this.rng.next() > 0.33 ? 0 : roll) as Rarity;
      const e = w.spawnEnemy(def, p.x, p.y, p.z, rarity);
      e.vel.copy(dir).multiplyScalar(-10);
      e.timer += i * 0.15;
      this.spent += def.threat * RARITY[rarity].threat;
    }
    this.wave++;
  }
}

/** Shop pricing. */
export function priceFor(rarity: string, sector: number, discount: number, heat: number): number {
  const base: Record<string, number> = { common: 45, uncommon: 70, rare: 110, epic: 160, legendary: 220, artifact: 200, weapon: 120 };
  return Math.round((base[rarity] ?? 80) * (1 + sector * 0.18) * (1 - discount) * (heat >= 4 ? 1.25 : 1));
}

/** Embers earned from a run — based on progress, not just wins. */
export function embersFor(r: { sector: number; kills: number; bosses: number; won: boolean; heat: number; light: number }): number {
  const base = r.sector * 12 + Math.floor(r.kills / 25) + r.bosses * 15 + Math.floor(r.light / 200) + (r.won ? 60 : 0);
  return Math.round(base * (1 + r.heat * 0.12));
}
