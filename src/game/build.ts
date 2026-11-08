import type {
  HullDef,
  Rarity,
  ShipStat,
  StatMod,
  Tag,
  TriggerDef,
  UpgradeDef,
  WeaponDef,
  WeaponParams,
  WeaponStat,
} from './types';
import { UPGRADES, SYNERGIES } from '../data/upgrades';
import { WEAPONS, WEAPON_BY_ID } from '../data/weapons';
import type { Rng } from '../core/rng';
import type { SkillLoadout } from '../data/classes';
import { EFFECTS, type LootItem, type LootSlot, type WeaponSide } from './loot';

export const MAX_LEVEL = 5;
export const MAX_SYSTEMS = 3;
/** Linked hardpoints a run starts with: extra guns that fire with the primary/secondary trigger. */
export const BASE_LINKS = 2;
/** Most linked hardpoints a build can carry (Auxiliary Hardpoint upgrades add the rest). */
export const MAX_LINKS = 4;

const WEAPON_STATS = new Set<string>([
  'damage', 'rate', 'speed', 'life', 'size', 'count', 'spread', 'pierce', 'homing', 'ricochet', 'split',
  'explode', 'chain', 'knock', 'crit', 'critMul', 'burn', 'cryo', 'shock', 'corrode', 'void', 'radiant',
  'statusPower', 'range', 'special',
]);

/** Stats where hull overrides are additive rather than multipliers. */
const ADDITIVE_SHIP = new Set<ShipStat>(['hull', 'shield', 'dodges', 'armor', 'regen', 'luck', 'flareDur', 'shopDiscount']);

export const BASE_SHIP: Record<ShipStat, number> = {
  hull: 100,
  shield: 40,
  shieldRegen: 10,
  shieldDelay: 3,
  armor: 0,
  speed: 1,
  boost: 1,
  boostRegen: 1,
  dodges: 2,
  dodgeCd: 2.2,
  magnet: 16,
  lightGain: 1,
  regen: 0,
  grazeRadius: 4.5,
  grazeGain: 1,
  luck: 0,
  abilityCd: 1,
  flareDur: 7,
  flareGain: 1,
  damageTaken: 1,
  globalDamage: 1,
  globalRate: 1,
  iframes: 0.45,
  shockwave: 1,
  stasis: 1,
  debrisDamage: 1,
  heatGain: 1,
  shopDiscount: 0,
};

const DEFAULT_PARAMS: WeaponParams = {
  damage: 1, rate: 1, speed: 200, life: 1, size: 0.3, count: 1, spread: 0, pierce: 0, homing: 0, ricochet: 0,
  split: 0, explode: 0, chain: 0, knock: 0, crit: 0.05, critMul: 2, burn: 0, cryo: 0, shock: 0, corrode: 0,
  void: 0, radiant: 0, statusPower: 1, range: 0, special: 0,
};

export class WeaponInstance {
  level = 1;
  evolved = false;
  params: WeaponParams = { ...DEFAULT_PARAMS };
  cd = 0;
  shots = 0;
  heat = 0;
  damageDealt = 0;
  kills = 0;
  /** index into the world params registry */
  slotIndex = 0;
  constructor(public def: WeaponDef) {}

  get name(): string {
    return this.evolved ? this.def.evolve.name : this.def.name;
  }
  get color(): string {
    return this.evolved ? (this.def.evolve.color ?? this.def.color) : this.def.color;
  }
  hasTag(t: Tag): boolean {
    return this.def.tags.includes(t) || this.def.family === t;
  }
}

export type DraftCard =
  | { kind: 'upgrade'; def: UpgradeDef; combo: number }
  | { kind: 'weapon'; def: WeaponDef; combo: number }
  | { kind: 'level'; weapon: WeaponInstance; combo: number }
  | { kind: 'evolve'; weapon: WeaponInstance; combo: number };

export interface BuildMeta {
  bonusHull: number;
  bonusShield: number;
  bonusLight: number;
  unlockedWeapons: Set<string>;
  tier2: boolean;
  heat: number;
}

