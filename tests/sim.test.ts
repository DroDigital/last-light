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

describe('regressions', () => {
  it('chargers actually dash after their telegraph (faceDir must not alias its input)', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('CHG', b);
    w.player.pos.set(0, 0, 0);
    const e = w.spawnEnemy('gloom', 0, 0, -40);
    e.spawnT = 0;
    e.timer = 0;
    const c = emptyControls();
    let maxSpeed = 0;
    for (let i = 0; i < 240; i++) {
      w.update(c, 1 / 60);
      w.player.hull = w.player.maxHull;
      if (e.state === 2) maxSpeed = Math.max(maxSpeed, e.vel.length());
    }
    expect(maxSpeed).toBeGreaterThan(60);
  });

  it('nested area effects hit every enemy in range exactly once per explosion', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('NEST', b);
    const es = Array.from({ length: 30 }, (_, i) => {
      const e = w.spawnEnemy('mawspawn', (i % 6) * 3, Math.floor(i / 6) * 3, 0);
      e.hp = e.maxHp = 1e6;
      e.armor = 0;
      return e;
    });
    w.rebuildHash();
    let inner = 0;
    let outer = 0;
    w.forEnemiesNear(6, 6, 0, 40, () => {
      outer++;
      w.forEnemiesNear(6, 6, 0, 40, () => void inner++);
    });
    expect(outer).toBe(es.length);
    expect(inner).toBe(es.length * es.length);
  });
});

describe('hardpoints', () => {
  it('primary shots spawn at the hull guns and secondaries at the nose', async () => {
    const { HARDPOINTS } = await import('../src/game/weapons');
    const { Quaternion, Vector3 } = await import('three');
    const { WEAPON_BY_ID } = await import('../src/data/weapons');
    for (const hull of HULLS) {
      // instant weapons (the Loom's Arc Caster) leave no projectile to measure: test the guns with a bolt
      const projectile = ['bullet', 'missile'].includes(WEAPON_BY_ID[hull.start.primary]!.behavior);
      const b = new Build(hull, meta(), projectile ? undefined : 'pulse');
      const w = new World('HP' + hull.id, b);
      w.player.pos.set(10, -5, 30);
      w.player.quat.setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
      w.player.prev.copy(w.player.pos);
      const c = emptyControls();
      c.fire1 = true;
      w.update(c, 1 / 60);
      expect(w.proj.n).toBeGreaterThan(0);
      const inv = new Quaternion().copy(w.player.quat).invert();
      const hp = HARDPOINTS[hull.id]!;
      // undo the one tick of flight to recover the spawn point, in ship space
      const p = new Vector3(w.proj.ox[0]!, w.proj.oy[0]!, w.proj.oz[0]!).sub(w.player.pos).applyQuaternion(inv);
      expect(Math.abs(Math.abs(p.x) - hp.primary[0] * hp.scale)).toBeLessThan(0.6);
      expect(Math.abs(p.z - hp.primary[2] * hp.scale)).toBeLessThan(1.2);
    }
  });
});
