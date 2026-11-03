import { describe, it, expect } from 'vitest';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { emptyControls } from '../src/game/player';
import { STARTER_WEAPONS } from '../src/meta/save';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(STARTER_WEAPONS), tier2: true, heat: 0 });

describe('combat sim', () => {
  it('primary fire kills an enemy straight ahead', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('T', b);
    w.player.pos.set(0, 0, 0);
    const e = w.spawnEnemy('scrapper', 0, 0, -40);
    e.spawnT = 0;
    const c = emptyControls();
    c.fire1 = true;
    for (let i = 0; i < 240; i++) w.update(c, 1 / 60);
    console.log('proj', w.proj.n, 'hp', e.hp, 'alive', e.alive, 'kills', w.stats.kills, 'epos', e.pos.toArray().map(Math.round));
    expect(w.stats.kills).toBeGreaterThan(0);
  });
});
