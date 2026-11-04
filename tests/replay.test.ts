import { describe, it, expect } from 'vitest';
import { World } from '../src/game/world';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { emptyControls, type Controls } from '../src/game/player';
import { Director } from '../src/game/run';
import { ReplayRecorder, hashWorld } from '../src/game/replay';
import { WEAPONS } from '../src/data/weapons';
import { UPGRADES } from '../src/data/upgrades';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: true, heat: 0 });

/** A busy, varied build so the test exercises triggers, statuses, drones and splits. */
function makeWorld(seed: string): World {
  const b = new Build(HULLS[0]!, meta());
  for (const id of ['el_shock_1', 'el_burn_1', 'detonate_1', 'splitter_1', 'seeker_1', 'a_nova7']) b.addUpgrade(UPGRADES.find((u) => u.id === id)!);
  b.addWeapon(WEAPONS.find((w) => w.id === 'interceptors')!);
  b.addWeapon(WEAPONS.find((w) => w.id === 'halo')!);
  const w = new World(seed, b);
  w.refreshParams();
  return w;
}

/** Scripted "player": deterministic in the tick index, wiggly enough to matter. */
function script(t: number, c: Controls): Controls {
  c.mx = Math.sin(t * 0.031);
  c.my = Math.sin(t * 0.017) * 0.4;
  c.mz = 0.6 + 0.4 * Math.sin(t * 0.011);
  c.yaw = Math.sin(t * 0.023) * 0.013;
  c.pitch = Math.cos(t * 0.019) * 0.009;
  c.fire1 = t % 90 < 70;
  c.fire2 = t % 240 < 20;
  c.boost = t % 300 > 260;
  c.dodge = t % 211 === 0;
  c.ability1 = t % 557 === 0;
  c.ability2 = t % 733 === 0;
  c.flare = true;
  return c;
}

function runLive(seed: string, ticks: number, rec?: ReplayRecorder): string[] {
  const w = makeWorld(seed);
  const dir = new Director('combat', 1, 1234, w, 0);
  const c = emptyControls();
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    script(t, c);
    rec?.capture(c);
    dir.update(1 / 60);
    w.update(c, 1 / 60);
    c.dodge = c.ability1 = c.ability2 = false;
    if (t % 120 === 119) hashes.push(hashWorld(w));
  }
  return hashes;
}

function runReplay(seed: string, rec: ReplayRecorder): string[] {
  const w = makeWorld(seed);
  const dir = new Director('combat', 1, 1234, w, 0);
  const c = emptyControls();
  const hashes: string[] = [];
  for (let t = 0; t < rec.ticks; t++) {
    rec.read(t, c);
    dir.update(1 / 60);
    w.update(c, 1 / 60);
    if (t % 120 === 119) hashes.push(hashWorld(w));
  }
  return hashes;
}

describe('determinism & replays', () => {
  it('same seed + same inputs produce identical worlds over 40 s of busy combat', () => {
    const a = runLive('DET-1', 2400);
    const b = runLive('DET-1', 2400);
    expect(a).toEqual(b);
    expect(runLive('DET-2', 2400)).not.toEqual(a);
  });

  it('a recorded run replays bit-for-bit from its controls stream', () => {
    const rec = new ReplayRecorder(64);
    const live = runLive('REPLAY', 2400, rec);
    expect(rec.ticks).toBe(2400);
    expect(runReplay('REPLAY', rec)).toEqual(live);
  });
});
