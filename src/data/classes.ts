import type { HullDef, StatMod, TriggerDef } from '../game/types';

/**
 * Pilot classes. Each class flies its own starting ship with its own weapons
 * and passive, and grows a persistent three-branch skill tree from class XP
 * earned on every dive. All three are free and can be picked before any dive.
 *
 * Skill nodes reuse the build's own vocabulary (stat mods, triggers, flags), so
 * they stack with drafts exactly like upgrades do. Keystone flags that need
 * code are prefixed with the class (vg*, st*, cd*) and handled in the sim.
 */

export type ClassId = 'vanguard' | 'striker' | 'conduit';

export interface SkillNode {
  id: string;
  name: string;
  desc: string;
  /** 1..4; tier n needs tier n-1 of the same branch. Tier 4 is the keystone. */
  tier: number;
  cost: number;
  mods?: StatMod[];
  triggers?: TriggerDef[];
  flags?: string[];
}

export interface SkillBranch {
  id: string;
  name: string;
  desc: string;
  nodes: SkillNode[];
}

export interface ClassDef {
  id: ClassId;
  name: string;
  /** one-line role, shown under the name */
  role: string;
  lore: string;
  /** the class ship (also listed in HULLS so runs, saves and the renderer treat it like any hull) */
  hull: HullDef;
  /** always-on class passive (on top of the hull's stats) */
  passiveMods?: StatMod[];
  /** 0..1 ratings for the class card */
  ratings: { offense: number; defense: number; mobility: number; difficulty: number };
  branches: SkillBranch[];
}

export const MAX_CLASS_LEVEL = 12;
/** cost of each tier, by tier number */
export const TIER_COST = [0, 1, 1, 2, 3];

const n = (id: string, tier: number, name: string, desc: string, e: Omit<SkillNode, 'id' | 'tier' | 'name' | 'desc' | 'cost'>): SkillNode => ({
  id,
  tier,
  name,
  desc,
  cost: TIER_COST[tier]!,
  ...e,
});

