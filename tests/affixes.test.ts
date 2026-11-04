import { describe, expect, it } from 'vitest';
import { AFFIXES, AFFIX_BY_ID, RARITY, rarityOdds, rollAffixes, rollRarity, type AffixDef, type AffixId } from '../src/data/affixes';
import { Rng } from '../src/core/rng';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { ENEMIES } from '../src/data/enemies';
import { emptyControls } from '../src/game/player';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

describe('enemy rarities and affixes', () => {
  it('has a comprehensive, uniquely keyed table that fits the bitmask', () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(30);
    expect(AFFIXES.length).toBeLessThanOrEqual(31);
    expect(new Set(AFFIXES.map((a) => a.id)).size).toBe(AFFIXES.length);
  });

  it('rolls the right count, no repeats, and respects role and sector gates', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const rarity = (1 + (i % 3)) as 1 | 2 | 3;
      const role = ENEMIES[i % ENEMIES.length]!.role;
      const sector = i % 5;
      const a = rollAffixes(rng, rarity, role, sector);
      const [lo, hi] = rarity === 1 ? [1, 1] : rarity === 2 ? [2, 3] : [3, 4];
      expect(a.length).toBeGreaterThanOrEqual(lo);
      expect(a.length).toBeLessThanOrEqual(hi);
      expect(new Set(a).size).toBe(a.length);
      for (const id of a) {
        const d = AFFIX_BY_ID[id] as AffixDef;
        expect((d.minSector ?? 0) <= sector).toBe(true);
        expect((d.not ?? []).includes(role)).toBe(false);
      }
    }
  });

  it('rarer tiers get likelier deeper in the run', () => {
    const early = rarityOdds(0, 0, 'combat');
    const late = rarityOdds(4, 0, 'combat');
    for (let k = 0; k < 3; k++) expect(late[k]!).toBeGreaterThan(early[k]!);
    const rng = new Rng(3);
    let rare = 0;
    for (let i = 0; i < 20000; i++) if (rollRarity(rng, 4, 0, 'combat') >= 2) rare++;
    expect(rare / 20000).toBeGreaterThan(0.02);
    expect(rare / 20000).toBeLessThan(0.15);
  });

  it('every affix can be applied and fought without breaking the sim', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('AFX', b);
    w.refreshParams();
    w.sectorIdx = 4;
    const c = emptyControls();
    c.fire1 = true;
    for (const a of AFFIXES) {
      const e = w.spawnEnemy('gunship', 0, 0, 30, 2, [a.id as AffixId]);
      e.spawnT = 0;
      expect(e.rarity).toBe(2);
      expect(e.has(a.id as AffixId)).toBe(true);
      expect(e.maxHp).toBeGreaterThan(ENEMIES.find((x) => x.id === 'gunship')!.hp * RARITY[2].hp * 0.99);
    }
    w.player.hull = 1e9;
    for (let t = 0; t < 60 * 20; t++) w.update(c, 1 / 60);
    for (const e of w.enemies) {
      expect(Number.isFinite(e.pos.x + e.pos.y + e.pos.z)).toBe(true);
      expect(Number.isFinite(e.hp)).toBe(true);
    }
  });

  it('stat affixes change the numbers they promise', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('AFX2', b);
    // cutter variants carry no HP leanings, so HP comparisons are exact
    const base = w.spawnEnemy('cutter', 0, 0, 0, 1, ['brutal']);
    expect(base.dmgMul).toBeCloseTo(1.5);
    const t = w.spawnEnemy('cutter', 0, 0, 0, 1, ['titanic']);
    expect(t.maxHp).toBeCloseTo(base.maxHp * 1.9, 0);
    const h = w.spawnEnemy('cutter', 0, 0, 0, 1, ['hardened']);
    expect(h.dmgTaken).toBeCloseTo(0.7);
  });
});
