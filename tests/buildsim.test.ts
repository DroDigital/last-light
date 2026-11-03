/**
 * Automated build simulations: play thousands of random drafts, verify the
 * power curve per sector stays in range, and that trigger chains terminate.
 */
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/core/rng';
import { Build } from '../src/game/build';
import { HULLS } from '../src/data/world';
import { WEAPONS } from '../src/data/weapons';
import { World } from '../src/game/world';
import { emptyControls } from '../src/game/player';
import { UPGRADES } from '../src/data/upgrades';

const meta = () => ({ bonusHull: 0, bonusShield: 0, bonusLight: 0, unlockedWeapons: new Set(WEAPONS.map((w) => w.id)), tier2: true, heat: 0 });
const PICKS_PER_SECTOR = 4;

describe('build simulations', () => {
  it('power curve grows each sector but stays bounded', () => {
    const curves: number[][] = [];
    for (let run = 0; run < 300; run++) {
      const rng = new Rng('sim' + run);
      const hull = HULLS[run % HULLS.length]!;
      const b = new Build(hull, meta());
      const curve = [b.dpsEstimate()];
      for (let s = 0; s < 5; s++) {
        for (let p = 0; p < PICKS_PER_SECTOR; p++) {
          const cards = b.draft(rng.fork(s * 10 + p), { allowArtifacts: p === 3 });
          if (!cards.length) continue;
          // prefer combos 60% of the time like a reasonable player
          const pick = rng.chance(0.6) ? cards.reduce((a, c) => (c.combo > a.combo ? c : a), cards[0]!) : rng.pick(cards);
          b.apply(pick);
        }
        curve.push(b.dpsEstimate());
      }
      curves.push(curve);
    }
    const med = (i: number) => {
      const v = curves.map((c) => c[i]!).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)]!;
    };
    const meds = [0, 1, 2, 3, 4, 5].map(med);
    console.log('median DPS per sector', meds.map((x) => x.toFixed(0)).join(' → '));
    for (let i = 1; i < meds.length; i++) expect(meds[i]!).toBeGreaterThan(meds[i - 1]!);
    // final power: absurd, but not infinite
    expect(meds[5]! / meds[0]!).toBeGreaterThan(3);
    for (const c of curves) expect(Number.isFinite(c[5]!)).toBe(true);
    const maxFinal = Math.max(...curves.map((c) => c[5]!));
    expect(maxFinal / meds[5]!).toBeLessThan(25);
  }, 60_000);

  it('trigger-heavy builds terminate (no infinite chains) and stay finite', () => {
    const b = new Build(HULLS[0]!, meta());
    const ids = ['detonate_1', 'detonate_2', 'payload', 'discharge', 'critchain', 'frostkill', 'voidkill', 'a_nova7', 'a_critchain', 'a_motebomb', 'a_debris', 'el_shock_1', 'el_burn_1', 'el_cryo_1'];
    for (const id of ids) {
      const u = UPGRADES.find((x) => x.id === id);
      if (u) b.addUpgrade(u);
    }
    const w = new World('chain', b);
    w.player.pos.set(0, 0, 0);
    for (let i = 0; i < 200; i++) w.spawnEnemy('moteeater', (i % 20) * 3 - 30, Math.floor(i / 20) * 3 - 15, -30).spawnT = 0;
    const c = emptyControls();
    c.fire1 = true;
    c.fire2 = true;
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      w.update(c, 1 / 60);
      w.player.hull = w.player.maxHull;
    }
    const ms = performance.now() - t0;
    expect(w.stats.kills).toBeGreaterThan(50);
    expect(ms).toBeLessThan(5000);
    expect(w.proj.n).toBeLessThanOrEqual(w.proj.cap);
  });
});