export const CLASSES: ClassDef[] = [
  {
    id: 'vanguard',
    name: 'Vanguard',
    role: 'Heavy assault · holds the line',
    lore: 'Hearth militia pilots in a slab of armor. The Aegis was built to stand in front of the light and take the hits meant for it.',
    hull: {
      id: 'aegis', name: 'Aegis', classId: 'vanguard', desc: 'An armored gunship with a siege mortar under its keel.',
      passive: 'Bulwark Plating: +1 armor; shields regenerate twice as fast while you keep firing.',
      stats: { hull: 20, shield: 5, armor: 1, speed: 0.9, shockwave: 1.2 },
      start: { primary: 'flak', secondary: 'mortar' }, flags: ['bulwark'], cost: 0, accent: '#ffb35c',
    },
    ratings: { offense: 0.7, defense: 1, mobility: 0.35, difficulty: 0.25 },
    branches: [
      {
        id: 'bulwark', name: 'Bulwark', desc: 'Survive anything.',
        nodes: [
          n('vg_plating', 1, 'Reinforced Plating', '+20 max hull.', { mods: [{ s: 'hull', add: 20 }] }),
          n('vg_reactive', 2, 'Reactive Armor', '+1 armor and +15% max shield.', { mods: [{ s: 'armor', add: 1 }, { s: 'shield', mul: 1.15 }] }),
          n('vg_barrier', 3, 'Hardlight Barrier', 'Taking hull damage restores 10 shield (5 s cooldown).', { triggers: [{ on: 'hurt', do: 'shield', p: 10, cd: 5 }] }),
          n('vg_laststand', 4, 'Unbreakable', 'Keystone. A killing blow leaves you at 1 hull with 2 s of invulnerability instead. Recharges after 60 s.', { flags: ['vgLastStand'] }),
        ],
      },
      {
        id: 'siege', name: 'Siege', desc: 'Bigger shells, bigger craters.',
        nodes: [
          n('vg_shells', 1, 'Heavy Shells', '+15% damage with area weapons.', { mods: [{ s: 'damage', mul: 1.15, tag: 'area' }] }),
          n('vg_payload', 2, 'Wide Payload', '+25% explosion radius.', { mods: [{ s: 'explode', mul: 1.25 }] }),
          n('vg_barrage', 3, 'Barrage', 'Firing your secondary also launches 2 seeking missiles.', { triggers: [{ on: 'secondary', do: 'missiles', p: 2 }] }),
          n('vg_quake', 4, 'Earthshaker', 'Keystone. Kills have a 30% chance to detonate; Shockwave is 40% larger.', { mods: [{ s: 'shockwave', mul: 1.4 }], triggers: [{ on: 'kill', do: 'nova', p: 0.6, chance: 0.3 }] }),
        ],
      },
      {
        id: 'command', name: 'Command', desc: 'Hit back harder the more you are hit.',
        nodes: [
          n('vg_rally', 1, 'Rally', '+8% fire rate.', { mods: [{ s: 'globalRate', mul: 1.08 }] }),
          n('vg_retaliate', 2, 'Retaliation', 'Taking hull damage releases a nova (2 s cooldown).', { triggers: [{ on: 'hurt', do: 'nova', p: 1.5, cd: 2 }] }),
          n('vg_cooldown', 3, 'Field Doctrine', 'Abilities recharge 20% faster; a broken shield releases a nova (6 s cooldown).', { mods: [{ s: 'abilityCd', mul: 0.8 }], triggers: [{ on: 'shieldBreak', do: 'nova', p: 2, cd: 6 }] }),
          n('vg_ironwill', 4, 'Iron Will', 'Keystone. Deal up to +50% damage and take up to 30% less damage as your hull drops.', { flags: ['vgIronWill'] }),
        ],
      },
    ],
  },
  {
    id: 'striker',
    name: 'Striker',
    role: 'Interceptor · precision and speed',
    lore: 'Couriers who learned to fight on the run. The Kestrel is all engine and one very sharp gun.',
    hull: {
      id: 'kestrel', name: 'Kestrel', classId: 'striker', desc: 'A needle-nosed interceptor with a magnetic coilgun.',
      passive: 'Slipstream: +1 dodge and faster dodge recharge; each dodge primes +30% damage for 1.5 s.',
      stats: { hull: -20, speed: 1.2, boost: 1.25, boostRegen: 1.2, dodges: 1, dodgeCd: 0.85 },
      start: { primary: 'coilshot', secondary: 'clusterpod' }, flags: ['stSlipstream'], cost: 0, accent: '#7fe3ff',
    },
    ratings: { offense: 0.9, defense: 0.3, mobility: 1, difficulty: 0.75 },
    branches: [
      {
        id: 'precision', name: 'Precision', desc: 'Every shot a critical one.',
        nodes: [
          n('st_optics', 1, 'Keen Optics', '+5% critical chance.', { mods: [{ s: 'crit', add: 0.05 }] }),
          n('st_weakpoint', 2, 'Weak Points', '+40% critical damage.', { mods: [{ s: 'critMul', add: 0.4 }] }),
          n('st_marked', 3, 'Marked Prey', 'Crits have a 30% chance to arc lightning to 2 nearby enemies.', { triggers: [{ on: 'crit', do: 'chain', p: 2, chance: 0.3 }] }),
          n('st_deadeye', 4, 'Deadeye', 'Keystone. Your locked-on target takes +30% damage from you; the lock holds longer.', { flags: ['stDeadeye'] }),
        ],
      },
      {
        id: 'velocity', name: 'Velocity', desc: 'Never be where the shot lands.',
        nodes: [
          n('st_thrust', 1, 'Afterburners', '+12% speed and +20% boost.', { mods: [{ s: 'speed', mul: 1.12 }, { s: 'boost', mul: 1.2 }] }),
          n('st_slip', 2, 'Slip Drive', '+1 dodge; dodges recharge 15% faster.', { mods: [{ s: 'dodges', add: 1 }, { s: 'dodgeCd', mul: 0.85 }] }),
          n('st_afterimage', 3, 'Afterimage', 'Dodging leaves a decoy that draws fire.', { triggers: [{ on: 'dodge', do: 'decoy', p: 1, cd: 2 }] }),
          n('st_phase', 4, 'Phase Strike', 'Keystone. Dodging launches 4 seeking missiles and longer i-frames.', { mods: [{ s: 'iframes', add: 0.25 }], triggers: [{ on: 'dodge', do: 'missiles', p: 4 }] }),
        ],
      },
      {
        id: 'hunter', name: 'Hunter', desc: 'Seek, swarm, reload.',
        nodes: [
          n('st_seeker', 1, 'Seeker Link', 'Projectiles home in (+2 turn).', { mods: [{ s: 'homing', add: 2 }] }),
          n('st_cluster', 2, 'Cluster Payload', '+1 projectile on ordnance.', { mods: [{ s: 'count', add: 1, tag: 'ordnance' }] }),
          n('st_reload', 3, 'Hot Reload', 'Kills have a 20% chance to reload your secondary.', { triggers: [{ on: 'kill', do: 'reload', p: 1, chance: 0.2 }] }),
          n('st_predator', 4, 'Predator', 'Keystone. Kills restore 4 shield; +10% fire rate.', { mods: [{ s: 'globalRate', mul: 1.1 }], triggers: [{ on: 'kill', do: 'shield', p: 4 }] }),
        ],
      },
    ],
  },
  {
    id: 'conduit',
    name: 'Conduit',
    role: 'Technomancer · lightning, drones and gravity',
    lore: 'Choir defectors who wire their nerves into the ship. The Loom spins storms and pulls the dark into knots.',
    hull: {
      id: 'loom', name: 'Loom', classId: 'conduit', desc: 'A ring-hulled tech ship trailing its own drone wing.',
      passive: 'Overcharge: status effects you apply are 25% stronger; abilities recharge 15% faster.',
      stats: { hull: -20, shield: 5, abilityCd: 0.85 },
      start: { primary: 'arc', secondary: 'gravwell', system: 'interceptors' }, flags: [], cost: 0, accent: '#c79bff',
    },
    passiveMods: [{ s: 'statusPower', mul: 1.25 }],
    ratings: { offense: 0.75, defense: 0.55, mobility: 0.6, difficulty: 0.5 },
    branches: [
      {
        id: 'storm', name: 'Storm', desc: 'Lightning that never stops jumping.',
        nodes: [
          n('cd_capacitor', 1, 'Capacitors', '+15% damage with shock weapons.', { mods: [{ s: 'damage', mul: 1.15, tag: 'shock' }] }),
          n('cd_fork', 2, 'Forked Lightning', '+1 chain jump and +0.15 shock.', { mods: [{ s: 'chain', add: 1 }, { s: 'shock', add: 0.15 }] }),
          n('cd_static', 3, 'Static Field', 'Crits have a 35% chance to arc lightning to 3 nearby enemies.', { triggers: [{ on: 'crit', do: 'chain', p: 3, chance: 0.35 }] }),
          n('cd_stormcall', 4, 'Stormcaller', 'Keystone. Shock chains reach twice as far; kills arc to 2 more enemies.', { flags: ['stormfront'], triggers: [{ on: 'kill', do: 'chain', p: 2 }] }),
        ],
      },
      {
        id: 'swarm', name: 'Swarm', desc: 'A wing that grows with you.',
        nodes: [
          n('cd_uplink', 1, 'Drone Uplink', '+20% drone damage.', { mods: [{ s: 'damage', mul: 1.2, tag: 'drone' }] }),
          n('cd_wing', 2, 'Second Wing', '+1 drone.', { mods: [{ s: 'count', add: 1, tag: 'drone' }] }),
          n('cd_repair', 3, 'Repair Protocol', 'Kills have a 30% chance to restore 6 shield; +1 hull regen per 10 s.', { mods: [{ s: 'regen', add: 0.1 }], triggers: [{ on: 'kill', do: 'shield', p: 6, chance: 0.3 }] }),
          n('cd_hive', 4, 'Hive Mind', 'Keystone. Drones fire 50% faster and gain another drone.', { mods: [{ s: 'rate', mul: 1.5, tag: 'drone' }, { s: 'count', add: 1, tag: 'drone' }] }),
        ],
      },
      {
        id: 'void', name: 'Void', desc: 'Bend space, then break it.',
        nodes: [
          n('cd_lens', 1, 'Event Lens', '+15% damage with exotic weapons.', { mods: [{ s: 'damage', mul: 1.15, tag: 'exotic' }] }),
          n('cd_deepwell', 2, 'Deep Well', 'Gravity effects last 30% longer and reach 20% farther.', { mods: [{ s: 'life', mul: 1.3, tag: 'void' }, { s: 'range', mul: 1.2, tag: 'void' }] }),
          n('cd_horizon', 3, 'Event Horizon', 'Void pulls are stronger and wells last longer.', { flags: ['eventhorizon'] }),
          n('cd_collapse', 4, 'Collapse', 'Keystone. Kills have a 25% chance to open a small singularity that drags enemies in.', { triggers: [{ on: 'kill', do: 'pull', p: 1, chance: 0.25, cd: 1 }] }),
        ],
      },
    ],
  },
];

