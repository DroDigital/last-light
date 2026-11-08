import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Build } from '../src/game/build';
import { World } from '../src/game/world';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';
import { aim, muzzle, updateWeapons, updateWingWeapons } from '../src/game/weapons';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: true, heat: 0 });
const MOUSE = { strength: 0.5, cone: 0.1 };
const PAD = { strength: 0.85, cone: 0.17 };
const saved = { ...aim };
afterEach(() => Object.assign(aim, saved));

function world(primary?: string, hull = HULLS[0]!) {
  const w = new World('AIM', new Build(hull, meta(), primary));
  w.player.pos.set(0, 0, 0);
  w.player.prev.copy(w.player.pos);
  return w;
}
/** Place a revealed, still enemy at `dist` along a direction `ang` radians right of forward (-Z). */
function target(w: World, dist: number, ang = 0, kind = 'scrapper') {
  const e = w.spawnEnemy(kind, Math.sin(ang) * dist, 0, -Math.cos(ang) * dist, 0);
  e.revealed = true;
  e.spawnT = 0;
  e.vel.set(0, 0, 0);
  return e;
}
const tick = (w: World) => updateWeapons(w, emptyControls(), 1 / 60);

describe('aim assist / lock-on', () => {
  it('locks targets across the whole assist range with a mouse, not just the first ~96 units', () => {
    // regression: a distance penalty mixed into the cone threshold made every
    // mouse target beyond ~96 units unlockable, even dead centre
    Object.assign(aim, MOUSE);
    for (const dist of [30, 90, 120, 160, 200, 235]) {
      const w = world();
      const e = target(w, dist);
      tick(w);
      expect(w.player.aimTarget, `dist ${dist}`).toBe(e.id);
    }
  });

  it('does not lock targets outside the cone or beyond range', () => {
    Object.assign(aim, MOUSE);
    const w = world();
    target(w, 150, 0.4);
    target(w, 260, 0);
    tick(w);
    expect(w.player.aimTarget).toBe(-1);
  });

  it('a strength of 0 turns the assist off', () => {
    Object.assign(aim, { strength: 0, cone: 0.17 });
    const w = world();
    target(w, 60);
    tick(w);
    expect(w.player.aimTarget).toBe(-1);
    w.player.forward(new Vector3());
    expect(w.player.aimDir.z).toBeCloseTo(-1, 6);
  });

  it('prefers the target closest to the crosshair', () => {
    Object.assign(aim, PAD);
    const w = world();
    target(w, 40, 0.12);
    const centred = target(w, 120, 0.01);
    tick(w);
    expect(w.player.aimTarget).toBe(centred.id);
  });

  it('holds a lock instead of flickering between two near-equal targets', () => {
    Object.assign(aim, PAD);
    const w = world();
    const a = target(w, 100, 0.03);
    const b = target(w, 100, -0.035);
    tick(w);
    expect(w.player.aimTarget).toBe(a.id);
    // b drifts slightly closer to the crosshair than a: the lock stays on a
    a.pos.set(Math.sin(0.04) * 100, 0, -Math.cos(0.04) * 100);
    b.pos.set(Math.sin(-0.03) * 100, 0, -Math.cos(-0.03) * 100);
    tick(w);
    expect(w.player.aimTarget).toBe(a.id);
    // ...until a leaves the widened hold cone
    a.pos.set(Math.sin(0.5) * 100, 0, -Math.cos(0.5) * 100);
    tick(w);
    expect(w.player.aimTarget).toBe(b.id);
  });

  it('leads moving targets for projectile guns but not for hitscan guns', () => {
    Object.assign(aim, { strength: 1, cone: 0.17 });
    const lead = (primary: string) => {
      const w = world(primary);
      const e = target(w, 100);
      e.vel.set(30, 0, 0);
      tick(w);
      expect(w.player.aimTarget).toBe(e.id);
      return w.player.aimDir.x;
    };
    expect(lead('pulse')).toBeGreaterThan(0.05); // aims ahead of the target
    expect(Math.abs(lead('railgun'))).toBeLessThan(1e-6); // a rail hits instantly: aim at it
  });

  it('converges both guns on the locked target, so close shots from the wing guns hit', () => {
    Object.assign(aim, { strength: 1, cone: 0.17 });
    const w = world('pulse');
    const e = target(w, 25, 0.05);
    tick(w);
    expect(w.player.aimDist).toBeCloseTo(25, 0);
    // both wing muzzles point straight through the target
    for (const side of [-1, 1]) {
      const m = muzzle(w, side, new Vector3());
      const conv = w.player.pos.clone().addScaledVector(w.player.aimDir, w.player.aimDist);
      const dir = conv.sub(m).normalize();
      const toE = e.pos.clone().sub(m);
      const miss = toE.clone().sub(dir.multiplyScalar(toE.dot(dir))).length();
      expect(miss).toBeLessThan(e.radius);
    }
  });

  it('wingmen get controller assist even when Player 1 plays with assist off on a mouse', () => {
    Object.assign(aim, { strength: 0, cone: 0.1, padStrength: 0.85, padCone: 0.17 });
    const w = world();
    const p2 = w.addPlayer2();
    p2.pos.set(0, 0, 0);
    p2.quat.identity();
    const e = target(w, 80, 0.12);
    w.withPlayer(p2, () => updateWingWeapons(w, emptyControls(), 1 / 60));
    expect(p2.aimTarget).toBe(e.id);
    tick(w);
    expect(w.player.aimTarget).toBe(-1);
  });
});
