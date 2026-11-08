import type { AiRole, EnemyDef } from '../game/types';

/**
 * Probabilistic drops. Every kill rolls each drop kind independently against
 * the enemy's category, scaled by its rarity, Gilded, and the ship's Luck.
 *
 * shard  · an extra upgrade draft after the fight
 * prism  · an extra draft of Rare-or-better upgrades
 * cache  · an extra weapon draft (new weapons and weapon levels)
 * repair · +12 hull plus 8% of max hull, on pickup
 * cell   · +35 Lumen, on pickup
 * barrier · +30 shield plus 20% of max shield, on pickup; restarts regen at once
 *
 * Sustain is tuned to top you up between mistakes, not to outheal a fight:
 * fodder rarely drops anything, heavies and supports are worth chasing, and
 * shooting rocks (debris) is a small, deliberate way to patch up.
 *
 * A Unique always drops at least one Upgrade Shard. Shards, prisms and caches are banked and paid out when the fight ends, so
 * combat never pauses for a menu.
 */
export type DropKind = 'shard' | 'prism' | 'cache' | 'repair' | 'cell' | 'barrier';
export const DROP_KINDS: DropKind[] = ['shard', 'prism', 'cache', 'repair', 'cell', 'barrier'];

/** Hull a Hull Patch repairs for a ship with this much max hull. */
export const repairAmount = (maxHull: number): number => Math.round(12 + maxHull * 0.08);
/** Shield a Shield Cell restores for a ship with this much max shield. */
export const barrierAmount = (maxShield: number): number => Math.round(30 + maxShield * 0.2);

export type EnemyClass = 'swarm' | 'fighter' | 'heavy' | 'support' | 'debris' | 'part' | 'boss';

export const DROP_INFO: Record<DropKind, { name: string; color: string; desc: string }> = {
  shard: { name: 'Upgrade Shard', color: '#7fe0a8', desc: 'An extra upgrade draft after the fight.' },
  prism: { name: 'Prism Shard', color: '#c58bff', desc: 'An extra draft of Rare-or-better upgrades.' },
  cache: { name: 'Weapon Cache', color: '#ffc24a', desc: 'An extra weapon draft: new weapons or levels.' },
  repair: { name: 'Hull Patch', color: '#ff8a6a', desc: 'Repairs 12 hull plus 8% of max hull on pickup.' },
  cell: { name: 'Lumen Cell', color: '#70b8ff', desc: 'Fills 35 Lumen on pickup.' },
  barrier: { name: 'Shield Cell', color: '#7fe8ff', desc: 'Restores 30 shield plus 20% of max shield and restarts shield regen.' },
};

/** Base chance per kill, by enemy category (common rarity, no Luck). */
export const DROP_TABLE: Record<EnemyClass, Record<DropKind, number>> = {
  swarm: { shard: 0.0008, prism: 0.00004, cache: 0.00015, repair: 0.008, cell: 0.007, barrier: 0.014 },
  fighter: { shard: 0.0016, prism: 0.0001, cache: 0.0005, repair: 0.02, cell: 0.012, barrier: 0.03 },
  heavy: { shard: 0.008, prism: 0.0008, cache: 0.003, repair: 0.055, cell: 0.025, barrier: 0.07 },
  support: { shard: 0.005, prism: 0.0004, cache: 0.0012, repair: 0.06, cell: 0.018, barrier: 0.09 },
  debris: { shard: 0.0008, prism: 0, cache: 0.0002, repair: 0.04, cell: 0.008, barrier: 0.05 },
  part: { shard: 0.02, prism: 0.005, cache: 0.008, repair: 0.1, cell: 0.06, barrier: 0.12 },
  boss: { shard: 0, prism: 1, cache: 1, repair: 1, cell: 1, barrier: 1 },
};

/**
 * Linked hardpoints roughly doubled kill speed, and fights got denser to match,
 * so kills come faster than the table was tuned for. Draft-paying drops are
 * scaled back so bonus drafts per run stay near where they were.
 */
export const DRAFT_DROP_SCALE = 0.5;
const DRAFT_DROPS = new Set<DropKind>(['shard', 'prism', 'cache']);

/** Rarity multiplies drop odds: Common, Magic, Rare, Unique. */
export const RARITY_DROP = [1, 4, 10, 25];

const ROLE_CLASS: Partial<Record<AiRole, EnemyClass>> = {
  swarmer: 'swarm', mimic: 'swarm',
  carrier: 'heavy', bomber: 'heavy', turret: 'heavy',
  shielder: 'support', healer: 'support',
  inert: 'debris', part: 'part', boss: 'boss',
};

export function enemyClass(def: EnemyDef): EnemyClass {
  const c = ROLE_CLASS[def.role];
  if (c) return c;
  return def.threat >= 5 ? 'heavy' : 'fighter';
}

/** Chance of a drop kind for one kill. Capped so a Gilded Unique is generous but not a jackpot. */
export function dropChance(def: EnemyDef, kind: DropKind, rarity: number, gilded: boolean, luck: number, core = true): number {
  // only a boss's true core pays the boss reward; its other boss-role bodies count as parts
  const cls = enemyClass(def);
  const base = DROP_TABLE[cls === 'boss' && !core ? 'part' : cls][kind];
  if (base >= 1) return 1;
  return Math.min(0.85, base * (DRAFT_DROPS.has(kind) ? DRAFT_DROP_SCALE : 1) * RARITY_DROP[rarity]! * (gilded ? 2 : 1) * (1 + Math.max(0, luck) * 0.15));
}
