import { describe, expect, it } from 'vitest';
import { Build } from '../src/game/build';
import { World } from '../src/game/world';
import { HULLS } from '../src/data/world';
import { WEAPON_BY_ID, WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';
import { updateWeapons } from '../src/game/weapons';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: true, heat: 0 });

describe('weapon-specific mechanics', () => {
  it('Photon Fan projectiles gain damage as Light is collected', () => {
    const shot = (light: number) => {
      const w = new World('PHOTON', new Build(HULLS[0]!, meta(), 'photon'));
      w.player.lightTotal = light;
      const c = emptyControls();
      c.fire1 = true;
      updateWeapons(w, c, 1 / 60);
      return w.proj.dmg[0]!;
    };
    expect(shot(3000)).toBeGreaterThan(shot(0));
  });

  it('Flare Beam draws Lumen while firing without draining below zero', () => {
    const b = new Build(HULLS[0]!, meta());
    b.addWeapon(WEAPON_BY_ID.flarebeam!);
    const w = new World('FLARE-BEAM', b);
    w.player.lumen = 10;
    const c = emptyControls();
    c.fire2 = true;
    for (let i = 0; i < 60; i++) updateWeapons(w, c, 1 / 60);
    expect(w.player.lumen).toBeGreaterThan(0);
    expect(w.player.lumen).toBeLessThan(10);
    c.fire2 = false;
    const remaining = w.player.lumen;
    for (let i = 0; i < 60; i++) updateWeapons(w, c, 1 / 60);
    expect(w.player.lumen).toBe(remaining);
    c.fire2 = true;
    for (let i = 0; i < 600; i++) updateWeapons(w, c, 1 / 60);
    expect(w.player.lumen).toBe(0);
  });

  it('Flare Beam deals more damage while it has Lumen to spend', () => {
    const shot = (lumen: number) => {
      const b = new Build(HULLS[0]!, meta());
      b.addWeapon(WEAPON_BY_ID.flarebeam!);
      b.secondary.params.crit = 0;
      const w = new World('FLARE-DAMAGE', b);
      w.player.pos.set(0, 0, 0);
      w.player.lumen = lumen;
      const enemy = w.spawnEnemy('scrapper', 0, 0, -40, 0);
      enemy.hp = enemy.maxHp = 10000;
      enemy.armor = enemy.shield = 0;
      const c = emptyControls();
      c.fire2 = true;
      updateWeapons(w, c, 1 / 60);
      return 10000 - enemy.hp;
    };
    expect(shot(10)).toBeGreaterThan(shot(0));
  });

  it.each(['lance', 'railgun', 'arc'])('Mirror Drone copies %s primary fire', (primary) => {
    const shot = (mirror: boolean) => {
      const b = new Build(HULLS[0]!, meta(), primary);
      if (mirror) b.addWeapon(WEAPON_BY_ID.mirror!);
      const w = new World('MIRROR', b);
      w.player.pos.set(0, 0, 0);
      for (const d of w.drones) d.pos.copy(w.player.pos);
      const enemy = w.spawnEnemy('scrapper', 0, 0, -40, 0);
      enemy.hp = enemy.maxHp = 10000;
      enemy.armor = enemy.shield = 0;
      b.primary.params.crit = 0;
      const c = emptyControls();
      c.fire1 = true;
      updateWeapons(w, c, 1 / 60);
      return { damage: 10000 - enemy.hp, effects: primary === 'lance' ? w.beams.length : primary === 'arc' ? w.arcs.length : w.rails.length };
    };
    const base = shot(false);
    const mirrored = shot(true);
    expect(base.damage).toBeGreaterThan(0);
    expect(mirrored.effects).toBeGreaterThan(base.effects);
    expect(mirrored.damage).toBeGreaterThan(base.damage);
  });
});
