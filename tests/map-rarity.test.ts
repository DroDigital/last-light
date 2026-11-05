import { describe, expect, it } from 'vitest';
import { Director, generateMap, isThreatRoom, MAP_ROWS, ROOM_RARITIES } from '../src/game/run';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

describe('stellar routes and room rarity', () => {
  it('provides at least two choices until the final approach and keeps every node reachable', () => {
    for (let seed = 0; seed < 100; seed++) {
      const map = generateMap(seed, 0, { rifts: true, heat: 0 });
      for (const node of map.nodes) {
        if (node.row < MAP_ROWS - 2) expect(new Set(node.links).size).toBeGreaterThanOrEqual(2);
        if (node.row > 0) expect(map.nodes.some((previous) => previous.links.includes(node.id))).toBe(true);
      }
    }
  });

  it('assigns reproducible room tiers and offers all five across generated maps', () => {
    const found = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const map = generateMap(seed, 0, { rifts: true, heat: 0 });
      expect(map).toEqual(generateMap(seed, 0, { rifts: true, heat: 0 }));
      for (const node of map.nodes) {
        expect(ROOM_RARITIES).toContain(node.rarity);
        found.add(node.rarity);
        if (!isThreatRoom(node.type)) expect(node.rarity).toBe('common');
      }
    }
    expect(found.size).toBe(5);
  });

  it('raises encounter budget and enemy strength with room rarity', () => {
    const values = ROOM_RARITIES.map((rarity) => {
      const world = new World('room', new Build(HULLS[0]!, meta()));
      const director = new Director('combat', 0, 42, world, 0, 2, rarity);
      return { budget: director.budget, hp: world.sectorHpScale, damage: world.sectorDmgScale, density: world.maxTokens };
    });
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!.budget).toBeGreaterThan(values[i - 1]!.budget);
      expect(values[i]!.hp).toBeGreaterThan(values[i - 1]!.hp);
      expect(values[i]!.damage).toBeGreaterThan(values[i - 1]!.damage);
      expect(values[i]!.density).toBeGreaterThan(values[i - 1]!.density);
    }
  });
});