export class Build {
  hull: HullDef;
  primary: WeaponInstance;
  secondary: WeaponInstance;
  /**
   * Linked hardpoints: extra primary/secondary weapons. Each fires on its own
   * cooldown whenever the matching trigger is held, alongside the main gun.
   */
  linked: WeaponInstance[] = [];
  systems: WeaponInstance[] = [];
  upgrades = new Map<string, number>();
  tags: Partial<Record<Tag, number>> = {};
  flags = new Set<string>();
  synergies = new Set<string>();
  triggers: TriggerDef[] = [];
  ship: Record<ShipStat, number> = { ...BASE_SHIP };
  banished = new Set<string>();
  meta: BuildMeta;
  /** Run-local components and their equipment mounts. */
  inventory: LootItem[] = [];
  equipment: Record<LootSlot, string | null> = { port: null, starboard: null, propulsion: null };
  effects: Record<WeaponSide, [string | null, string | null]> = { port: [null, null], starboard: [null, null] };
  unlockedEffects = new Set<string>();
  /** history for the run summary */
  picks: string[] = [];
  /** class passive + learned skill-tree nodes (fixed for the run) */
  skills: SkillLoadout = { mods: [], triggers: [], flags: [] };

  constructor(hull: HullDef, meta: BuildMeta, primaryOverride?: string) {
    this.hull = hull;
    this.meta = meta;
    this.primary = new WeaponInstance(WEAPON_BY_ID[primaryOverride ?? hull.start.primary]!);
    this.secondary = new WeaponInstance(WEAPON_BY_ID[hull.start.secondary]!);
    if (hull.start.system) this.systems.push(new WeaponInstance(WEAPON_BY_ID[hull.start.system]!));
    for (const f of hull.flags) this.flags.add(f);
    this.recompute();
  }

  /** Apply a class passive and skill-tree loadout for this run. */
  setSkills(loadout: SkillLoadout): void {
    this.skills = loadout;
    this.recompute();
  }

  addLoot(item: LootItem): void {
    if (this.inventory.some((entry) => entry.id === item.id)) return;
    this.inventory.push(item);
    if (item.effectId && EFFECTS.some((effect) => effect.id === item.effectId)) this.unlockedEffects.add(item.effectId);
  }

  equipLoot(id: string): boolean {
    const item = this.inventory.find((entry) => entry.id === id);
    if (!item) return false;
    this.equipment[item.slot] = item.id;
    this.recompute();
    return true;
  }

  unequipLoot(slot: LootSlot): boolean {
    if (!this.equipment[slot]) return false;
    this.equipment[slot] = null;
    this.recompute();
    return true;
  }

  /** Returns the remaining Light, or null if the purchase is invalid. */
  installEffect(side: WeaponSide, index: number, effectId: string, light: number): number | null {
    const effect = EFFECTS.find((entry) => entry.id === effectId);
    if ((side !== 'port' && side !== 'starboard') || (index !== 0 && index !== 1) || !effect || !this.unlockedEffects.has(effectId) || light < effect.cost || !Number.isFinite(light)) return null;
    if (this.effects[side][index] === effectId) return null;
    this.effects[side][index] = effectId;
    return light - effect.cost;
  }

  removeEffect(side: WeaponSide, index: number): boolean {
    if ((side !== 'port' && side !== 'starboard') || (index !== 0 && index !== 1) || !this.effects[side][index]) return false;
    this.effects[side][index] = null;
    return true;
  }

