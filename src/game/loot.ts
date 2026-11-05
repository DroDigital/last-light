import type { Rng } from '../core/rng';
import type { Behavior, StatMod } from './types';

/** Component rarity is independent of the existing upgrade-card rarities. */
export type LootRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythical';
export type LootSlot = 'port' | 'starboard' | 'propulsion';
export type WeaponSide = 'port' | 'starboard';
export const LOOT_RARITIES: LootRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythical'];
export const LOOT_COLORS: Record<LootRarity, string> = { common: '#9faeb8', rare: '#6caeff', epic: '#c793ff', legendary: '#ffbd58', mythical: '#ff739c' };
export interface LootTrait { name: string; desc: string; mods: StatMod[]; behaviors?: Behavior[]; fallbackMods?: StatMod[] }
export interface LootItem {
  id: string;
  name: string;
  rarity: LootRarity;
  slot: LootSlot;
  color: string;
  mods: StatMod[];
  trait?: LootTrait;
  /** Collecting this component unlocks an effect for installation. */
  effectId?: string;
}
export interface WeaponEffect { id: string; name: string; desc: string; cost: number; color: string; mods: StatMod[] }

/** Effects affect combat as well as the appearance of shots. Costs are paid in Light. */
export const EFFECTS: WeaponEffect[] = [
  { id: 'ember', name: 'Ember Wake', desc: 'Shots can ignite targets.', cost: 70, color: '#ff8958', mods: [{ s: 'burn', add: 0.16 }] },
  { id: 'ion', name: 'Ion Storm', desc: 'Shots can shock targets.', cost: 80, color: '#8eacff', mods: [{ s: 'shock', add: 0.16 }] },
  { id: 'frost', name: 'Frost Shards', desc: 'Shots can chill targets.', cost: 70, color: '#88efff', mods: [{ s: 'cryo', add: 0.16 }] },
  { id: 'prism', name: 'Prism Echo', desc: 'Projectiles split; beams and rails deal 15% more damage, and arcs chain once more.', cost: 100, color: '#ff9df0', mods: [{ s: 'split', add: 1 }] },
  { id: 'void', name: 'Void Ribbon', desc: 'Shots can mark targets with void.', cost: 90, color: '#ba87ff', mods: [{ s: 'void', add: 0.16 }] },
  { id: 'radiant', name: 'Dawn Halo', desc: 'Shots can apply radiant marks.', cost: 90, color: '#ffe38b', mods: [{ s: 'radiant', add: 0.16 }] },
];

