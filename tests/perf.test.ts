import { describe, it, expect } from 'vitest';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { emptyControls } from '../src/game/player';
import { STARTER_WEAPONS } from '../src/meta/save';
import { WEAPON_BY_ID } from '../src/data/weapons';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(STARTER_WEAPONS), tier2: true, heat: 0 });

describe('simulation budget', () => {
  it('300 enemies + 3000 enemy bullets + heavy player fire stays under budget', () => {
    const b = new Build(HULLS[0]!, meta());
    b.addWeapon(WEAPON_BY_ID['interceptors']!);
    b.addWeapon(WEAPON_BY_ID['halo']!);
    const w = new World('PERF', b);
    w.refreshParams();
    w.player.pos.set(0, 0, 0);
    const ids = ['moteeater', 'scrapper', 'shardling', 'gunship', 'cantor', 'eclipse'];
    for (let i = 0; i < 300; i++) {
      const a = i * 2.4;
      const r = 40 + (i % 50) * 3;
      w.spawnEnemy(ids[i % ids.length]!, Math.cos(a) * r, ((i % 7) - 3) * 8, Math.sin(a) * r).spawnT = 0;
    }
    for (let i = 0; i < 3000; i++) {
      const a = i * 0.7;
      w.spawnEnemyShot(Math.cos(a) * 120, ((i % 11) - 5) * 10, Math.sin(a) * 120, 0, 0, 0, 0, 1, 0.6, 999);
    }
    w.player.hull = 1e9;
    (w.build.ship as { hull: number }).hull = 1e9;
    const c = emptyControls();
    c.fire1 = true;
    c.fire2 = true;
    // warm up JIT
    for (let i = 0; i < 60; i++) w.update(c, 1 / 60);
    const t0 = performance.now();
    const N = 240;
    for (let i = 0; i < N; i++) {
      w.update(c, 1 / 60);
      w.player.hull = 1e9;
    }
    const ms = (performance.now() - t0) / N;
    console.log(`sim tick: ${ms.toFixed(2)} ms  enemies=${w.enemies.length} eproj=${w.eproj.n} proj=${w.proj.n}`);
    expect(ms).toBeLessThan(6);
  });
});