  /** Stats for one hardpoint, used at fire time so each side keeps its own roll. */
  getSideParams(side: WeaponSide): WeaponParams {
    const params = { ...this.primary.params };
    const item = this.inventory.find((entry) => entry.id === this.equipment[side]);
    const trait = item?.trait;
    const traitMods = trait?.behaviors && !trait.behaviors.includes(this.primary.def.behavior) ? trait.fallbackMods : trait?.mods;
    const mods = [...(item?.mods ?? []), ...(traitMods ?? []), ...this.effects[side].flatMap((id) => EFFECTS.find((effect) => effect.id === id)?.mods ?? [])];
    for (const mod of mods) if (WEAPON_STATS.has(mod.s) && mod.add !== undefined) params[mod.s as WeaponStat] += mod.add;
    for (const mod of mods) if (WEAPON_STATS.has(mod.s) && mod.mul !== undefined) params[mod.s as WeaponStat] *= mod.mul;
    params.count = Math.max(1, Math.round(params.count));
    params.pierce = Math.round(params.pierce);
    params.ricochet = Math.round(params.ricochet);
    params.split = Math.round(params.split);
    params.chain = Math.round(params.chain);
    return params;
  }

  get weapons(): WeaponInstance[] {
    return [this.primary, this.secondary, ...this.linked, ...this.systems];
  }

  /** How many linked hardpoints this build has (base + Auxiliary Hardpoint stacks). */
  get linkSlots(): number {
    return Math.min(MAX_LINKS, BASE_LINKS + (this.upgrades.get('aux_hardpoint') ?? 0));
  }

  /** The linked weapon a new primary/secondary would push out (null while a hardpoint is free). */
  linkVictim(): WeaponInstance | null {
    return this.linked.length >= this.linkSlots ? this.linked[0]! : null;
  }

  ownsWeapon(id: string): WeaponInstance | undefined {
    return this.weapons.find((w) => w.def.id === id);
  }

  addUpgrade(def: UpgradeDef): void {
    this.upgrades.set(def.id, (this.upgrades.get(def.id) ?? 0) + 1);
    this.picks.push(def.id);
    this.recompute();
  }

  /** Equip a weapon: replaces primary/secondary by slot, or fills a system slot. */
  addWeapon(def: WeaponDef): WeaponInstance {
    const owned = this.ownsWeapon(def.id);
    if (owned) {
      this.levelUp(owned);
      return owned;
    }
    const w = new WeaponInstance(def);
    if (def.slot === 'primary' || def.slot === 'secondary') {
      // new guns mount on a linked hardpoint and fire alongside the main ones;
      // when every hardpoint is full the oldest linked gun is swapped out
      if (this.linked.length >= this.linkSlots) this.linked.shift();
      this.linked.push(w);
    } else {
      if (this.systems.length >= MAX_SYSTEMS) this.systems.shift();
      this.systems.push(w);
    }
    this.picks.push('w:' + def.id);
    this.recompute();
    return w;
  }

  levelUp(w: WeaponInstance): void {
    if (w.level < MAX_LEVEL) w.level++;
    this.recompute();
  }

  canEvolve(w: WeaponInstance): boolean {
    return !w.evolved && w.level >= MAX_LEVEL && (this.tags[w.def.evolve.tag] ?? 0) > 0;
  }

  evolve(w: WeaponInstance): void {
    w.evolved = true;
    this.picks.push('e:' + w.def.id);
    this.recompute();
  }