export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
export const CLASS_HULLS: HullDef[] = CLASSES.map((c) => c.hull);
export const CLASS_BY_HULL: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.hull.id, c]));
export const SKILL_BY_ID: Record<string, { node: SkillNode; branch: SkillBranch; cls: ClassDef }> = Object.fromEntries(
  CLASSES.flatMap((cls) => cls.branches.flatMap((branch) => branch.nodes.map((node) => [node.id, { node, branch, cls }]))),
);

// ------------------------------------------------------------ progression

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 200 + 150 * (level - 1);
}

/** Level and progress for a lifetime XP total. */
export function classLevel(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (level < MAX_CLASS_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: level >= MAX_CLASS_LEVEL ? 0 : rest, need: level >= MAX_CLASS_LEVEL ? 0 : xpToNext(level) };
}

/** Skill points granted by a level: one per level. */
export function skillPoints(level: number): number {
  return Math.max(0, Math.min(MAX_CLASS_LEVEL, level));
}

export function spentPoints(learned: readonly string[]): number {
  return learned.reduce((a, id) => a + (SKILL_BY_ID[id]?.node.cost ?? 0), 0);
}

/** Class XP for a finished dive. */
export function xpForRun(r: { sector: number; kills: number; bosses: number; won: boolean; endlessWaves?: number }): number {
  return Math.round(r.kills * 2 + Math.max(0, r.sector - 1) * 80 + r.bosses * 150 + (r.won ? 300 : 0) + (r.endlessWaves ?? 0) * 40);
}

