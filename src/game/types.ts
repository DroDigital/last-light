/** Shared content types. All content lives in src/data as typed data. */

export type Tag =
  | 'kinetic'
  | 'energy'
  | 'ordnance'
  | 'exotic'
  | 'drone'
  | 'light'
  | 'homing'
  | 'burn'
  | 'cryo'
  | 'shock'
  | 'corrode'
  | 'void'
  | 'radiant'
  | 'pierce'
  | 'split'
  | 'ricochet'
  | 'area'
  | 'crit'
  | 'on-kill'
  | 'on-hit'
  | 'graze'
  | 'dodge'
  | 'flare'
  | 'boost'
  | 'shield'
  | 'hull'
  | 'speed'
  | 'magnet'
  | 'chain'
  | 'orbit'
  | 'heat'
  | 'rapid'
  | 'charge'
  | 'debris'
  | 'curse';

export type Family = 'kinetic' | 'energy' | 'ordnance' | 'exotic' | 'drone' | 'light';
export type Slot = 'primary' | 'secondary' | 'system';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'artifact' | 'curse';
export type StatusKind = 'burn' | 'cryo' | 'shock' | 'corrode' | 'void' | 'radiant';

export type Behavior =
  | 'bullet'
  | 'rail'
  | 'beam'
  | 'arc'
  | 'missile'
  | 'mine'
  | 'nova'
  | 'well'
  | 'drone'
  | 'halo'
  | 'pulse';

/** Weapon parameters that upgrades can modify. */
export interface WeaponParams {
  damage: number;
  rate: number;
  speed: number;
  life: number;
  size: number;
  count: number;
  spread: number;
  pierce: number;
  homing: number;
  ricochet: number;
  split: number;
  explode: number;
  chain: number;
  knock: number;
  crit: number;
  critMul: number;
  burn: number;
  cryo: number;
  shock: number;
  corrode: number;
  void: number;
  radiant: number;
  statusPower: number;
  /** Beam length / arc range / pulse radius etc. */
  range: number;
  /** behavior-specific: drones count, mines arm time, well pull strength */
  special: number;
}

export type WeaponStat = keyof WeaponParams;

export interface WeaponDef {
  id: string;
  name: string;
  family: Family;
  slot: Slot;
  tags: Tag[];
  desc: string;
  behavior: Behavior;
  base: Partial<WeaponParams> & { damage: number; rate: number };
  /** HDR tint used for muzzle light, trails, explosions. Projectiles use reserved tones. */
  color: string;
  sfx: 'kinetic' | 'heavy' | 'energy' | 'beam' | 'arc' | 'missile' | 'mine' | 'exotic' | 'drone' | 'light' | 'rail' | 'scatter';
  recoil?: number;
  shake?: number;
  evolve: { tag: Tag; name: string; desc: string; mods: Partial<WeaponParams>; color?: string };
  unlock?: number; // embers cost; 0/undefined = starter pool
}

export type ShipStat =
  | 'hull'
  | 'shield'
  | 'shieldRegen'
  | 'shieldDelay'
  | 'armor'
  | 'speed'
  | 'boost'
  | 'boostRegen'
  | 'dodges'
  | 'dodgeCd'
  | 'magnet'
  | 'lightGain'
  | 'regen'
  | 'grazeRadius'
  | 'grazeGain'
  | 'luck'
  | 'abilityCd'
  | 'flareDur'
  | 'flareGain'
  | 'damageTaken'
  | 'globalDamage'
  | 'globalRate'
  | 'iframes'
  | 'shockwave'
  | 'stasis'
  | 'debrisDamage'
  | 'heatGain'
  | 'shopDiscount';

export interface StatMod {
  /** weapon stat or ship stat */
  s: WeaponStat | ShipStat;
  add?: number;
  mul?: number;
  /** if set, applies only to weapons carrying this tag/family */
  tag?: Tag;
}

export type TriggerOn =
  | 'kill'
  | 'hit'
  | 'crit'
  | 'dodge'
  | 'graze'
  | 'flare'
  | 'nthShot'
  | 'boost'
  | 'lowHp'
  | 'hurt'
  | 'pickup'
  | 'shieldBreak'
  | 'secondary'
  | 'eliteKill'
  | 'waveStart';

export type TriggerDo =
  | 'nova'
  | 'chain'
  | 'missiles'
  | 'shield'
  | 'heal'
  | 'motes'
  | 'lumen'
  | 'reload'
  | 'mine'
  | 'shards'
  | 'freeze'
  | 'pull'
  | 'buff'
  | 'burnAura'
  | 'decoy';

export interface TriggerDef {
  on: TriggerOn;
  do: TriggerDo;
  /** power: damage scale, count, amount depending on action */
  p: number;
  chance?: number;
  every?: number;
  cd?: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  rarity: Rarity;
  tags: Tag[];
  desc: string;
  /** offered only if the build already has one of these tags */
  requires?: Tag[];
  mods?: StatMod[];
  triggers?: TriggerDef[];
  flags?: string[];
  maxStacks?: number;
  /** which visual layer this changes (for the "no invisible upgrades" rule) */
  visual: 'projectile' | 'ship' | 'trail' | 'aura' | 'explosion' | 'drone' | 'hud';
  unlock?: number;
  family?: string; // tier chain id
}

export interface SynergyDef {
  id: string;
  name: string;
  desc: string;
  needs: Partial<Record<Tag, number>>;
  flags?: string[];
  mods?: StatMod[];
  kind: 'synergy' | 'reaction';
}

export type AiRole =
  | 'swarmer'
  | 'charger'
  | 'sniper'
  | 'gunner'
  | 'shielder'
  | 'splitter'
  | 'minelayer'
  | 'healer'
  | 'carrier'
  | 'turret'
  | 'mimic'
  | 'bomber'
  | 'orbiter'
  | 'lancer'
  | 'inert'
  | 'boss'
  | 'part';

export type Faction = 'hush' | 'salvage' | 'choir' | 'none';

export interface EnemyDef {
  id: string;
  name: string;
  faction: Faction;
  role: AiRole;
  mesh: import('../render/meshes').MeshKind;
  scale: number;
  hp: number;
  speed: number;
  radius: number;
  contact: number;
  armor?: number;
  accent: string;
  light: number;
  threat: number; // director cost
  fire?: { rate: number; speed: number; count: number; spread: number; kind: 1 | 2; damage: number };
  desc: string;
  minSector?: number;
}

export interface HullDef {
  id: string;
  name: string;
  desc: string;
  passive: string;
  stats: Partial<Record<ShipStat, number>>;
  start: { primary: string; secondary: string; system?: string };
  flags: string[];
  cost: number;
  accent: string;
  /** set on the three class ships (src/data/classes.ts): always owned, with a skill tree */
  classId?: string;
}
