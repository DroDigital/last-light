import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

function coopWorld(seed: string) {
  const b = new Build(HULLS[0]!, meta());
  const w = new World(seed, b);
  w.refreshParams();
  const p2 = w.addPlayer2();
  return { w, p2 };
}

describe('local co-op', () => {
  it('player 2 flies and fires with the shared build', () => {
    const { w, p2 } = coopWorld('COOP1');
    const target = w.spawnEnemy('gunship', p2.pos.x, p2.pos.y, p2.pos.z - 30);
    target.spawnT = 0;
    target.speedMul = 0;
    target.fireMul = 0;
    const c1 = emptyControls();
    const c2 = emptyControls();
    c2.fire1 = true;
    for (let t = 0; t < 60 * 8 && target.alive; t++) w.update(c1, 1 / 60, c2);
    expect(target.alive).toBe(false);
    expect(w.player).toBe(w.p1);
  });

  it('enemies hunt the nearer pilot', () => {
    const { w, p2 } = coopWorld('COOP2');
    p2.pos.set(200, 0, 0);
    p2.prev.copy(p2.pos);
    const e = w.spawnEnemy('moteeater', 190, 0, 0);
    e.spawnT = 0;
    const c = emptyControls();
    const d0 = e.pos.distanceTo(p2.pos);
    for (let t = 0; t < 60; t++) w.update(c, 1 / 60, c);
    // it closed on P2 (far from P1 at the origin), not on P1
    expect(e.alive ? e.pos.distanceTo(p2.pos) : 0).toBeLessThan(d0);
  });

  it('a downed pilot is revived by the partner, and only both down ends the run', () => {
    const { w, p2 } = coopWorld('COOP3');
    w.withPlayer(p2, () => w.killPlayer('test'));
    expect(p2.alive).toBe(false);
    expect(w.anyAlive()).toBe(true);
    p2.pos.copy(w.p1.pos).add(p2.pos.clone().set(3, 0, 0));
    p2.vel.set(0, 0, 0);
    const c = emptyControls();
    for (let t = 0; t < 60 * (World.REVIVE_TIME + 0.5); t++) {
      w.p1.vel.set(0, 0, 0);
      p2.vel.set(0, 0, 0);
      w.update(c, 1 / 60, c);
    }
    expect(p2.alive).toBe(true);
    expect(p2.hull).toBeGreaterThan(0);
    w.killPlayer('a');
    w.withPlayer(p2, () => w.killPlayer('b'));
    expect(w.anyAlive()).toBe(false);
  });

  it('the tether keeps the pair in one fight, and P2 can leave', () => {
    const { w, p2 } = coopWorld('COOP4');
    p2.pos.set(400, 0, 0);
    const c = emptyControls();
    for (let t = 0; t < 60 * 10; t++) w.update(c, 1 / 60, c);
    expect(p2.pos.distanceTo(w.p1.pos)).toBeLessThan(400);
    w.removePlayer2();
    expect(w.player2).toBeNull();
    for (let t = 0; t < 30; t++) w.update(c, 1 / 60);
  });
});
