import type { Rarity, StatMod, SynergyDef, Tag, TriggerDef, UpgradeDef } from '../game/types';

/**
 * Upgrades are generated from compact tier tables so content scales without
 * code. Every upgrade names the visual layer it changes; the renderer reads
 * build stats (projectile size/brightness, element tints, ship modules, aura
 * rings, trail length) so nothing is an invisible stat bump.
 */
const R: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

interface TierSpec {
  id: string;
  name: string;
  tags: Tag[];
  requires?: Tag[];
  rarityStart?: number;
  values: number[];
  desc: (v: number) => string;
  mods: (v: number) => StatMod[];
  triggers?: (v: number) => TriggerDef[];
  visual: UpgradeDef['visual'];
}

function tiers(spec: TierSpec): UpgradeDef[] {
  return spec.values.map((v, i) => ({
    id: `${spec.id}_${i + 1}`,
    name: `${spec.name} ${ROMAN[i]}`,
    rarity: R[Math.min((spec.rarityStart ?? 0) + i, 4)]!,
    tags: spec.tags,
    requires: spec.requires,
    desc: spec.desc(v),
    mods: spec.mods(v),
    triggers: spec.triggers?.(v),
    visual: spec.visual,
    family: spec.id,
    maxStacks: 2,
  }));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const WEAPON_MODS: TierSpec[] = [
  { id: 'barrels', name: 'Calibrated Barrels', tags: [], values: [0.15, 0.25, 0.4], desc: (v) => `+${pct(v)} damage. Shots burn brighter.`, mods: (v) => [{ s: 'damage', mul: 1 + v }], visual: 'projectile' },
  { id: 'overclock', name: 'Overclock', tags: ['rapid', 'heat'], values: [0.12, 0.22, 0.35], desc: (v) => `+${pct(v)} fire rate. Barrels glow with heat.`, mods: (v) => [{ s: 'rate', mul: 1 + v }], visual: 'ship' },
  { id: 'twinfeed', name: 'Twin Feed', tags: ['split'], rarityStart: 1, values: [1, 2], desc: (v) => `+${v} projectile per shot, -10% damage.`, mods: (v) => [{ s: 'count', add: v }, { s: 'damage', mul: 0.9 }], visual: 'projectile' },
  { id: 'rails', name: 'Railed Accelerator', tags: ['speed'], values: [0.15, 0.25, 0.4], desc: (v) => `+${pct(v)} projectile speed and range.`, mods: (v) => [{ s: 'speed', mul: 1 + v }, { s: 'range', mul: 1 + v * 0.6 }], visual: 'trail' },
  { id: 'heavy', name: 'Heavy Rounds', tags: ['kinetic'], values: [0.2, 0.35, 0.5], desc: (v) => `+${pct(v)} projectile size, +${pct(v / 3)} damage, more knockback.`, mods: (v) => [{ s: 'size', mul: 1 + v }, { s: 'damage', mul: 1 + v / 3 }, { s: 'knock', mul: 1 + v * 2 }], visual: 'projectile' },
  { id: 'piercing', name: 'Piercing Tips', tags: ['pierce'], values: [1, 1, 2], desc: (v) => `Shots pierce ${v} more enem${v > 1 ? 'ies' : 'y'}.`, mods: (v) => [{ s: 'pierce', add: v }], visual: 'projectile' },
  { id: 'splitter', name: 'Splitter Core', tags: ['split'], rarityStart: 1, values: [2, 3], desc: (v) => `Shots split into ${v} fragments on hit.`, mods: (v) => [{ s: 'split', add: v }], visual: 'projectile' },
  { id: 'ricochet', name: 'Ricochet Matrix', tags: ['ricochet'], rarityStart: 1, values: [1, 2], desc: (v) => `Shots ricochet to ${v} more target${v > 1 ? 's' : ''}.`, mods: (v) => [{ s: 'ricochet', add: v }], visual: 'projectile' },
  { id: 'seeker', name: 'Seeker Chips', tags: ['homing'], values: [1.5, 2.5, 4], desc: (v) => `Projectiles home in (+${v} turn).`, mods: (v) => [{ s: 'homing', add: v }], visual: 'trail' },
  { id: 'conductor', name: 'Chain Conductor', tags: ['chain'], requires: ['shock', 'chain'], values: [1, 2], desc: (v) => `Chains jump to ${v} more target${v > 1 ? 's' : ''}.`, mods: (v) => [{ s: 'chain', add: v }], visual: 'projectile' },
  { id: 'choke', name: 'Wide Choke', tags: ['area'], values: [1, 2], desc: (v) => `+${v} projectile, wider spread.`, mods: (v) => [{ s: 'count', add: v }, { s: 'spread', mul: 1.35 }], visual: 'projectile' },
  { id: 'blast', name: 'Blast Radius', tags: ['area'], requires: ['area', 'ordnance'], values: [0.2, 0.35, 0.5], desc: (v) => `+${pct(v)} explosion radius.`, mods: (v) => [{ s: 'explode', mul: 1 + v }], visual: 'explosion' },
  { id: 'fuse', name: 'Long Fuse', tags: [], values: [0.25, 0.45], desc: (v) => `+${pct(v)} projectile lifetime.`, mods: (v) => [{ s: 'life', mul: 1 + v }], visual: 'trail' },
  { id: 'optics', name: 'Sharpened Optics', tags: ['crit'], values: [0.05, 0.08, 0.12], desc: (v) => `+${pct(v)} critical chance. Crits flash white.`, mods: (v) => [{ s: 'crit', add: v }], visual: 'projectile' },
  { id: 'edge', name: 'Killing Edge', tags: ['crit'], requires: ['crit'], rarityStart: 1, values: [0.4, 0.7], desc: (v) => `+${pct(v)} critical damage.`, mods: (v) => [{ s: 'critMul', add: v }], visual: 'explosion' },
];

const FAMILIES: [Tag, string][] = [
  ['kinetic', 'Kinetic'],
  ['energy', 'Energy'],
  ['ordnance', 'Ordnance'],
  ['exotic', 'Exotic'],
  ['drone', 'Drone'],
  ['light', 'Light'],
];
const MASTERY: TierSpec[] = FAMILIES.map(([tag, label]) => ({
  id: `mastery_${tag}`,
  name: `${label} Mastery`,
  tags: [tag],
  requires: [tag],
  values: [0.2, 0.35, 0.55],
  desc: (v: number) => `${label} weapons: +${pct(v)} damage, +${pct(v / 2)} fire rate.`,
  mods: (v: number) => [
    { s: 'damage', mul: 1 + v, tag },
    { s: 'rate', mul: 1 + v / 2, tag },
  ],
  visual: 'projectile' as const,
}));

const ELEMENTS: [Tag, 'burn' | 'cryo' | 'shock' | 'corrode' | 'void' | 'radiant', string, string][] = [
  ['burn', 'burn', 'Incendiary Rounds', 'set targets ablaze'],
  ['cryo', 'cryo', 'Cryo Coils', 'chill and eventually freeze targets'],
  ['shock', 'shock', 'Static Coils', 'arc shock to nearby enemies'],
  ['corrode', 'corrode', 'Acid Payload', 'corrode armor so targets take more damage'],
  ['void', 'void', 'Void Seeds', 'drag targets toward each other'],
  ['radiant', 'radiant', 'Radiant Glass', 'make kills shed extra Light'],
];
const ELEMENT_TIERS: TierSpec[] = ELEMENTS.map(([tag, stat, name, verb]) => ({
  id: `el_${tag}`,
  name,
  tags: [tag],
  values: [0.12, 0.2, 0.32],
  desc: (v: number) => `${pct(v)} chance on hit to ${verb}. Shots take on its color.`,
  mods: (v: number) => [{ s: stat, add: v }],
  visual: 'projectile' as const,
}));
ELEMENT_TIERS.push({
  id: 'catalyst', name: 'Catalyst', tags: ['burn', 'cryo', 'shock'], rarityStart: 1, values: [0.25, 0.5],
  requires: ['burn', 'cryo', 'shock', 'corrode', 'void', 'radiant'],
  desc: (v) => `Status effects are ${pct(v)} stronger.`, mods: (v) => [{ s: 'statusPower', mul: 1 + v }], visual: 'aura',
});

const SHIP: TierSpec[] = [
  { id: 'hullplate', name: 'Reinforced Hull', tags: ['hull'], values: [20, 30, 45], desc: (v) => `+${v} max hull. Visible armor plating.`, mods: (v) => [{ s: 'hull', add: v }], visual: 'ship' },
  { id: 'capacitor', name: 'Shield Capacitor', tags: ['shield'], values: [15, 25, 40], desc: (v) => `+${v} max shield. Your shield bubble thickens.`, mods: (v) => [{ s: 'shield', add: v }], visual: 'aura' },
  { id: 'recharge', name: 'Fast Recharge', tags: ['shield'], values: [0.3, 0.5], desc: (v) => `+${pct(v)} shield regen, shorter recharge delay.`, mods: (v) => [{ s: 'shieldRegen', mul: 1 + v }, { s: 'shieldDelay', mul: 1 - v / 2 }], visual: 'aura' },
  { id: 'ablative', name: 'Ablative Plating', tags: ['hull'], values: [2, 4], desc: (v) => `Reduce every hit by ${v}.`, mods: (v) => [{ s: 'armor', add: v }], visual: 'ship' },
  { id: 'nanite', name: 'Nanite Mesh', tags: ['hull'], rarityStart: 1, values: [0.2, 0.4], desc: (v) => `Regenerate ${v} hull per second.`, mods: (v) => [{ s: 'regen', add: v }], visual: 'ship' },
  { id: 'thrusters', name: 'Ion Thrusters', tags: ['speed'], values: [0.08, 0.12, 0.18], desc: (v) => `+${pct(v)} speed. Longer engine plume.`, mods: (v) => [{ s: 'speed', mul: 1 + v }], visual: 'trail' },
  { id: 'afterburner', name: 'Afterburner Tank', tags: ['boost'], values: [0.3, 0.5], desc: (v) => `+${pct(v)} boost capacity and recharge.`, mods: (v) => [{ s: 'boost', mul: 1 + v }, { s: 'boostRegen', mul: 1 + v }], visual: 'trail' },
  { id: 'gyro', name: 'Gyro Rolls', tags: ['dodge'], values: [1, 1], desc: () => `+1 dodge charge, faster dodge recharge.`, mods: () => [{ s: 'dodges', add: 1 }, { s: 'dodgeCd', mul: 0.85 }], visual: 'ship' },
  { id: 'magnet', name: 'Light Magnet', tags: ['magnet'], values: [0.3, 0.5, 0.8], desc: (v) => `+${pct(v)} pickup range. A visible pull aura.`, mods: (v) => [{ s: 'magnet', mul: 1 + v }], visual: 'aura' },
  { id: 'lens', name: 'Lens Array', tags: ['light'], values: [0.1, 0.2, 0.3], desc: (v) => `+${pct(v)} Light gained.`, mods: (v) => [{ s: 'lightGain', mul: 1 + v }], visual: 'hud' },
  { id: 'grazefield', name: 'Graze Field', tags: ['graze'], values: [0.25, 0.45], desc: (v) => `+${pct(v)} graze radius and graze Lumen.`, mods: (v) => [{ s: 'grazeRadius', mul: 1 + v }, { s: 'grazeGain', mul: 1 + v }], visual: 'aura' },
  { id: 'luck', name: 'Lucky Charm', tags: [], rarityStart: 1, values: [1, 1], desc: () => `Rarer upgrades appear more often.`, mods: () => [{ s: 'luck', add: 1 }], visual: 'hud' },
  { id: 'capbank', name: 'Capacitor Bank', tags: [], values: [0.15, 0.25], desc: (v) => `Abilities recharge ${pct(v)} faster.`, mods: (v) => [{ s: 'abilityCd', mul: 1 - v }], visual: 'hud' },
  { id: 'longflare', name: 'Long Flare', tags: ['flare'], values: [2, 3], desc: (v) => `Flare lasts ${v}s longer.`, mods: (v) => [{ s: 'flareDur', add: v }], visual: 'aura' },
  { id: 'funnel', name: 'Lumen Funnel', tags: ['flare'], values: [0.25, 0.4], desc: (v) => `Lumen gauge fills ${pct(v)} faster.`, mods: (v) => [{ s: 'flareGain', mul: 1 + v }], visual: 'hud' },
  { id: 'dampers', name: 'Kinetic Dampers', tags: ['hull'], rarityStart: 1, values: [0.1, 0.15], desc: (v) => `Take ${pct(v)} less damage.`, mods: (v) => [{ s: 'damageTaken', mul: 1 - v }], visual: 'ship' },
  { id: 'shockamp', name: 'Shockwave Amplifier', tags: ['area'], values: [0.4], desc: (v) => `Shockwave (Q) is ${pct(v)} stronger and wider.`, mods: (v) => [{ s: 'shockwave', mul: 1 + v }], visual: 'explosion' },
  { id: 'stasisamp', name: 'Deep Stasis', tags: ['cryo'], values: [0.4], desc: (v) => `Stasis (E) lasts ${pct(v)} longer and reaches farther.`, mods: (v) => [{ s: 'stasis', mul: 1 + v }], visual: 'aura' },
  { id: 'merchant', name: 'Merchant Seal', tags: [], values: [0.15], desc: (v) => `Shops are ${pct(v)} cheaper.`, mods: (v) => [{ s: 'shopDiscount', add: v }], visual: 'hud' },
  { id: 'phase', name: 'Phase Coils', tags: ['dodge'], values: [0.3], desc: (v) => `Dodge invulnerability lasts ${pct(v)} longer.`, mods: (v) => [{ s: 'iframes', mul: 1 + v }], visual: 'ship' },
];

function trig(
  id: string,
  name: string,
  rarity: Rarity,
  tags: Tag[],
  desc: string,
  triggers: TriggerDef[],
  visual: UpgradeDef['visual'],
  requires?: Tag[],
): UpgradeDef {
  return { id, name, rarity, tags, desc, triggers, visual, requires, maxStacks: 3 };
}

const TRIGGERS: UpgradeDef[] = [
  trig('detonate_1', 'Detonating Kills I', 'uncommon', ['on-kill', 'area'], '25% of kills explode for 50% of the killing blow.', [{ on: 'kill', do: 'nova', p: 0.5, chance: 0.25 }], 'explosion'),
  trig('detonate_2', 'Detonating Kills II', 'rare', ['on-kill', 'area'], '40% of kills explode for 80% of the killing blow.', [{ on: 'kill', do: 'nova', p: 0.8, chance: 0.4 }], 'explosion'),
  trig('discharge', 'Static Discharge', 'uncommon', ['on-hit', 'shock', 'chain'], '10% of hits release a 3-target arc.', [{ on: 'hit', do: 'chain', p: 3, chance: 0.1 }], 'projectile'),
  trig('payload', 'Payload Seeds', 'uncommon', ['on-kill', 'homing'], '20% of kills launch 2 seeker missiles.', [{ on: 'kill', do: 'missiles', p: 2, chance: 0.2 }], 'projectile'),
  trig('scavenger', 'Scavenger Nets', 'common', ['on-kill', 'magnet'], 'Kills drop 1 extra Light mote.', [{ on: 'kill', do: 'motes', p: 1 }], 'hud'),
  trig('grazebat_1', 'Graze Battery I', 'common', ['graze', 'flare'], 'Grazes charge extra Lumen.', [{ on: 'graze', do: 'lumen', p: 2 }], 'hud'),
  trig('grazebat_2', 'Graze Battery II', 'uncommon', ['graze', 'flare'], 'Grazes charge a lot of extra Lumen.', [{ on: 'graze', do: 'lumen', p: 4 }], 'hud'),
  trig('grazesparks', 'Graze Sparks', 'uncommon', ['graze'], 'Grazes fire 4 sparks at nearby enemies.', [{ on: 'graze', do: 'shards', p: 4, cd: 0.15 }], 'projectile'),
  trig('evasive', 'Evasive Payload', 'uncommon', ['dodge', 'ordnance'], 'Dodging drops 3 mines.', [{ on: 'dodge', do: 'mine', p: 3 }], 'projectile'),
  trig('phantom', 'Phantom Step', 'rare', ['dodge', 'area'], 'Dodging releases a shockwave.', [{ on: 'dodge', do: 'nova', p: 1.2 }], 'explosion'),
  trig('blink', 'Blink Reload', 'uncommon', ['dodge'], 'Dodging reloads your secondary weapon.', [{ on: 'dodge', do: 'reload', p: 1 }], 'hud'),
  trig('flarenova', 'Flare Nova', 'rare', ['flare', 'area'], 'Activating Flare unleashes a massive nova.', [{ on: 'flare', do: 'nova', p: 4 }], 'explosion'),
  trig('flaresiphon', 'Flare Siphon', 'uncommon', ['flare', 'shield'], 'Activating Flare fully restores shields.', [{ on: 'flare', do: 'shield', p: 999 }], 'aura'),
  trig('seeker5', 'Fifth Seeker', 'uncommon', ['homing'], 'Every 5th primary shot also fires a seeker missile.', [{ on: 'nthShot', do: 'missiles', p: 1, every: 5 }], 'projectile'),
  trig('ram', 'Ram Plating', 'uncommon', ['boost', 'burn'], 'While boosting, you scorch enemies around you.', [{ on: 'boost', do: 'burnAura', p: 1 }], 'trail'),
  trig('laststand', 'Last Stand', 'rare', ['hull'], 'Below 30% hull, deal 50% more damage.', [{ on: 'lowHp', do: 'buff', p: 0.5 }], 'aura'),
  trig('retaliate', 'Retaliation Shell', 'uncommon', ['hull'], 'Taking hull damage fires 12 shards in every direction.', [{ on: 'hurt', do: 'shards', p: 12 }], 'projectile'),
  trig('breaknova', 'Shatterguard', 'rare', ['shield', 'cryo'], 'When your shield breaks, freeze everything nearby.', [{ on: 'shieldBreak', do: 'freeze', p: 1 }], 'aura'),
  trig('bounty', 'Elite Bounty', 'uncommon', ['on-kill'], 'Elite kills shower 25 extra Light.', [{ on: 'eliteKill', do: 'motes', p: 25 }], 'hud'),
  trig('critchain', 'Critical Arc', 'rare', ['crit', 'chain'], '30% of crits arc to 2 enemies.', [{ on: 'crit', do: 'chain', p: 2, chance: 0.3 }], 'projectile', ['crit']),
  trig('pickupspark', 'Kindling', 'common', ['light'], 'Collecting Light sometimes fires a spark.', [{ on: 'pickup', do: 'shards', p: 1, chance: 0.08 }], 'projectile'),
  trig('warmup', 'Warm Start', 'common', ['shield'], 'Begin each fight with a burst of shield.', [{ on: 'waveStart', do: 'shield', p: 40 }], 'aura'),
  trig('secondlumen', 'Ordnance Battery', 'common', ['ordnance', 'flare'], 'Firing your secondary charges Lumen.', [{ on: 'secondary', do: 'lumen', p: 3 }], 'hud'),
  trig('frostkill', 'Frostbite', 'uncommon', ['on-kill', 'cryo'], 'Kills chill nearby enemies.', [{ on: 'kill', do: 'freeze', p: 0.4, chance: 0.5 }], 'explosion', ['cryo']),
  trig('voidkill', 'Gravecall', 'uncommon', ['on-kill', 'void'], 'Kills open a tiny pulling well.', [{ on: 'kill', do: 'pull', p: 1, chance: 0.3 }], 'explosion', ['void']),
  trig('healkill', 'Sap Light', 'rare', ['on-kill', 'hull'], '5% of kills restore 3 hull.', [{ on: 'kill', do: 'heal', p: 3, chance: 0.05 }], 'hud'),
  trig('decoy', 'Mirage Flare', 'uncommon', ['dodge'], 'Dodging leaves a decoy that draws fire.', [{ on: 'dodge', do: 'decoy', p: 1 }], 'ship'),
];

function art(id: string, name: string, desc: string, flags: string[], tags: Tag[], visual: UpgradeDef['visual'], mods?: StatMod[], requires?: Tag[]): UpgradeDef {
  return { id, name, rarity: 'artifact', tags, desc, flags, visual, mods, requires, maxStacks: 1 };
}

const ARTIFACTS: UpgradeDef[] = [
  art('a_nova7', 'The Seventh Sun', 'Every 7th primary shot is a Nova.', ['nova7'], ['area'], 'explosion'),
  art('a_grazereload', 'Razor Halo', 'Grazes instantly reload your secondary.', ['grazeReload'], ['graze'], 'aura'),
  art('a_debris', 'Wreckmind', 'Debris you create homes in on enemies.', ['debrisHoming'], ['debris'], 'explosion', [{ s: 'debrisDamage', mul: 3 }]),
  art('a_motebomb', 'Volatile Light', 'Light motes you collect detonate around you.', ['moteBombs'], ['light', 'area'], 'explosion'),
  art('a_frozen', 'Winter Crown', 'Frozen enemies spread cryo when they die.', ['frozenSpread'], ['cryo'], 'aura', undefined, ['cryo']),
  art('a_ram', 'Lance Prow', 'Boosting through enemies deals massive damage.', ['ramBoost'], ['boost'], 'ship'),
  art('a_flarechain', 'Endless Dawn', 'Kills during Flare extend it.', ['flareChain'], ['flare'], 'aura'),
  art('a_overflow', 'Brimming Lens', 'Light beyond a full Lumen gauge becomes shield.', ['shieldOverflow'], ['shield', 'light'], 'aura'),
  art('a_critchain', 'Forked Fate', 'Every crit chains to one more enemy.', ['critChain'], ['crit', 'chain'], 'projectile'),
  art('a_glass', 'Glass Star', 'Deal double damage while your shield is full.', ['glassStar'], ['shield'], 'aura'),
  art('a_twinsoul', 'Twin Soul', 'Your secondary fires twice.', ['twinSoul'], ['ordnance'], 'projectile'),
  art('a_echo', 'Echo Chamber', '15% of projectiles are duplicated.', ['echoChamber'], ['split'], 'projectile'),
  art('a_stareater', 'Star Eater', 'Deal 40% more damage to bosses.', ['starEater'], [], 'hud'),
  art('a_wake', 'Wake of Fire', 'Your engine trail burns enemies.', ['wakeFire'], ['burn', 'speed'], 'trail'),
  art('a_heart', 'Lantern Heart', 'Every 3s the Lantern pulses with light.', ['lanternHeart'], ['light', 'area'], 'aura'),
  art('a_magnetstorm', 'Lodestar', 'Pickup range is enormous; motes orbit before landing.', ['lodestar'], ['magnet'], 'aura', [{ s: 'magnet', mul: 2.5 }]),
];

function curse(id: string, name: string, desc: string, mods: StatMod[], flags: string[] = []): UpgradeDef {
  return { id, name, rarity: 'curse', tags: ['curse'], desc, mods, flags, visual: 'ship', maxStacks: 1 };
}

const CURSES: UpgradeDef[] = [
  curse('c_glass', 'Glass Cannon', 'Half hull. +60% damage.', [{ s: 'hull', mul: 0.5 }, { s: 'globalDamage', mul: 1.6 }]),
  curse('c_hushed', 'Hushed Eyes', 'The world dims around you. +40% Light.', [{ s: 'lightGain', mul: 1.4 }], ['hushedEyes']),
  curse('c_overclock', 'Overclocked Core', '+50% fire rate. Take 30% more damage.', [{ s: 'globalRate', mul: 1.5 }, { s: 'damageTaken', mul: 1.3 }]),
  curse('c_brittle', 'Brittle Shields', 'Shields are 70% smaller but recharge 3x faster.', [{ s: 'shield', mul: 0.3 }, { s: 'shieldRegen', mul: 3 }]),
  curse('c_hunted', 'Hunted', 'More elites hunt you. Much better luck.', [{ s: 'luck', add: 3 }], ['hunted']),
  curse('c_cold', 'Cold Engines', '-20% speed. +20% crit chance.', [{ s: 'speed', mul: 0.8 }, { s: 'crit', add: 0.2 }]),
  curse('c_blood', 'Blood Light', 'Lose 0.25 hull per second. +35% damage.', [{ s: 'regen', add: -0.25 }, { s: 'globalDamage', mul: 1.35 }]),
  curse('c_fuse', 'Short Fuse', 'Flare is half as long but fills twice as fast.', [{ s: 'flareDur', mul: 0.5 }, { s: 'flareGain', mul: 2 }]),
];

export const UPGRADES: UpgradeDef[] = [
  ...WEAPON_MODS.flatMap(tiers),
  ...MASTERY.flatMap(tiers),
  ...ELEMENT_TIERS.flatMap(tiers),
  ...SHIP.flatMap(tiers),
  ...TRIGGERS,
  ...ARTIFACTS,
  ...CURSES,
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Tag-driven synergies plus elemental reactions (always on once discovered). */
export const SYNERGIES: SynergyDef[] = [
  { id: 'wildfire', name: 'Wildfire', desc: 'Burning enemies spread fire when they die.', needs: { burn: 3 }, flags: ['wildfire'], kind: 'synergy' },
  { id: 'deepfreeze', name: 'Deep Freeze', desc: 'Freezing takes fewer stacks and lasts longer.', needs: { cryo: 3 }, flags: ['deepfreeze'], kind: 'synergy' },
  { id: 'stormfront', name: 'Stormfront', desc: 'Shock chains reach twice as far.', needs: { shock: 3 }, flags: ['stormfront'], kind: 'synergy' },
  { id: 'meltdown', name: 'Meltdown', desc: 'Corroded enemies take +50% burn damage.', needs: { corrode: 2, burn: 1 }, flags: ['meltdown'], kind: 'synergy' },
  { id: 'eventhorizon', name: 'Event Horizon', desc: 'Void pulls are stronger and wells last longer.', needs: { void: 3 }, flags: ['eventhorizon'], kind: 'synergy' },
  { id: 'sunborn', name: 'Sunborn', desc: 'Light gain +30%; motes home in from farther.', needs: { light: 3 }, mods: [{ s: 'lightGain', mul: 1.3 }, { s: 'magnet', mul: 1.3 }], kind: 'synergy' },
  { id: 'hivemind', name: 'Hivemind', desc: 'Drones fire 40% faster.', needs: { drone: 2 }, mods: [{ s: 'rate', mul: 1.4, tag: 'drone' }], kind: 'synergy' },
  { id: 'artillery', name: 'Artillery Doctrine', desc: 'Explosions are 30% bigger.', needs: { ordnance: 2, area: 2 }, mods: [{ s: 'explode', mul: 1.3 }], kind: 'synergy' },
  { id: 'gunline', name: 'Gunline', desc: 'Kinetic weapons pierce +1.', needs: { kinetic: 3 }, mods: [{ s: 'pierce', add: 1, tag: 'kinetic' }], kind: 'synergy' },
  { id: 'coherence', name: 'Coherence', desc: 'Energy weapons +25% damage while shields are up.', needs: { energy: 3 }, flags: ['coherence'], kind: 'synergy' },
  { id: 'threadneedle', name: 'Threading the Needle', desc: 'Grazes grant 1s of +30% damage.', needs: { graze: 2 }, flags: ['threadneedle'], kind: 'synergy' },
  { id: 'ghoststep', name: 'Ghost Step', desc: 'Dodge has 1 extra charge and leaves afterimages that hit.', needs: { dodge: 2 }, mods: [{ s: 'dodges', add: 1 }], flags: ['ghoststep'], kind: 'synergy' },
  { id: 'hunterkiller', name: 'Hunter-Killer', desc: 'Homing projectiles crit 15% more often.', needs: { homing: 2, crit: 1 }, mods: [{ s: 'crit', add: 0.15, tag: 'homing' }], kind: 'synergy' },
  { id: 'chainreaction', name: 'Chain Reaction', desc: 'On-kill explosions can trigger more explosions.', needs: { 'on-kill': 3 }, flags: ['chainreaction'], kind: 'synergy' },
  { id: 'bulwark', name: 'Bulwark', desc: 'Shield regen doubles while you are not firing.', needs: { shield: 3 }, flags: ['bulwark'], kind: 'synergy' },
  { id: 'kinetic_orbit', name: 'Gravity Slingshot', desc: 'Orbiting weapons deal +50% damage.', needs: { orbit: 2 }, mods: [{ s: 'damage', mul: 1.5, tag: 'orbit' }], kind: 'synergy' },
  { id: 'overdrive', name: 'Overdrive Loop', desc: 'Flare also doubles projectile count.', needs: { flare: 3 }, flags: ['overdrive'], kind: 'synergy' },
  { id: 'prismatic', name: 'Prismatic Split', desc: 'Split fragments inherit full damage.', needs: { split: 3 }, flags: ['prismatic'], kind: 'synergy' },
  // Reactions: always active; discovered when first triggered.
  { id: 'r_shatter', name: 'Shatter', desc: 'Kinetic hits on frozen enemies shatter them for +150% damage and shards.', needs: {}, kind: 'reaction' },
  { id: 'r_overload', name: 'Overload', desc: 'Shock on a burning enemy triggers an overload explosion.', needs: {}, kind: 'reaction' },
  { id: 'r_melt', name: 'Melt', desc: 'Burn on a corroded enemy deals double damage.', needs: {}, kind: 'reaction' },
  { id: 'r_implosion', name: 'Implosion', desc: 'Explosions on void-marked enemies pull everything inward.', needs: {}, kind: 'reaction' },
  { id: 'r_glint', name: 'Glint', desc: 'Radiant hits on frozen enemies always crit.', needs: {}, kind: 'reaction' },
  { id: 'r_static', name: 'Static Rot', desc: 'Shock spreads corrosion to chained enemies.', needs: {}, kind: 'reaction' },
];
