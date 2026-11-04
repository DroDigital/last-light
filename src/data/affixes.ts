import type { AiRole } from '../game/types';
import type { Rng } from '../core/rng';

/**
 * Enemy rarities and the affix table they roll from.
 *
 * Common   no affixes
 * Magic    1 affix  · more HP · blue
 * Rare     2-3      · much more HP · gold
 * Unique   3-4      · boss-lite HP, a generated name · ember
 *
 * Stat affixes change numbers; behaviour affixes are implemented as hooks in
 * World (update / damage / kill / hurt) and ai.ts. Every affix is readable in
 * play: the rarity ring, the name plate, and its own visual or telegraph.
 */
export type Rarity = 0 | 1 | 2 | 3;

export const RARITY = [
  { id: 'common', name: 'Common', color: '#ff2e63', hp: 1, scale: 1, light: 1, threat: 1 },
  { id: 'magic', name: 'Magic', color: '#70b8ff', hp: 1.7, scale: 1.12, light: 2, threat: 1.8 },
  { id: 'rare', name: 'Rare', color: '#ffc24a', hp: 2.8, scale: 1.3, light: 3.5, threat: 3 },
  { id: 'unique', name: 'Unique', color: '#ff7a3a', hp: 5, scale: 1.5, light: 8, threat: 5 },
] as const;

export interface AffixDef {
  id: string;
  name: string;
  desc: string;
  /** relative roll weight */
  w: number;
  /** first sector index (0-based) it can roll in */
  minSector?: number;
  /** roles it never rolls on (it would do nothing, or break them) */
  not?: AiRole[];
  // stat changes, applied once on spawn
  hp?: number;
  speed?: number;
  fire?: number;
  dmg?: number;
  armor?: number;
  scale?: number;
  taken?: number;
}

const STILL: AiRole[] = ['turret', 'inert'];

export const AFFIXES = [
  // --- stat affixes
  { id: 'hasted', name: 'Hasted', desc: 'Moves and fires 50% faster.', w: 10, speed: 1.5, fire: 1.4, not: STILL },
  { id: 'armored', name: 'Armored', desc: 'Thick plating: +5 armor, +20% HP.', w: 9, armor: 5, hp: 1.2 },
  { id: 'titanic', name: 'Titanic', desc: 'Huge and slow, with nearly twice the HP.', w: 6, scale: 1.35, hp: 1.9, speed: 0.8 },
  { id: 'frenzied', name: 'Frenzied', desc: 'Fires almost twice as often.', w: 8, fire: 1.8, not: ['swarmer', 'charger', 'splitter', 'carrier', 'healer', 'shielder', 'mimic'] },
  { id: 'brutal', name: 'Brutal', desc: 'Deals 50% more damage.', w: 8, dmg: 1.5 },
  { id: 'swift', name: 'Swift', desc: 'Nearly twice as fast.', w: 7, speed: 1.8, not: STILL },
  { id: 'hardened', name: 'Hardened', desc: 'Takes 30% less damage.', w: 6, taken: 0.7 },
  // --- behaviour affixes
  { id: 'shielded', name: 'Shielded', desc: 'Carries a regenerating barrier.', w: 8 },
  { id: 'splitting', name: 'Splitting', desc: 'Splits into two lesser copies on death.', w: 5, not: ['carrier', 'turret'] },
  { id: 'vampiric', name: 'Vampiric', desc: 'Heals whenever it damages you.', w: 5 },
  { id: 'cloaked', name: 'Cloaked', desc: 'Dithers out of sight when not attacking.', w: 5, minSector: 1 },
  { id: 'regenerating', name: 'Regenerating', desc: 'Knits back 3% of its HP every second.', w: 7 },
  { id: 'volatile', name: 'Volatile', desc: 'Detonates when destroyed. Do not finish it point-blank.', w: 7 },
  { id: 'molten', name: 'Molten', desc: 'Sheds burning slag mines in its wake.', w: 5, minSector: 1, not: STILL },
  { id: 'frostbound', name: 'Frostbound', desc: 'A freezing aura slows you when you fly close.', w: 5, minSector: 1 },
  { id: 'deflecting', name: 'Deflecting', desc: 'Shrugs off one in four shots outright.', w: 5, minSector: 1 },
  { id: 'thorned', name: 'Thorned', desc: 'Spits a shard back at you when hit hard.', w: 5, minSector: 2 },
  { id: 'summoner', name: 'Summoner', desc: 'Calls in swarmers of its kind every few seconds.', w: 4, minSector: 1, not: ['swarmer', 'carrier'] },
  { id: 'warping', name: 'Warping', desc: 'Blinks to a new position when pressed.', w: 5, minSector: 1, not: STILL },
  { id: 'barrage', name: 'Barrage', desc: 'Periodically releases a ring of bullets.', w: 6 },
  { id: 'seeking', name: 'Seeking', desc: 'Its rounds curve toward you.', w: 5, minSector: 2, not: ['swarmer', 'charger', 'splitter', 'carrier', 'healer', 'shielder', 'mimic'] },
  { id: 'packleader', name: 'Pack Leader', desc: 'Arrives with escorts and drives them harder.', w: 4, not: ['swarmer'] },
  { id: 'empowering', name: 'Empowering', desc: 'Nearby allies move and hit 25% harder.', w: 5, minSector: 1 },
  { id: 'warden', name: 'Warden', desc: 'Projects shields onto nearby allies.', w: 4, minSector: 1 },
  { id: 'leeching', name: 'Leeching', desc: 'Its hits drain your Lumen.', w: 5 },
  { id: 'unstable', name: 'Unstable', desc: 'Pulses a telegraphed nova every few seconds.', w: 5, minSector: 2 },
  { id: 'phasing', name: 'Phasing', desc: 'Slips out of phase for a second at a time: untouchable while flickering.', w: 4, minSector: 2 },
  { id: 'relentless', name: 'Relentless', desc: 'Immune to knockback, slows and stasis.', w: 5 },
  { id: 'cursed', name: 'Cursed', desc: 'Leaves a field of mines where it dies.', w: 4, minSector: 2 },
  { id: 'enraged', name: 'Enraged', desc: 'Below 35% HP it doubles its speed and fire rate.', w: 6 },
  { id: 'gilded', name: 'Gilded', desc: 'Drips with Light: triple Light and a better drop.', w: 3 },
] as const satisfies readonly AffixDef[];