const WEAPON_NAMES = ['Accelerator', 'Focusing Array', 'Coil Assembly', 'Pulse Regulator', 'Phase Barrel', 'Vector Lens', 'Flux Chamber', 'Siege Mount'];
const ENGINE_NAMES = ['Ion Drive', 'Slipstream Engine', 'Vector Thruster', 'Dawn Propulsor', 'Flux Drive', 'Comet Engine'];
const PREFIXES = ['Aster', 'Helix', 'Rift', 'Nova', 'Lumen', 'Spectral', 'Zenith', 'Echo', 'Vesper', 'Aegis'];
const weaponTraits: { name: string; stat: 'pierce' | 'ricochet' | 'split' | 'chain' | 'explode' | 'homing'; label: string; unit: 'count' | 'range'; behaviors: Behavior[]; applies: string }[] = [
  { name: 'Worldpiercer', stat: 'pierce', label: 'targets pierced', unit: 'count', behaviors: ['bullet', 'beam', 'rail'], applies: 'bullets, beams and rails' },
  { name: 'Mirrorbound', stat: 'ricochet', label: 'ricochets', unit: 'count', behaviors: ['bullet'], applies: 'bullet weapons' },
  { name: 'Fractured Star', stat: 'split', label: 'split fragments', unit: 'count', behaviors: ['bullet', 'beam', 'rail', 'arc'], applies: 'primary weapons' },
  { name: 'Storm Circuit', stat: 'chain', label: 'chain targets', unit: 'count', behaviors: ['arc'], applies: 'arc weapons' },
  { name: 'Supernova Core', stat: 'explode', label: 'blast radius', unit: 'range', behaviors: ['bullet'], applies: 'bullet weapons' },
  { name: 'Hunter Logic', stat: 'homing', label: 'homing strength', unit: 'range', behaviors: ['bullet'], applies: 'bullet weapons' },
];
const engineTraits: { name: string; stat: 'boost' | 'boostRegen' | 'shieldRegen' | 'magnet'; label: string }[] = [
  { name: 'Slipstream', stat: 'boost', label: 'boost capacity' }, { name: 'Star Current', stat: 'boostRegen', label: 'boost recharge' },
  { name: 'Aegis Wake', stat: 'shieldRegen', label: 'shield recharge' }, { name: 'Graviton Sail', stat: 'magnet', label: 'pickup range' },
];
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Seeded component roll. A specified rarity/slot is useful for room rewards. */
export function generateLoot(rng: Rng, rarity?: LootRarity, slot?: LootSlot): LootItem {
  const r = rarity ?? LOOT_RARITIES[rng.weighted([58, 26, 11, 4, 1])]!;
  const s = slot ?? rng.pick(['port', 'starboard', 'propulsion'] as const);
  const tier = LOOT_RARITIES.indexOf(r);
  const power = round(0.035 + tier * 0.035 + rng.range(0, 0.035));
  const secondary = round(0.02 + tier * 0.018 + rng.range(0, 0.025));
  const weaponAffixes: StatMod[] = [
    { s: 'rate', mul: 1 + secondary }, { s: 'crit', add: secondary },
    { s: 'critMul', add: secondary * 2 }, { s: 'burn', add: secondary },
    { s: 'cryo', add: secondary }, { s: 'shock', add: secondary },
    { s: 'void', add: secondary }, { s: 'radiant', add: secondary },
    { s: 'statusPower', mul: 1 + secondary * 2 },
  ];
  const engineAffixes: StatMod[] = [
    { s: 'boostRegen', mul: 1 + secondary * 2 }, { s: 'boost', mul: 1 + secondary * 2 },
    { s: 'shieldRegen', mul: 1 + secondary * 2 }, { s: 'magnet', mul: 1 + secondary * 2 },
    { s: 'dodgeCd', mul: 1 - secondary }, { s: 'flareGain', mul: 1 + secondary * 2 },
  ];
  const mods: StatMod[] = s === 'propulsion'
    ? [{ s: 'speed', mul: 1 + power }, rng.pick(engineAffixes)]
    : [{ s: 'damage', mul: 1 + power }, rng.pick(weaponAffixes)];
  let trait: LootTrait | undefined;
  if (tier >= 3) {
    if (s === 'propulsion') {
      const t = rng.pick(engineTraits);
      const amount = round(rng.range(tier === 4 ? 0.18 : 0.1, tier === 4 ? 0.32 : 0.2));
      trait = { name: t.name, desc: `+${Math.round(amount * 100)}% ${t.label}.`, mods: [{ s: t.stat, mul: 1 + amount }] };
    } else {
      const t = rng.pick(weaponTraits);
      const amount = t.unit === 'count' ? rng.int(1, tier === 4 ? 3 : 2) : round(rng.range(tier === 4 ? 2 : 1, tier === 4 ? 4 : 2.5));
      const crit = round(Math.min(0.12, amount * (t.unit === 'count' ? 0.03 : 0.02)));
      const desc = t.stat === 'split'
        ? `+${amount} projectile fragments; beams and rails deal +${amount * 15}% damage, arcs chain +${amount} targets.`
        : `+${amount} ${t.label} for ${t.applies}; otherwise +${Math.round(crit * 100)}% critical chance.`;
      trait = { name: t.name, desc, mods: [{ s: t.stat, add: amount }], behaviors: t.behaviors, fallbackMods: [{ s: 'crit', add: crit }] };
    }
  }
  const effectId = s !== 'propulsion' && rng.chance(0.4 + tier * 0.15) ? rng.pick(EFFECTS).id : undefined;
  return { id: `${s}-${rng.int(0, 0x7fffffff).toString(36)}-${rng.int(0, 0x7fffffff).toString(36)}`, name: `${rng.pick(PREFIXES)} ${rng.pick(s === 'propulsion' ? ENGINE_NAMES : WEAPON_NAMES)}`, rarity: r, slot: s, color: LOOT_COLORS[r], mods, trait, effectId };
}