  recompute(): void {
    // tags
    const tags: Partial<Record<Tag, number>> = {};
    const addTag = (t: Tag, n = 1) => (tags[t] = (tags[t] ?? 0) + n);
    for (const w of this.weapons) for (const t of w.def.tags) addTag(t);
    const mods: StatMod[] = [...this.skills.mods];
    const triggers: TriggerDef[] = [...this.skills.triggers];
    const flags = new Set<string>([...this.hull.flags, ...this.skills.flags]);
    for (const [id, n] of this.upgrades) {
      const u = UPGRADES.find((x) => x.id === id);
      if (!u) continue;
      for (const t of u.tags) addTag(t, n);
      for (let i = 0; i < n; i++) {
        if (u.mods) mods.push(...u.mods);
        if (u.triggers) triggers.push(...u.triggers);
      }
      for (const f of u.flags ?? []) flags.add(f);
    }
    // synergies
    const syn = new Set<string>();
    for (const s of SYNERGIES) {
      if (s.kind !== 'synergy') continue;
      let ok = true;
      for (const [t, need] of Object.entries(s.needs)) if ((tags[t as Tag] ?? 0) < (need as number)) ok = false;
      if (ok) {
        syn.add(s.id);
        if (s.mods) mods.push(...s.mods);
        for (const f of s.flags ?? []) flags.add(f);
      }
    }
    this.tags = tags;
    this.flags = flags;
    this.synergies = syn;
    this.triggers = triggers;

    // ship stats
    const ship: Record<ShipStat, number> = { ...BASE_SHIP };
    for (const [k, v] of Object.entries(this.hull.stats) as [ShipStat, number][]) {
      if (ADDITIVE_SHIP.has(k)) ship[k] += v;
      else ship[k] *= v;
    }
    ship.hull += this.meta.bonusHull;
    ship.shield += this.meta.bonusShield;
    ship.lightGain *= 1 + this.meta.bonusLight;
    for (const m of mods) {
      if (WEAPON_STATS.has(m.s) || m.tag) continue;
      const k = m.s as ShipStat;
      if (m.add !== undefined) ship[k] += m.add;
    }
    for (const m of mods) {
      if (WEAPON_STATS.has(m.s) || m.tag) continue;
      const k = m.s as ShipStat;
      if (m.mul !== undefined) ship[k] *= m.mul;
    }
    const propulsion = this.inventory.find((entry) => entry.id === this.equipment.propulsion);
    for (const mod of [...(propulsion?.mods ?? []), ...(propulsion?.trait?.mods ?? [])]) {
      const stat = mod.s as ShipStat;
      if (!(stat in ship)) continue;
      if (mod.add !== undefined) ship[stat] += mod.add;
      if (mod.mul !== undefined) ship[stat] *= mod.mul;
    }
    ship.hull = Math.max(20, Math.round(ship.hull));
    ship.shield = Math.max(0, Math.round(ship.shield));
    ship.dodges = Math.max(1, Math.round(ship.dodges));
    this.ship = ship;

    for (const w of this.weapons) this.computeWeapon(w, mods);
  }

  private computeWeapon(w: WeaponInstance, mods: StatMod[]): void {
    const p: WeaponParams = { ...DEFAULT_PARAMS, ...w.def.base };
    if (w.evolved) Object.assign(p, w.def.evolve.mods);
    const lv = w.level - 1;
    p.damage *= 1 + 0.2 * lv;
    p.rate *= 1 + 0.06 * lv;
    if (w.level >= 3 && p.count > 1) p.count += 1;
    if (w.level >= 5 && p.pierce > 0) p.pierce += 1;
    if (w.level >= 4 && (w.def.behavior === 'halo' || w.def.behavior === 'drone')) p.special += 1;
    let countBonus = 0;
    const applies = (m: StatMod) => !m.tag || w.hasTag(m.tag);
    for (const m of mods) {
      if (!WEAPON_STATS.has(m.s) || !applies(m) || m.add === undefined) continue;
      if (m.s === 'count') countBonus += m.add;
      else p[m.s as WeaponStat] += m.add;
    }
    for (const m of mods) {
      if (!WEAPON_STATS.has(m.s) || !applies(m) || m.mul === undefined) continue;
      p[m.s as WeaponStat] *= m.mul;
    }
    switch (w.def.behavior) {
      case 'arc':
        p.chain += countBonus;
        break;
      case 'halo':
      case 'drone':
        p.special += Math.min(countBonus, 2);
        break;
      case 'well':
      case 'pulse':
        p.damage *= 1 + 0.3 * countBonus;
        break;
      default:
        p.count += countBonus;
    }
    p.damage *= this.ship.globalDamage;
    p.rate *= this.ship.globalRate;
    p.count = Math.max(1, Math.round(p.count));
    p.pierce = Math.round(p.pierce);
    p.ricochet = Math.round(p.ricochet);
    p.split = Math.round(p.split);
    p.chain = Math.round(p.chain);
    p.special = Math.round(p.special);
    w.params = p;
  }