export type AffixId = (typeof AFFIXES)[number]['id'];
export const AFFIX_BY_ID = Object.fromEntries(AFFIXES.map((a) => [a.id, a as AffixDef])) as Record<AffixId, AffixDef>;
export const AFFIX_INDEX = Object.fromEntries(AFFIXES.map((a, i) => [a.id, i])) as Record<AffixId, number>;

/** Chance per spawn of each rarity tier, by sector (0-based) and heat. */
export function rarityOdds(sector: number, heat: number, encounter: string): [number, number, number] {
  const k = 1 + heat * 0.08 + (encounter === 'elite' ? 0.6 : encounter === 'rift' ? 1 : encounter === 'endless' ? 0.4 : 0);
  return [
    Math.min(0.15, (0.04 + sector * 0.012) * k), // magic
    Math.min(0.04, (0.006 + sector * 0.004) * k), // rare
    Math.min(0.006, (0.0006 + sector * 0.0005) * k), // unique
  ];
}

export function rollRarity(rng: Rng, sector: number, heat: number, encounter: string, floor: Rarity = 0): Rarity {
  const [m, r, u] = rarityOdds(sector, heat, encounter);
  const x = rng.next();
  const rolled: Rarity = x < u ? 3 : x < u + r ? 2 : x < u + r + m ? 1 : 0;
  return Math.max(rolled, floor) as Rarity;
}

/** Roll the affixes for a rarity without repeats, respecting role and sector gates. */
export function rollAffixes(rng: Rng, rarity: Rarity, role: AiRole, sector: number): AffixId[] {
  const n = rarity === 0 ? 0 : rarity === 1 ? 1 : rarity === 2 ? 2 + (rng.chance(0.4) ? 1 : 0) : 3 + (rng.chance(0.5) ? 1 : 0);
  const out: AffixId[] = [];
  const pool: AffixDef[] = AFFIXES.filter((a) => {
    const d = a as AffixDef;
    return (d.minSector ?? 0) <= sector && !(d.not ?? []).includes(role);
  });
  for (let i = 0; i < n && pool.length; i++) {
    const k = rng.weighted(pool.map((a) => a.w));
    out.push(pool[k]!.id as AffixId);
    pool.splice(k, 1);
  }
  return out;
}

/** Short label for HUD plates: the unique's name, or rarity + affix names. */
export function rankLabel(e: { rarity: Rarity; rankName: string; affixes: readonly string[] }): string {
  if (e.rarity === 3 && e.rankName) return e.rankName;
  return e.affixes.map((a) => AFFIX_BY_ID[a as AffixId]?.name ?? a).join(' · ');
}

export const RARITY_RGB: [number, number, number][] = [
  [1, 0.18, 0.39],
  [0.44, 0.72, 1],
  [1, 0.76, 0.29],
  [1, 0.48, 0.23],
];

const UNIQUE_FIRST = ['Vey', 'Orun', 'Kael', 'Sable', 'Ixa', 'Morrow', 'Tessa', 'Vorn', 'Quill', 'Ashe', 'Nyx', 'Corvid', 'Halde', 'Ember', 'Lisk', 'Rhune'];
const UNIQUE_TITLE = ['the Unlit', 'the Hollow Crown', 'Starbiter', 'of the Last Choir', 'the Ninefold', 'Who Waits', 'the Patient Dark', 'Coldheart', 'the Reaver', 'Lantern-Eater', 'the Glass Widow', 'the Unbroken'];

export function uniqueName(rng: Rng, base: string): string {
  return `${rng.pick(UNIQUE_FIRST)} ${rng.pick(UNIQUE_TITLE)} · ${base}`;
}
