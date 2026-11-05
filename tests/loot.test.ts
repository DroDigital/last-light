import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { Build } from '../src/game/build';
import { EFFECTS, generateLoot } from '../src/game/loot';

const makeBuild = () => new Build(HULLS[0]!, { bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map(w => w.id)), tier2: true, heat: 0 });

describe('component loot', () => {
  it('generates deterministic high-tier items with variable traits and rolls', () => {
    const a = generateLoot(new Rng('same'), 'mythical', 'port');
    expect(a).toEqual(generateLoot(new Rng('same'), 'mythical', 'port'));
    expect(a.trait).toBeTruthy();
    const rolls = Array.from({length: 20}, (_, i) => generateLoot(new Rng(i), 'mythical', 'port'));
    expect(new Set(rolls.map(x => x.trait?.name)).size).toBeGreaterThan(1);
    expect(new Set(rolls.map(x => JSON.stringify(x.mods))).size).toBeGreaterThan(1);
  });
  it('equips propulsion and side components without losing replaced inventory', () => {
    const b = makeBuild();
    const speed = b.ship.speed;
    const engine = generateLoot(new Rng(4), 'rare', 'propulsion');
    b.addLoot(engine);
    expect(b.equipLoot(engine.id)).toBe(true);
    expect(b.ship.speed).toBeGreaterThan(speed);
    const weapon = generateLoot(new Rng(5), 'epic', 'port');
    b.addLoot(weapon);
    const original = b.getSideParams('port').damage;
    expect(b.equipLoot(weapon.id)).toBe(true);
    expect(b.getSideParams('port').damage).toBeGreaterThan(original);
    expect(b.getSideParams('starboard').damage).toBe(original);
    const replacement = generateLoot(new Rng(6), 'rare', 'port');
    b.addLoot(replacement); b.equipLoot(replacement.id);
    expect(b.inventory).toContain(weapon);
  });
  it('gives an alternate combat bonus when a trait cannot work with the weapon behavior', () => {
    const b = makeBuild();
    b.addWeapon(WEAPONS.find(w => w.id === 'lance')!);
    const item = generateLoot(new Rng(14), 'legendary', 'port');
    item.mods = [];
    item.trait = { name: 'Ricochet', desc: 'Ricochets, or critical chance for beams.', mods: [{ s: 'ricochet', add: 2 }], behaviors: ['bullet'], fallbackMods: [{ s: 'crit', add: 0.08 }] };
    b.addLoot(item); b.equipLoot(item.id);
    expect(b.getSideParams('port').crit).toBeCloseTo(b.primary.params.crit + 0.08);
    expect(b.getSideParams('port').ricochet).toBe(b.primary.params.ricochet);
  });
  it('charges for each of two effects per side and rejects invalid purchases', () => {
    const b = makeBuild();
    const effect = EFFECTS[0]!;
    const original = b.getSideParams('port');
    const component = generateLoot(new Rng(12), 'mythical', 'port');
    component.effectId = effect.id;
    b.addLoot(component);
    expect(b.installEffect('port', 0, effect.id, effect.cost - 1)).toBeNull();
    expect(b.installEffect('port', 0, effect.id, effect.cost)).toBe(0);
    expect(b.getSideParams('port')).not.toEqual(original);
    expect(b.getSideParams('starboard')).toEqual(original);
    expect(b.installEffect('starboard', 1, effect.id, effect.cost)).toBe(0);
    expect(b.installEffect('starboard', 2, effect.id, 999)).toBeNull();
    expect(b.installEffect('port', 1, 'missing', 999)).toBeNull();
  });
});