  /** Estimated sustained DPS of the build — used by the director and build sims. */
  dpsEstimate(): number {
    let dps = 0;
    for (const w of this.weapons) {
      const p = w.params;
      const critF = 1 + p.crit * (p.critMul - 1);
      let per = p.damage * critF;
      switch (w.def.behavior) {
        case 'bullet':
        case 'missile':
        case 'mine':
          per *= p.count * (1 + Math.min(p.pierce, 3) * 0.35 + p.ricochet * 0.3 + p.split * 0.25) * (1 + p.explode * 0.05);
          dps += per * p.rate * 0.6;
          break;
        case 'rail':
          dps += per * p.count * p.rate * 2.2;
          break;
        case 'beam':
          dps += per * p.count * p.rate * 0.8 * (1 + Math.min(p.pierce, 4) * 0.2);
          break;
        case 'arc':
          dps += per * p.rate * (1 + p.chain * 0.7);
          break;
        case 'well':
          dps += per * 10 * p.life * p.rate * 2;
          break;
        case 'drone':
          dps += per * Math.max(1, p.special) * Math.max(p.rate, 1) * 0.6;
          break;
        case 'halo':
          dps += per * p.special * 3;
          break;
        case 'pulse':
          dps += per * p.rate * 3;
          break;
        case 'nova':
          dps += per * p.rate * 4;
          break;
      }
    }
    const status = this.weapons.reduce((a, w) => a + w.params.burn + w.params.shock + w.params.cryo * 0.5, 0);
    return dps * (1 + status * 0.25) * (1 + this.synergies.size * 0.04);
  }

  tagCount(t: Tag): number {
    return this.tags[t] ?? 0;
  }

  /** How strongly a card combos with the current build (for highlight UI). */
  comboScore(tags: Tag[]): number {
    let s = 0;
    for (const t of tags) if ((this.tags[t] ?? 0) > 0) s++;
    // completes a synergy?
    for (const syn of SYNERGIES) {
      if (syn.kind !== 'synergy' || this.synergies.has(syn.id)) continue;
      let missing = 0;
      let helps = false;
      for (const [t, need] of Object.entries(syn.needs)) {
        const have = this.tags[t as Tag] ?? 0;
        const add = tags.filter((x) => x === t).length;
        if (add > 0) helps = true;
        missing += Math.max(0, (need as number) - have - add);
      }
      if (helps && missing === 0) s += 3;
    }
    return s;
  }

  /** Upgrades available in the draft pool right now. */
  upgradePool(opts: { allowArtifacts: boolean; allowCurses: boolean }): UpgradeDef[] {
    return UPGRADES.filter((u) => {
      if (this.banished.has(u.id)) return false;
      if (u.rarity === 'curse' && !opts.allowCurses) return false;
      if (u.rarity === 'artifact' && !opts.allowArtifacts) return false;
      if ((this.upgrades.get(u.id) ?? 0) >= (u.maxStacks ?? 2)) return false;
      if (u.requires && !u.requires.some((t) => this.tagCount(t) > 0)) return false;
      if (u.family) {
        const m = /_(\d+)$/.exec(u.id);
        const tier = m ? +m[1]! : 1;
        if (tier > 1 && !this.upgrades.has(`${u.family}_${tier - 1}`)) return false;
      }
      if ((u.rarity === 'epic' || u.rarity === 'legendary') && !this.meta.tier2) return false;
      return true;
    });
  }

