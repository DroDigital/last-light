import { describe, it, expect } from 'vitest';
import { Rng, dailySeed } from '../src/core/rng';
import { generateMap, MAP_ROWS } from '../src/game/run';
import { migrate, SAVE_VERSION, defaultSave, STARTER_WEAPONS } from '../src/meta/save';
import { Build, MAX_LEVEL } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { UPGRADES, SYNERGIES } from '../src/data/upgrades';
import { WEAPONS } from '../src/data/weapons';
import { ENEMIES } from '../src/data/enemies';
import { PALETTES } from '../src/data/palettes';

const meta = (all = false) => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(all ? WEAPONS.map((w) => w.id) : STARTER_WEAPONS), tier2: true, heat: 0 });

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng('ABC');
    const b = new Rng('ABC');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(new Rng('ABC').next()).not.toBe(new Rng('ABD').next());
  });
  it('daily seed is stable per UTC date', () => {
    expect(dailySeed(new Date(Date.UTC(2026, 10, 3, 1)))).toBe(dailySeed(new Date(Date.UTC(2026, 10, 3, 23))));
  });
});

describe('content scale', () => {
  it('meets launch targets', () => {
    expect(WEAPONS.length).toBeGreaterThanOrEqual(30);
    expect(UPGRADES.length).toBeGreaterThanOrEqual(150);
    expect(SYNERGIES.length + WEAPONS.length).toBeGreaterThanOrEqual(40); // synergies + evolutions
    expect(ENEMIES.filter((e) => e.role !== 'inert').length).toBeGreaterThanOrEqual(25);
    expect(PALETTES.length).toBeGreaterThanOrEqual(6);
  });
  it('every upgrade declares a visible layer and unique id', () => {
    const ids = new Set<string>();
    for (const u of UPGRADES) {
      expect(u.visual).toBeTruthy();
      expect(ids.has(u.id)).toBe(false);
      ids.add(u.id);
    }
  });
});

describe('sector map', () => {
  it('is deterministic, fully connected, and ends in a boss', () => {
    const m1 = generateMap(42, 0, { rifts: true, heat: 0 });
    const m2 = generateMap(42, 0, { rifts: true, heat: 0 });
    expect(JSON.stringify(m1)).toBe(JSON.stringify(m2));
    for (let seed = 0; seed < 200; seed++) {
      const m = generateMap(seed, seed % 5, { rifts: seed % 2 === 0, heat: 0 });
      const boss = m.nodes.filter((n) => n.type === 'boss');
      expect(boss.length).toBe(1);
      // every non-first-row node has an incoming link; every non-boss node has an outgoing link
      for (const n of m.nodes) {
        if (n.row > 0) expect(m.nodes.some((p) => p.links.includes(n.id))).toBe(true);
        if (n.type !== 'boss') expect(n.links.length).toBeGreaterThan(0);
      }
      expect(m.nodes.some((n) => n.type === 'shop')).toBe(true);
      expect(m.nodes.some((n) => n.type === 'rest')).toBe(true);
      expect(m.nodes.some((n) => n.type === 'elite')).toBe(true);
      // a sector is long enough to build in: the boss is MAP_ROWS - 1 jumps away
      expect(boss[0]!.row).toBe(MAP_ROWS - 1);
      expect(MAP_ROWS).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('saves', () => {
  it('migrates a v1 save to the current schema', () => {
    const v1 = { version: 1, light: 120, runs: 4, settings: { shake: 0.5 } };
    const s = migrate(v1);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.embers).toBe(120);
    expect(s.runs).toBe(4);
    expect(s.settings.shake).toBe(0.5);
    expect(s.settings.bindings.fire1).toBeTruthy();
    expect(s.codex.weapons).toEqual([]);
  });
  it('round-trips the default save', () => {
    const d = defaultSave();
    expect(migrate(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('survives garbage', () => {
    expect(migrate('nope').version).toBe(SAVE_VERSION);
    expect(migrate(null).embers).toBe(0);
  });
});

describe('build & draft', () => {
  it('drafts are deterministic and respect tier chains', () => {
    const b1 = new Build(HULLS[0]!, meta());
    const b2 = new Build(HULLS[0]!, meta());
    const d1 = b1.draft(new Rng(7)).map((c) => c.kind + (c.kind === 'upgrade' ? c.def.id : ''));
    const d2 = b2.draft(new Rng(7)).map((c) => c.kind + (c.kind === 'upgrade' ? c.def.id : ''));
    expect(d1).toEqual(d2);
    const pool = b1.upgradePool({ allowArtifacts: false, allowCurses: false });
    expect(pool.some((u) => u.id === 'barrels_2')).toBe(false);
    b1.addUpgrade(UPGRADES.find((u) => u.id === 'barrels_1')!);
    expect(b1.upgradePool({ allowArtifacts: false, allowCurses: false }).some((u) => u.id === 'barrels_2')).toBe(true);
  });
  it('damage upgrades increase primary damage and synergies activate by tags', () => {
    const b = new Build(HULLS[0]!, meta());
    const d0 = b.primary.params.damage;
    b.addUpgrade(UPGRADES.find((u) => u.id === 'barrels_1')!);
    expect(b.primary.params.damage).toBeCloseTo(d0 * 1.15);
    for (const id of ['el_burn_1', 'el_burn_2', 'el_burn_3']) b.addUpgrade(UPGRADES.find((u) => u.id === id)!);
    expect(b.synergies.has('wildfire')).toBe(true);
  });
  it('weapons evolve at max level with their tag', () => {
    const b = new Build(HULLS[0]!, meta());
    const w = b.primary; // pulse laser evolves with 'pierce'
    for (let i = 1; i < MAX_LEVEL; i++) b.levelUp(w);
    expect(b.canEvolve(w)).toBe(false);
    b.addUpgrade(UPGRADES.find((u) => u.id === 'piercing_1')!);
    expect(b.canEvolve(w)).toBe(true);
    expect(b.draft(new Rng(1))[0]!.kind).toBe('evolve');
    b.evolve(w);
    expect(w.name).toBe(w.def.evolve.name);
  });
});
