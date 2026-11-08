import { describe, expect, it } from 'vitest';
import { Build, MAX_LINKS } from '../src/game/build';
import { World } from '../src/game/world';
import { HULLS } from '../src/data/world';
import { WEAPONS, WEAPON_BY_ID } from '../src/data/weapons';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { GUARD, emptyControls } from '../src/game/player';
import { updateWeapons } from '../src/game/weapons';
import { ReplayRecorder } from '../src/game/replay';
import { Rng } from '../src/core/rng';
import { barrierAmount, repairAmount } from '../src/data/drops';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });
const lantern = () => new Build(HULLS[0]!, meta());

describe('linked hardpoints', () => {
  it('mounts new guns beside the main ones instead of replacing them', () => {
    const b = lantern();
    const primary = b.primary;
    const secondary = b.secondary;
    b.addWeapon(WEAPON_BY_ID.scattergun!);
    b.addWeapon(WEAPON_BY_ID.torpedo!);
    expect(b.primary).toBe(primary);
    expect(b.secondary).toBe(secondary);
    expect(b.linked.map((w) => w.def.id)).toEqual(['scattergun', 'torpedo']);
    expect(b.weapons).toHaveLength(4);
  });

  it('swaps the oldest linked gun when full, and Auxiliary Hardpoint adds room up to the cap', () => {
    const b = lantern();
    const guns = WEAPONS.filter((w) => w.slot !== 'system' && !b.ownsWeapon(w.id));
    b.addWeapon(guns[0]!);
    b.addWeapon(guns[1]!);
    b.addWeapon(guns[2]!);
    expect(b.linked.map((w) => w.def.id)).toEqual([guns[1]!.id, guns[2]!.id]);
    b.addUpgrade(UPGRADE_BY_ID.aux_hardpoint!);
    b.addUpgrade(UPGRADE_BY_ID.aux_hardpoint!);
    expect(b.linkSlots).toBe(MAX_LINKS);
    b.addWeapon(guns[3]!);
    b.addWeapon(guns[4]!);
    expect(b.linked).toHaveLength(MAX_LINKS);
  });

  it('fires every linked gun on the matching trigger', () => {
    const shots = (link: boolean) => {
      const b = lantern();
      if (link) b.addWeapon(WEAPON_BY_ID.scattergun!);
      const w = new World('LINK', b);
      w.refreshParams();
      const c = emptyControls();
      c.fire1 = true;
      updateWeapons(w, c, 1 / 60);
      return w.proj.n;
    };
    // the scattergun's 8-pellet fan joins the pulse laser's single bolt
    expect(shots(true)).toBeGreaterThanOrEqual(shots(false) + 8);
  });

  it('the opening armory deals only new guns', () => {
    const b = lantern();
    for (let s = 0; s < 20; s++) {
      const cards = b.draft(new Rng('ARMORY' + s), { newWeaponsOnly: true });
      expect(cards).toHaveLength(3);
      for (const c of cards) {
        expect(c.kind).toBe('weapon');
        if (c.kind === 'weapon') expect(c.def.slot).not.toBe('system');
      }
    }
  });
});

/** A world with one pilot at the origin and a round inbound from just ahead. */
function shotAt(w: World, dmg = 10): void {
  const pl = w.player;
  pl.pos.set(0, 0, 0);
  pl.prev.copy(pl.pos);
  pl.vel.set(0, 0, 0);
  w.spawnEnemyShot(0, 0, -6, 0, 0, 40, dmg, 1, 0.6, 3);
}

describe('guard and parry', () => {
  const run = (w: World, guard: boolean, ticks: number) => {
    const c = emptyControls();
    c.guard = guard;
    for (let i = 0; i < ticks; i++) w.update(c, 1 / 60);
  };
  const health = (w: World) => w.player.hull + w.player.shield;

  it('a guard raised as the round lands reflects it and takes no damage', () => {
    const w = new World('PARRY', lantern());
    w.refreshParams();
    let parries = 0;
    w.events.on('parry', (p) => void (p.reflected && parries++));
    run(w, false, 1);
    shotAt(w);
    const before = health(w);
    run(w, true, 6);
    expect(parries).toBe(1);
    expect(health(w)).toBe(before);
    // the round now flies for us
    expect(w.proj.n).toBeGreaterThan(0);
    expect(w.eproj.n).toBe(0);
  });

  it('a late guard blocks most of the hit; no guard takes all of it', () => {
    const taken = (guard: boolean) => {
      const w = new World('BLOCK', lantern());
      w.refreshParams();
      run(w, guard, Math.ceil((GUARD.parryWindow * 1.5) * 60) + 4);
      shotAt(w, 20);
      const before = health(w);
      run(w, guard, 12);
      return before - health(w);
    };
    const open = taken(false);
    const blocked = taken(true);
    expect(open).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(open * 0.5);
  });

  it('holding the guard does not re-arm the parry window, and guns stay quiet', () => {
    const w = new World('HOLD', lantern());
    w.refreshParams();
    const c = emptyControls();
    c.guard = true;
    c.fire1 = true;
    for (let i = 0; i < 180; i++) {
      w.update(c, 1 / 60);
      if (i > 20) expect(w.player.parryOpen()).toBe(false);
      // no shots while the guard is up
      if (i === 60) expect(w.build.primary.shots).toBe(0);
    }
    // the guard times out after maxHold and stays down while the key is still held, so the guns resume
    expect(w.player.guarding).toBe(false);
    expect(w.build.primary.shots).toBeGreaterThan(0);
  });

  it('the guard bit survives a replay round trip', () => {
    const rec = new ReplayRecorder(4);
    const c = emptyControls();
    c.guard = true;
    rec.capture(c);
    expect(rec.read(0, emptyControls()).guard).toBe(true);
  });
});