  /** Generate a 3-card draft. Deterministic given rng. */
  draft(rng: Rng, opts: { count?: number; minRarity?: Rarity; allowArtifacts?: boolean; luckBonus?: number; weaponsOnly?: boolean; newWeaponsOnly?: boolean } = {}): DraftCard[] {
    const count = opts.count ?? 3;
    const cards: DraftCard[] = [];
    const used = new Set<string>();
    // Evolutions always surface when available
    for (const w of this.weapons) {
      if (this.canEvolve(w) && cards.length < count) {
        cards.push({ kind: 'evolve', weapon: w, combo: 5 });
        used.add('e' + w.def.id);
      }
    }
    const luck = this.ship.luck + (opts.luckBonus ?? 0) + this.meta.heat * 0.15;
    const rarityW: Record<Rarity, number> = {
      common: Math.max(8, 60 - luck * 8),
      uncommon: 28 + luck * 3,
      rare: 10 + luck * 3,
      epic: 3.5 + luck * 1.5,
      legendary: 1.2 + luck,
      artifact: opts.allowArtifacts ? 1.5 + luck * 0.6 : 0,
      curse: 0,
    };
    const minIdx = opts.minRarity ? ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(opts.minRarity) : 0;
    const pool = this.upgradePool({ allowArtifacts: !!opts.allowArtifacts || this.meta.tier2, allowCurses: false }).filter(
      (u) => u.rarity === 'artifact' || ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(u.rarity) >= minIdx,
    );
    let guard = 0;
    while (cards.length < count && guard++ < 60) {
      const roll = rng.next();
      // weapon caches offer weapons and levels; ordinary drafts mostly upgrades
      const open = this.linked.length < this.linkSlots || this.systems.length < MAX_SYSTEMS;
      const pW = opts.newWeaponsOnly ? 1 : opts.weaponsOnly ? 0.65 : open ? 0.24 : 0.14;
      const pL = opts.weaponsOnly || opts.newWeaponsOnly ? 1 : open ? 0.36 : 0.28;
      if (roll < pW) {
        // new weapon
        const options = WEAPONS.filter(
          (w) => !this.ownsWeapon(w.id) && this.meta.unlockedWeapons.has(w.id) && !used.has('w' + w.id) && (!opts.newWeaponsOnly || w.slot !== 'system'),
        );
        if (options.length) {
          const def = rng.pick(options);
          used.add('w' + def.id);
          cards.push({ kind: 'weapon', def, combo: this.comboScore(def.tags) });
          continue;
        }
      } else if (roll < pL) {
        const options = this.weapons.filter((w) => w.level < MAX_LEVEL && !used.has('l' + w.def.id));
        if (options.length) {
          const w = rng.pick(options);
          used.add('l' + w.def.id);
          cards.push({ kind: 'level', weapon: w, combo: 1 });
          continue;
        }
      }
      if (!pool.length) break;
      const weights = pool.map((u) => (used.has(u.id) ? 0 : (rarityW[u.rarity] ?? 0) * (1 + this.comboScore(u.tags) * 0.35)));
      if (weights.every((w) => w <= 0)) break;
      const u = pool[rng.weighted(weights)]!;
      used.add(u.id);
      cards.push({ kind: 'upgrade', def: u, combo: this.comboScore(u.tags) });
    }
    return cards;
  }

  apply(card: DraftCard): void {
    switch (card.kind) {
      case 'upgrade':
        this.addUpgrade(card.def);
        break;
      case 'weapon':
        this.addWeapon(card.def);
        break;
      case 'level':
        this.levelUp(card.weapon);
        break;
      case 'evolve':
        this.evolve(card.weapon);
        break;
    }
  }
}

export function cardTitle(c: DraftCard): string {
  switch (c.kind) {
    case 'upgrade':
      return c.def.name;
    case 'weapon':
      return c.def.name;
    case 'level':
      return `${c.weapon.name} → Lv ${c.weapon.level + 1}`;
    case 'evolve':
      return c.weapon.def.evolve.name;
  }
}

export function cardRarity(c: DraftCard): Rarity {
  switch (c.kind) {
    case 'upgrade':
      return c.def.rarity;
    case 'weapon':
      return 'rare';
    case 'level':
      return 'uncommon';
    case 'evolve':
      return 'legendary';
  }
}
