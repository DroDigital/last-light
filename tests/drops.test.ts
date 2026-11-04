import { describe, expect, it } from 'vitest';
import { DROP_KINDS, DROP_TABLE, dropChance, enemyClass } from '../src/data/drops';
import { ENEMIES, ENEMY_BY_ID } from '../src/data/enemies';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

describe('drop tables', () => {
  it('every enemy has a category with a full row of odds', () => {
    for (const e of ENEMIES) {
      const row = DROP_TABLE[enemyClass(e)];
      for (const k of DROP_KINDS) expect(row[k]).toBeGreaterThanOrEqual(0);
    }
  });

  it('heavier categories and rarer enemies drop more', () => {
    const swarm = ENEMY_BY_ID['moteeater']!;
    const heavy = ENEMY_BY_ID['hauler']!;
    for (const k of ['shard', 'cache'] as const) {
      expect(dropChance(heavy, k, 0, false, 0)).toBeGreaterThan(dropChance(swarm, k, 0, false, 0));
      expect(dropChance(heavy, k, 2, false, 0)).toBeGreaterThan(dropChance(heavy, k, 0, false, 0));
      expect(dropChance(heavy, k, 0, true, 0)).toBeGreaterThan(dropChance(heavy, k, 0, false, 0));
      expect(dropChance(heavy, k, 0, false, 3)).toBeGreaterThan(dropChance(heavy, k, 0, false, 0));
      expect(dropChance(heavy, k, 3, true, 10)).toBeLessThanOrEqual(0.85);
    }
  });

  it('bosses always pay out', () => {
    const boss = { ...ENEMY_BY_ID['gunship']!, role: 'boss' as const };
    for (const k of ['prism', 'cache', 'repair', 'cell'] as const) expect(dropChance(boss, k, 0, false, 0)).toBe(1);
    // a boss's secondary bodies are parts, not a second payout
    expect(dropChance(boss, 'prism', 0, false, 0, false)).toBeLessThan(0.1);
  });

  it('kills spawn loot that magnets in and banks shards', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('DROPS', b);
    w.refreshParams();
    let drops = 0;
    w.events.on('drop', (d) => {
      if (!d.picked) drops++;
    });
    for (let i = 0; i < 400; i++) {
      // common rarity: no affixes, so nothing (Volatile, Pack Leader) can kill the test pilot
      const e = w.spawnEnemy('hauler', w.player.pos.x + 4, w.player.pos.y, w.player.pos.z - 4, 0);
      w.killEnemy(e, 0);
    }
    expect(drops).toBeGreaterThan(10);
    w.player.hull = 1e9;
    const c = emptyControls();
    for (let t = 0; t < 60 * 15; t++) w.update(c, 1 / 60);
    expect(w.drops.length).toBe(0);
    expect(w.bank.shard + w.bank.prism + w.bank.cache).toBeGreaterThan(0);
  });
});
