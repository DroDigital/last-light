import { describe, expect, it } from 'vitest';
import { CLASSES, CLASS_BY_HULL, MAX_CLASS_LEVEL, SKILL_BY_ID, canLearn, canUnlearn, classLevel, sanitizeLearned, skillLoadout, skillPoints, spentPoints, xpForRun, xpToNext } from '../src/data/classes';
import { HEARTH_HULLS, HULLS, HULL_BY_ID } from '../src/data/world';
import { WEAPONS, WEAPON_BY_ID } from '../src/data/weapons';
import { Build } from '../src/game/build';
import { World } from '../src/game/world';
import { HARDPOINTS } from '../src/game/weapons';
import { buildPlayerShip } from '../src/render/meshes';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: true, heat: 0 });
const allNodes = (id: string) => CLASSES.find((c) => c.id === id)!.branches.flatMap((b) => b.nodes);

/** Every flag a skill node may set must be read somewhere in the sim. */
const IMPLEMENTED_FLAGS = new Set(['vgLastStand', 'vgIronWill', 'stDeadeye', 'stormfront', 'eventhorizon']);

describe('pilot classes', () => {
  it('ships three free classes with distinct ships and starting weapons', () => {
    expect(CLASSES).toHaveLength(3);
    const prim = new Set(CLASSES.map((c) => c.hull.start.primary));
    const sec = new Set(CLASSES.map((c) => c.hull.start.secondary));
    expect(prim.size).toBe(3);
    expect(sec.size).toBe(3);
    for (const c of CLASSES) {
      expect(c.hull.cost).toBe(0);
      expect(c.hull.classId).toBe(c.id);
      expect(HULL_BY_ID[c.hull.id]).toBe(c.hull);
      expect(CLASS_BY_HULL[c.hull.id]).toBe(c);
      expect(HEARTH_HULLS).not.toContain(c.hull);
      for (const w of [c.hull.start.primary, c.hull.start.secondary, c.hull.start.system]) if (w) expect(WEAPON_BY_ID[w], w).toBeDefined();
      expect(WEAPON_BY_ID[c.hull.start.primary]!.slot).toBe('primary');
      expect(WEAPON_BY_ID[c.hull.start.secondary]!.slot).toBe('secondary');
      // a real model and gun positions for the ship
      expect(buildPlayerShip(c.hull.id).getAttribute('position').count).toBeGreaterThan(buildPlayerShip('lantern').getAttribute('position').count);
      expect(HARDPOINTS[c.hull.id]).toBeDefined();
    }
    expect(HULLS[0]!.id).toBe('lantern');
  });

  it('gives every class its own tree: 3 branches of 4 tiers, unique nodes, each with an effect', () => {
    const ids = new Set<string>();
    for (const c of CLASSES) {
      expect(c.branches).toHaveLength(3);
      for (const b of c.branches) {
        expect(b.nodes.map((n) => n.tier)).toEqual([1, 2, 3, 4]);
        for (const n of b.nodes) {
          expect(ids.has(n.id)).toBe(false);
          ids.add(n.id);
          expect((n.mods?.length ?? 0) + (n.triggers?.length ?? 0) + (n.flags?.length ?? 0), n.id).toBeGreaterThan(0);
          for (const f of n.flags ?? []) expect(IMPLEMENTED_FLAGS.has(f), f).toBe(true);
        }
      }
    }
    // no two classes share a branch
    expect(new Set(CLASSES.flatMap((c) => c.branches.map((b) => b.id))).size).toBe(9);
  });

  it('levels from XP, one skill point per level, capped', () => {
    expect(classLevel(0)).toEqual({ level: 1, into: 0, need: xpToNext(1) });
    expect(classLevel(xpToNext(1)).level).toBe(2);
    expect(classLevel(1e9).level).toBe(MAX_CLASS_LEVEL);
    expect(skillPoints(1)).toBe(1);
    expect(skillPoints(MAX_CLASS_LEVEL)).toBe(MAX_CLASS_LEVEL);
    // a decent dive is worth at least a level early on; a full tree is not free
    expect(xpForRun({ sector: 3, kills: 120, bosses: 2, won: false })).toBeGreaterThan(xpToNext(1));
    const total = CLASSES[0]!.branches.flatMap((b) => b.nodes).reduce((a, n) => a + n.cost, 0);
    expect(total).toBeGreaterThan(skillPoints(MAX_CLASS_LEVEL));
  });

  it('enforces tier order, points and refunds', () => {
    const [p1, p2, p3, p4] = CLASSES[0]!.branches[0]!.nodes;
    expect(canLearn('vanguard', [], p2!.id, 10)).toBe('locked');
    expect(canLearn('vanguard', [], p1!.id, 0)).toBe('points');
    expect(canLearn('vanguard', [], p1!.id, 1)).toBe('ok');
    expect(canLearn('striker', [], p1!.id, 10)).toBe('unknown');
    const learned = [p1!.id, p2!.id, p3!.id];
    expect(spentPoints(learned)).toBe(4);
    expect(canLearn('vanguard', learned, p4!.id, 6)).toBe('points');
    expect(canLearn('vanguard', learned, p4!.id, 7)).toBe('ok');
    expect(canUnlearn(learned, p1!.id)).toBe(false);
    expect(canUnlearn(learned, p3!.id)).toBe(true);
    // a stale save (missing prerequisite, unknown id, too few points) is cleaned up
    expect(sanitizeLearned('vanguard', [p2!.id, 'nope', p1!.id], 10)).toEqual([p1!.id, p2!.id]);
    expect(sanitizeLearned('vanguard', [p1!.id, p2!.id, p3!.id], 2)).toEqual([p1!.id, p2!.id]);
  });

  it('applies the passive and learned nodes to the build', () => {
    const aegis = HULL_BY_ID.aegis!;
    const plain = new Build(aegis, meta());
    const skilled = new Build(aegis, meta());
    skilled.setSkills(skillLoadout('vanguard', ['vg_plating', 'vg_reactive', 'vg_shells']));
    expect(skilled.ship.hull).toBe(plain.ship.hull + 20);
    expect(skilled.ship.armor).toBe(plain.ship.armor + 1);
    expect(skilled.primary.params.damage).toBeCloseTo(plain.primary.params.damage * 1.15, 5); // flak is an area weapon
    // learned nodes of another class are ignored
    expect(skillLoadout('vanguard', ['st_optics']).mods).toHaveLength(0);
    // Conduit's passive is always on
    const loom = new Build(HULL_BY_ID.loom!, meta());
    loom.setSkills(skillLoadout('conduit', []));
    expect(loom.primary.params.statusPower).toBeCloseTo(1.25, 5);
    expect(loom.systems[0]!.def.id).toBe('interceptors');
    // keystone flags and triggers land on the build
    const st = new Build(HULL_BY_ID.kestrel!, meta());
    st.setSkills(skillLoadout('striker', allNodes('striker').map((n) => n.id)));
    expect(st.flags.has('stDeadeye')).toBe(true);
    expect(st.flags.has('stSlipstream')).toBe(true);
    expect(st.triggers.some((t) => t.on === 'dodge' && t.do === 'missiles')).toBe(true);
  });

  it('Unbreakable survives one killing blow per minute', () => {
    const b = new Build(HULL_BY_ID.aegis!, meta());
    b.setSkills(skillLoadout('vanguard', ['vg_plating', 'vg_reactive', 'vg_barrier', 'vg_laststand']));
    const w = new World('STAND', b);
    const pl = w.player;
    pl.shield = 0;
    w.hurtPlayer(10000, 'test');
    expect(pl.alive).toBe(true);
    expect(pl.hull).toBe(1);
    expect(pl.iframeT).toBeGreaterThan(1.5);
    pl.iframeT = 0;
    pl.hurtT = 0;
    pl.shield = 0;
    w.hurtPlayer(10000, 'test');
    expect(pl.alive).toBe(false);
  });

  it('Iron Will trades hull for damage', () => {
    const b = new Build(HULL_BY_ID.aegis!, meta());
    b.setSkills(skillLoadout('vanguard', SKILL_BY_ID.vg_ironwill!.branch.nodes.map((n) => n.id)));
    const w = new World('IRON', b);
    const full = w.player.damageMul();
    w.player.hull = w.player.maxHull * 0.25;
    expect(w.player.damageMul()).toBeCloseTo(full * (1 + 0.5 * 0.75), 5);
  });

  it('Slipstream: a dodge primes a damage window', () => {
    const w = new World('SLIP', new Build(HULL_BY_ID.kestrel!, meta()));
    const base = w.player.damageMul();
    w.onDodge();
    expect(w.player.damageMul()).toBeCloseTo(base * 1.3, 5);
  });

  it('migrates v4 saves: classes start empty, returning pilots keep the Lantern', () => {
    const v4 = { ...defaultSave(), version: 4 } as Record<string, unknown>;
    delete v4.classes;
    delete v4.selectedHull;
    const s = migrate(v4);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.classes).toEqual({});
    expect(s.selectedHull).toBe('lantern');
    expect(defaultSave().selectedHull).toBe('aegis');
  });
});
