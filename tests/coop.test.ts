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

  it('up to four pilots drop in, each in their own seat', () => {
    const { w } = coopWorld('COOP5');
    const p3 = w.addWingman();
    const p4 = w.addWingman();
    expect(w.partySize).toBe(4);
    expect(w.wingmen.map((p) => p.slot)).toEqual([1, 2, 3]);
    expect(p3!.pos.distanceTo(p4!.pos)).toBeGreaterThan(1);
    expect(w.addWingman()).toBeNull();
    // a freed seat is the next one taken
    w.removeWingman(p3);
    expect(w.addWingman()!.slot).toBe(2);
  });

  it('every wingman flies with its own controls', () => {
    const { w } = coopWorld('COOP6');
    w.addWingman();
    const p4 = w.addWingman()!;
    const target = w.spawnEnemy('gunship', p4.pos.x, p4.pos.y, p4.pos.z - 30);
    target.spawnT = 0;
    target.speedMul = 0;
    target.fireMul = 0;
    const idle = emptyControls();
    const fire = emptyControls();
    fire.fire1 = true;
    const z0 = w.wingmen[1]!.pos.z;
    const thrust = emptyControls();
    thrust.mz = 1;
    for (let t = 0; t < 60 * 10 && target.alive; t++) w.update(idle, 1 / 60, [idle, thrust, fire]);
    expect(target.alive).toBe(false);
    expect(w.wingmen[1]!.pos.z).toBeLessThan(z0);
  });

  it('enemy toughness follows the party size, live', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('COOP7', b);
    w.addWingman();
    const e = w.spawnEnemy('gunship', 0, 0, -60);
    const duo = e.maxHp;
    expect(w.partyHp(false)).toBeGreaterThan(1.2);
    const before = e.maxHp;
    w.addWingman();
    expect(e.maxHp).toBeGreaterThan(before);
    w.removeWingman(w.wingmen[1]);
    w.removeWingman(w.wingmen[0]);
    expect(e.maxHp).toBeCloseTo(duo / w.partyHp(false, 2), 3);
  });

  it('any partner can revive, and the run lasts while anyone flies', () => {
    const { w, p2 } = coopWorld('COOP8');
    const p3 = w.addWingman()!;
    w.killPlayer('a');
    w.withPlayer(p2, () => w.killPlayer('b'));
    expect(w.anyAlive()).toBe(true);
    p3.pos.copy(p2.pos).add(p3.pos.clone().set(2, 0, 0));
    const c = emptyControls();
    for (let t = 0; t < 60 * (World.REVIVE_TIME + 0.5); t++) {
      for (const p of w.players) p.vel.set(0, 0, 0);
      p3.pos.copy(p2.pos).x += 2;
      w.update(c, 1 / 60, [c, c, c]);
    }
    expect(p2.alive).toBe(true);
    w.killPlayer('a');
    w.withPlayer(p2, () => w.killPlayer('c'));
    w.withPlayer(p3, () => w.killPlayer('d'));
    expect(w.anyAlive()).toBe(false);
  });
});
