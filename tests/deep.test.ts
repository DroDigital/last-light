import { describe, expect, it } from 'vitest';
import { SECTORS, BOSSES, ACT2_START, HULLS } from '../src/data/world';
import { PALETTES } from '../src/data/palettes';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { Director } from '../src/game/run';
import { WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

describe('Act II: the Deep', () => {
  it('has five more sectors, each with its own palette feature, boss and hazard', () => {
    expect(SECTORS.length).toBe(10);
    const deep = SECTORS.slice(ACT2_START);
    expect(deep.length).toBe(5);
    expect(new Set(deep.map((s) => s.boss)).size).toBe(5);
    expect(new Set(deep.map((s) => s.hazard)).size).toBe(5);
    for (const s of deep) {
      expect(BOSSES[s.boss], s.id).toBeDefined();
      expect(BOSSES[s.boss]!.phases.length).toBe(4);
      const p = PALETTES.find((x) => x.id === s.palette);
      expect(p?.feature, s.id).toBeDefined();
      expect(p!.colors.length).toBe(16);
    }
  });

  for (const s of SECTORS.slice(ACT2_START)) {
    it(`${BOSSES[s.boss]!.name}: fights through all four phases and dies cleanly`, () => {
      const b = new Build(HULLS[0]!, meta());
      const w = new World('DEEP-' + s.id, b);
      w.refreshParams();
      const idx = SECTORS.indexOf(s);
      const dir = new Director('boss', idx, 9, w, 0, 7);
      w.player.hull = 1e9;
      const boss = dir.boss!;
      const c = emptyControls();
      const phases = new Set<number>();
      for (let t = 0; t < 60 * 25; t++) {
        // chip the boss down over the fight so every phase gets its turn
        if (t % 60 === 0 && t > 120) {
          boss.core.invuln = false;
          boss.core.hp = Math.max(1, boss.core.hp - boss.core.maxHp * 0.05);
        }
        dir.update(1 / 60);
        w.update(c, 1 / 60);
        phases.add(boss.phase);
        for (const e of w.enemies) expect(Number.isFinite(e.pos.x + e.pos.y + e.pos.z)).toBe(true);
      }
      expect(phases.size).toBe(4);
      boss.core.invuln = false;
      boss.core.hp = 0;
      w.killEnemy(boss.core, 1);
      for (let t = 0; t < 60 * 5; t++) {
        dir.update(1 / 60);
        w.update(c, 1 / 60);
      }
      expect(boss.dead).toBe(true);
      expect(w.bank.prism).toBeGreaterThanOrEqual(0);
    });
  }

  it('every hazard runs in a regular fight without breaking the sim', () => {
    for (const s of SECTORS.slice(ACT2_START)) {
      const b = new Build(HULLS[0]!, meta());
      const w = new World('HZ-' + s.id, b);
      w.refreshParams();
      const dir = new Director('combat', SECTORS.indexOf(s), 3, w, 0, 2);
      expect(dir.hazard?.kind).toBe(s.hazard);
      w.player.hull = 1e9;
      const c = emptyControls();
      for (let t = 0; t < 60 * 30; t++) {
        dir.update(1 / 60);
        w.update(c, 1 / 60);
      }
      expect(Number.isFinite(w.player.pos.x + w.player.pos.y + w.player.pos.z)).toBe(true);
    }
  });
});
