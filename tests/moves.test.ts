import { describe, expect, it } from 'vitest';
import { SUBTYPES } from '../src/data/subtypes';
import { MOVES, type MoveId } from '../src/game/moves';
import { ENEMIES } from '../src/data/enemies';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

describe('enemy subtypes and move sets', () => {
  it('every fighting enemy type has at least two variants, all with known moves', () => {
    for (const e of ENEMIES) {
      if (e.role === 'inert') continue;
      const list = SUBTYPES[e.id];
      expect(list, e.id).toBeDefined();
      expect(list!.length, e.id).toBeGreaterThanOrEqual(2);
      for (const s of list!) for (const m of s.moves) expect(MOVES[m as MoveId], `${e.id}/${s.id}/${m}`).toBeDefined();
    }
  });

  it('variants of one type fight differently (distinct move sets)', () => {
    for (const [id, list] of Object.entries(SUBTYPES)) {
      const sigs = new Set(list.map((s) => s.moves.slice().sort().join(',')));
      expect(sigs.size, id).toBe(list.length);
    }
  });

  it('every move runs in the sim without breaking anything', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = new World('MOVES', b);
    w.refreshParams();
    w.sectorIdx = 4;
    w.maxTokens = 99;
    for (const e of ENEMIES) {
      if (e.role === 'inert') continue;
      for (let k = 0; k < SUBTYPES[e.id]!.length; k++) {
        const en = w.spawnEnemy(e.id, (k - 1) * 20, 0, 20 + Math.random() * 40);
        en.spawnT = 0;
        en.subtype = k;
        en.moveT = 0;
      }
    }
    w.player.hull = 1e9;
    const used = new Set<string>();
    const c = emptyControls();
    c.fire1 = true;
    for (let t = 0; t < 60 * 30; t++) {
      w.update(c, 1 / 60);
      for (const e of w.enemies) if (e.move) used.add(e.move);
    }
    for (const e of w.enemies) expect(Number.isFinite(e.pos.x + e.pos.y + e.pos.z + e.vel.x)).toBe(true);
    // most of the library actually fires in a 30 s brawl
    expect(used.size).toBeGreaterThanOrEqual(12);
  });
});
