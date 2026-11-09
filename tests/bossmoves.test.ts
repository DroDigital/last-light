import { describe, expect, it } from 'vitest';
import { SECTORS, BOSSES, HULLS } from '../src/data/world';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { Director } from '../src/game/run';
import { WEAPONS } from '../src/data/weapons';
import { emptyControls } from '../src/game/player';
import { SIGNATURES, SIG_OWNER } from '../src/game/bossmoves';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: false, heat: 0 });

/** Fight a boss through every phase with an unkillable pilot; record what it did. */
function fight(bossId: string, seconds = 70) {
  const s = SECTORS.find((x) => x.boss === bossId)!;
  const b = new Build(HULLS[0]!, meta());
  const w = new World('MOVES-' + bossId, b);
  w.refreshParams();
  const dir = new Director('boss', SECTORS.indexOf(s), 9, w, 0, 7);
  const boss = dir.boss!;
  const moves = new Set<string>();
  const masks = new Set<string>();
  w.events.on('bossMove', (m) => {
    moves.add(m.id);
    if (m.mask) masks.add(m.mask);
  });
  let hurt = 0;
  w.events.on('hurt', () => hurt++);
  // an unkillable test pilot: hits still land and count, but nothing ends the fight
  w.killPlayer = () => {};
  const c = emptyControls();
  const total = 60 * seconds;
  const nPhases = BOSSES[bossId]!.phases.length;
  for (let t = 0; t < total; t++) {
    w.player.hull = w.player.maxHull;
    // wander so movement-based moves have something to chase
    c.mx = Math.sin(t / 90);
    c.mz = Math.cos(t / 120);
    // walk the boss down so each phase gets an equal share of the fight
    const want = Math.floor((t / total) * nPhases);
    const frac = 1 - (want + 0.5) / nPhases;
    if (boss.core.hp > boss.core.maxHp * frac) {
      boss.core.invuln = false;
      boss.core.hp = boss.core.maxHp * frac;
    }
    dir.update(1 / 60);
    w.update(c, 1 / 60);
    expect(Number.isFinite(w.player.pos.x + w.player.pos.y + w.player.pos.z)).toBe(true);
    for (const e of w.enemies) expect(Number.isFinite(e.pos.x + e.pos.y + e.pos.z)).toBe(true);
  }
  return { boss, moves, masks, hurt, w };
}

describe('boss signature moves', () => {
  it('every boss owns at least four signature moves', () => {
    for (const id of Object.keys(BOSSES)) {
      const own = [...SIGNATURES].filter((s) => SIG_OWNER[s as keyof typeof SIG_OWNER] === id);
      expect(own.length, id).toBeGreaterThanOrEqual(id === 'endlessnight' ? 3 : 4);
    }
  });

  for (const id of Object.keys(BOSSES)) {
    it(`${BOSSES[id]!.name} uses its own moves through every phase without breaking the sim`, () => {
      const { boss, moves, hurt } = fight(id);
      const own = [...SIGNATURES].filter((s) => SIG_OWNER[s as keyof typeof SIG_OWNER] === id && s !== 'masks');
      for (const m of own) expect(moves.has(m), `${id} never used ${m}`).toBe(true);
      // the moves actually threaten a pilot who just drifts around
      expect(hurt).toBeGreaterThan(10);
      expect(boss.dead).toBe(false);
    });
  }

  it('the Endless Night borrows moves from the bosses before it', () => {
    const { masks } = fight('endlessnight', 90);
    expect(masks.size).toBeGreaterThanOrEqual(4);
    expect(masks.has('endlessnight')).toBe(false);
  });

  it('hazards and flights are cleared when the boss dies', () => {
    const { boss, w } = fight('foreman', 20);
    boss.core.invuln = false;
    boss.core.hp = 0;
    w.killEnemy(boss.core, 1);
    const c = emptyControls();
    for (let t = 0; t < 60 * 5; t++) w.update(c, 1 / 60);
    expect(boss.dead).toBe(true);
    expect(boss.zones.length).toBe(0);
  });
});

describe('Act II pacing', () => {
  it('rigs bolted to rocks never hold a fight open', () => {
    const s = SECTORS.find((x) => x.id === 'magnetar')!;
    const b = new Build(HULLS[0]!, meta());
    const w = new World('RIGS', b);
    w.refreshParams();
    new Director('combat', SECTORS.indexOf(s), 3, w, 0, 2);
    const rigs = w.enemies.filter((e) => e.def.id === 'turretrig');
    expect(rigs.length).toBeGreaterThan(0);
    expect(rigs.every((e) => e.optional)).toBe(true);
    for (const e of w.enemies) if (!e.optional && e.def.role !== 'inert') e.alive = false;
    expect(w.liveEnemyCount()).toBe(0);
  });

  it('the last few hostiles warp in when they hang back far away', () => {
    const s = SECTORS.find((x) => x.id === 'forge')!;
    const b = new Build(HULLS[0]!, meta());
    const w = new World('CONVERGE', b);
    w.refreshParams();
    const dir = new Director('combat', SECTORS.indexOf(s), 3, w, 0, 2);
    dir.spent = dir.budget; // no more spawns
    for (const e of w.enemies) if (e.def.role !== 'inert') e.alive = false;
    const far = [w.spawnEnemy('gunship', 250, 0, 0, 0), w.spawnEnemy('gunship', -250, 0, 0, 0)];
    w.player.pos.set(0, 0, 0);
    w.player.hull = 1e9;
    const c = emptyControls();
    for (let t = 0; t < 60 * 5; t++) {
      dir.update(1 / 60);
      w.update(c, 1 / 60);
    }
    for (const e of far) expect(e.pos.distanceTo(w.player.pos)).toBeLessThan(110);
  });

  it('Act II fights fold in warp ambushes around the pilot', () => {
    const s = SECTORS.find((x) => x.id === 'quasar')!;
    const b = new Build(HULLS[0]!, meta());
    const w = new World('AMBUSH', b);
    w.refreshParams();
    const dir = new Director('combat', SECTORS.indexOf(s), 3, w, 0, 2);
    w.killPlayer = () => {};
    let ambushes = 0;
    w.events.on('telegraph', (t) => void (t.kind === 'ambush' && ambushes++));
    const c = emptyControls();
    for (let t = 0; t < 60 * 40; t++) {
      dir.update(1 / 60);
      w.update(c, 1 / 60);
    }
    expect(ambushes).toBeGreaterThanOrEqual(1);
  });
});