export type LearnCheck = 'ok' | 'owned' | 'locked' | 'points' | 'unknown';

/** Can `nodeId` be learned on top of `learned` with `points` total? */
export function canLearn(classId: string, learned: readonly string[], nodeId: string, points: number): LearnCheck {
  const hit = SKILL_BY_ID[nodeId];
  if (!hit || hit.cls.id !== classId) return 'unknown';
  if (learned.includes(nodeId)) return 'owned';
  const prev = hit.branch.nodes.find((x) => x.tier === hit.node.tier - 1);
  if (prev && !learned.includes(prev.id)) return 'locked';
  if (spentPoints(learned) + hit.node.cost > points) return 'points';
  return 'ok';
}

/** A node can be refunded only when nothing above it in its branch is learned. */
export function canUnlearn(learned: readonly string[], nodeId: string): boolean {
  const hit = SKILL_BY_ID[nodeId];
  if (!hit || !learned.includes(nodeId)) return false;
  return !hit.branch.nodes.some((x) => x.tier > hit.node.tier && learned.includes(x.id));
}

/** Drop unknown ids and any node whose prerequisite is missing (e.g. after a content change). */
export function sanitizeLearned(classId: string, learned: readonly string[], points: number): string[] {
  const out: string[] = [];
  const cls = CLASS_BY_ID[classId];
  if (!cls) return out;
  for (let tier = 1; tier <= 4; tier++)
    for (const b of cls.branches)
      for (const node of b.nodes) if (node.tier === tier && learned.includes(node.id) && canLearn(classId, out, node.id, points) === 'ok') out.push(node.id);
  return out;
}

export interface SkillLoadout {
  mods: StatMod[];
  triggers: TriggerDef[];
  flags: string[];
}

/** Everything a class passive plus its learned nodes add to a build. */
export function skillLoadout(classId: string | undefined, learned: readonly string[]): SkillLoadout {
  const out: SkillLoadout = { mods: [], triggers: [], flags: [] };
  const cls = classId ? CLASS_BY_ID[classId] : undefined;
  if (!cls) return out;
  out.mods.push(...(cls.passiveMods ?? []));
  for (const id of learned) {
    const hit = SKILL_BY_ID[id];
    if (!hit || hit.cls.id !== cls.id) continue;
    out.mods.push(...(hit.node.mods ?? []));
    out.triggers.push(...(hit.node.triggers ?? []));
    out.flags.push(...(hit.node.flags ?? []));
  }
  return out;
}
