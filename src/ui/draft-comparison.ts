import { MAX_LEVEL, MAX_SYSTEMS, type Build, type DraftCard, type WeaponInstance } from '../game/build';

/** A compact, truthful preview of what selecting a draft card changes. */
export function draftComparison(card: DraftCard, build: Build): { before: string; after: string; label: string } {
  const weaponLabel = (weapon: WeaponInstance) => `${weapon.name} · Lv ${weapon.level}`;
  if (card.kind === 'upgrade') {
    const count = build.upgrades.get(card.def.id) ?? 0;
    const stacks = (n: number) => `${n} ${n === 1 ? 'stack' : 'stacks'}`;
    return { label: 'Upgrade', before: stacks(count), after: stacks(count + 1) };
  }
  if (card.kind === 'evolve') {
    return { label: 'Evolution', before: weaponLabel(card.weapon), after: card.weapon.def.evolve.name };
  }
  if (card.kind === 'level') {
    return { label: 'Weapon level', before: weaponLabel(card.weapon), after: `${card.weapon.name} · Lv ${Math.min(MAX_LEVEL, card.weapon.level + 1)}` };
  }
  const owned = build.ownsWeapon(card.def.id);
  if (owned) return { label: 'Weapon level', before: weaponLabel(owned), after: `${owned.name} · Lv ${Math.min(MAX_LEVEL, owned.level + 1)}` };
  const slot = card.def.slot;
  if (slot === 'system') {
    const current = build.systems.length >= MAX_SYSTEMS ? build.systems[0] : undefined;
    return { label: 'System', before: current ? weaponLabel(current) : 'Empty slot', after: `${card.def.name} · Lv 1` };
  }
  // primaries and secondaries mount on a linked hardpoint and fire alongside the main guns
  const victim = build.linkVictim();
  return {
    label: `Linked ${slot === 'primary' ? 'primary' : 'secondary'}`,
    before: victim ? weaponLabel(victim) : `Open hardpoint (${build.linkSlots - build.linked.length} free)`,
    after: `${card.def.name} · Lv 1`,
  };
}

export function currentWeaponPreview(card: DraftCard, build: Build): DraftCard | null {
  if (card.kind === 'upgrade') return null;
  let weapon: WeaponInstance | undefined;
  if (card.kind === 'level' || card.kind === 'evolve') weapon = card.weapon;
  else {
    const owned = build.ownsWeapon(card.def.id);
    const slot = card.def.slot;
    weapon = owned ?? (slot === 'system' ? (build.systems.length >= MAX_SYSTEMS ? build.systems[0] : undefined) : (build.linkVictim() ?? undefined));
  }
  if (!weapon) return null;
  return weapon.evolved ? { kind: 'evolve', weapon, combo: 0 } : { kind: 'weapon', def: weapon.def, combo: 0 };
}
