import { describe, expect, it } from 'vitest';
import { Build, WeaponInstance } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { UPGRADES } from '../src/data/upgrades';
import { draftComparison } from '../src/ui/draft-comparison';

function build(): Build {
  return new Build(HULLS[0]!, { bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(), tier2: false, heat: 0 });
}

describe('draft comparison', () => {
  it('names the equipped weapon a primary pick will replace', () => {
    const b = build();
    const candidate = WEAPONS.find((w) => w.slot === 'primary' && w.id !== b.primary.def.id)!;
    expect(draftComparison({ kind: 'weapon', def: candidate, combo: 0 }, b)).toEqual({ before: `${b.primary.name} · Lv ${b.primary.level}`, after: `${candidate.name} · Lv 1`, label: 'Primary' });
  });
  it('shows which system will be replaced when all slots are full', () => {
    const b = build();
    const systems = WEAPONS.filter((w) => w.slot === 'system');
    b.systems = systems.slice(0, 3).map((w) => new WeaponInstance(w));
    const candidate = systems[3]!;
    expect(draftComparison({ kind: 'weapon', def: candidate, combo: 0 }, b).before).toBe(`${b.systems[0]!.name} · Lv 1`);
  });
  it('shows the current and next stack count for an upgrade', () => {
    const b = build();
    const def = UPGRADES[0]!;
    b.upgrades.set(def.id, 2);
    expect(draftComparison({ kind: 'upgrade', def, combo: 0 }, b)).toEqual({ before: '2 stacks', after: '3 stacks', label: 'Upgrade' });
  });
});

describe('current weapon preview', () => {
  it('previews the equipped weapon before a replacement', async () => {
    const { currentWeaponPreview } = await import('../src/ui/draft-comparison');
    const b = build();
    const candidate = WEAPONS.find((w) => w.slot === 'primary' && w.id !== b.primary.def.id)!;
    expect(currentWeaponPreview({ kind: 'weapon', def: candidate, combo: 0 }, b)).toEqual({ kind: 'weapon', def: b.primary.def, combo: 0 });
  });
  it('has no current weapon preview when a system slot is empty', async () => {
    const { currentWeaponPreview } = await import('../src/ui/draft-comparison');
    const b = build();
    b.systems = [];
    const candidate = WEAPONS.find((w) => w.slot === 'system')!;
    expect(currentWeaponPreview({ kind: 'weapon', def: candidate, combo: 0 }, b)).toBeNull();
  });
  it('shows the current evolved form for a level card', async () => {
    const { currentWeaponPreview } = await import('../src/ui/draft-comparison');
    const b = build();
    b.primary.evolved = true;
    expect(currentWeaponPreview({ kind: 'level', weapon: b.primary, combo: 0 }, b)).toEqual({ kind: 'evolve', weapon: b.primary, combo: 0 });
  });
});