describe('kill streak', () => {
  it('builds fire rate with kills and halves when you are hit', () => {
    const w = new World('STREAK', lantern());
    w.refreshParams();
    const tiers: number[] = [];
    w.events.on('streak', (s) => void tiers.push(s.tier));
    for (let i = 0; i < 24; i++) w.killEnemy(w.spawnEnemy('scrapper', 30, 0, -30, 0), 0);
    expect(w.streak).toBe(24);
    expect(tiers).toEqual([1, 2]);
    expect(w.streakRate()).toBeCloseTo(1.4);
    w.player.iframeT = 0;
    w.player.hurtT = 0;
    w.hurtPlayer(5, 'test');
    expect(w.streak).toBe(12);
    // it lapses without kills
    const c = emptyControls();
    for (let i = 0; i < 60 * 4; i++) w.update(c, 1 / 60);
    expect(w.streak).toBe(0);
    expect(w.streakRate()).toBe(1);
  });
});

describe('sustain drops and shield upgrades', () => {
  it('Shield Cells restore shield and restart regen; Hull Patches scale with max hull', () => {
    const w = new World('DROPS2', lantern());
    w.refreshParams();
    const pl = w.player;
    pl.shield = 0;
    pl.shieldDelayT = 3;
    w.drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, kind: 'barrier', age: 0 });
    w.collectDrop(0);
    expect(pl.shield).toBe(barrierAmount(pl.maxShield));
    expect(pl.shieldDelayT).toBe(0);
    pl.hull = 10;
    w.drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, kind: 'repair', age: 0 });
    w.collectDrop(0);
    expect(pl.hull).toBe(10 + repairAmount(pl.maxHull));
    expect(repairAmount(200)).toBeGreaterThan(repairAmount(100));
  });

  it('Overcharge Cells let pickups push the shield past max, and the excess bleeds away', () => {
    const b = lantern();
    b.addUpgrade(UPGRADE_BY_ID.overshield!);
    const w = new World('OVER', b);
    w.refreshParams();
    const pl = w.player;
    pl.shield = pl.maxShield;
    w.drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, kind: 'barrier', age: 0 });
    w.collectDrop(0);
    expect(pl.shield).toBeGreaterThan(pl.maxShield);
    expect(pl.shield).toBeLessThanOrEqual(pl.maxShield * 1.5);
    const c = emptyControls();
    for (let i = 0; i < 60 * 20; i++) w.update(c, 1 / 60);
    expect(pl.shield).toBeCloseTo(pl.maxShield);
  });

  it('Second Wind refills the shield when a hit drops the hull low', () => {
    const b = lantern();
    b.addUpgrade(UPGRADE_BY_ID.secondwind!);
    const w = new World('WIND', b);
    w.refreshParams();
    const pl = w.player;
    pl.shield = 0;
    pl.hull = pl.maxHull * 0.4;
    w.hurtPlayer(15, 'test');
    expect(pl.hull).toBeLessThan(pl.maxHull * 0.35);
    expect(pl.shield).toBe(pl.maxShield);
  });

  it('Capacitor Burst erases nearby enemy fire when the shield breaks', () => {
    const b = lantern();
    b.addUpgrade(UPGRADE_BY_ID.capburst!);
    const w = new World('BURST', b);
    w.refreshParams();
    const pl = w.player;
    for (let i = 0; i < 5; i++) w.spawnEnemyShot(pl.pos.x + 8, pl.pos.y, pl.pos.z + i, 0, 0, 0, 5, 1);
    pl.shield = 1;
    w.hurtPlayer(10, 'test');
    expect(w.eproj.n).toBe(0);
  });
});
