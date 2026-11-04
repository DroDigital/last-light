import { describe, expect, it } from 'vitest';
import { Buf, PV_H, PV_W, drawPreview, previewSpec, resolve } from '../src/ui/preview';
import { WEAPONS } from '../src/data/weapons';
import { UPGRADES } from '../src/data/upgrades';
import { WeaponInstance, type DraftCard } from '../src/game/build';

function render(card: DraftCard, t: number): Uint8ClampedArray {
  const b = new Buf();
  const spec = previewSpec(card);
  drawPreview(b, spec, t);
  for (const v of b.px) if (!Number.isFinite(v)) throw new Error('non-finite light value');
  const out = new Uint8ClampedArray(PV_W * PV_H * 4);
  resolve(b, out, spec.accent);
  return out;
}

/** pixels clearly brighter than the ink background */
function lit(img: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < img.length; i += 4) if (img[i]! + img[i + 1]! + img[i + 2]! > 200) n++;
  return n;
}

function allCards(): DraftCard[] {
  const cards: DraftCard[] = [];
  for (const w of WEAPONS) {
    cards.push({ kind: 'weapon', def: w, combo: 0 });
    cards.push({ kind: 'evolve', weapon: new WeaponInstance(w), combo: 0 });
  }
  for (const u of UPGRADES) cards.push({ kind: 'upgrade', def: u, combo: 0 });
  return cards;
}

describe('draft card previews', () => {
  it('every card renders a visible, finite vignette across the loop', () => {
    for (const c of allCards()) {
      let total = 0;
      for (let t = 0; t < 2.4; t += 0.2) total += lit(render(c, t));
      // the ship and targets alone light a few dozen pixels per frame
      expect(total, c.kind === 'upgrade' ? c.def.id : c.kind === 'weapon' ? c.def.id : c.weapon.def.id).toBeGreaterThan(12 * 20);
    }
  });

  it('different weapon behaviours look different', () => {
    const seen = new Map<string, string>();
    for (const w of WEAPONS) {
      if (seen.has(w.behavior)) continue;
      const img = render({ kind: 'weapon', def: w, combo: 0 }, 0.4);
      let sig = 0;
      for (let i = 0; i < img.length; i += 4) sig = (Math.imul(sig, 31) + img[i]! + img[i + 1]! * 3 + img[i + 2]! * 7) | 0;
      seen.set(w.behavior, String(sig));
    }
    const sigs = [...seen.values()];
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
