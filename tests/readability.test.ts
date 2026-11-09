import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * style.css states the readability rule: body text is never below 12px. These checks keep that rule
 * true as the stylesheets grow. A size written as calc(Npx * var(--ui-scale)) is also checked, because
 * the UI-scale slider goes down to 0.75 and would drop it below the floor.
 */
const SHEETS = ['src/ui/style.css', 'src/ui/hud-polish.css', 'src/ui/classes.css'];

function belowFloor(css: string): string[] {
  const bad: string[] = [];
  // font-size declarations and font shorthands
  for (const m of css.matchAll(/font(?:-size)?\s*:\s*([^;{}]+)/g)) {
    const value = m[1]!;
    // tokens, clamp() ranges and max(12px, ...) floors are already safe
    if (/clamp\(|max\(12px|var\(--s\d\)/.test(value)) continue;
    const px = value.match(/(\d+(?:\.\d+)?)px/);
    if (px && Number(px[1]) < 12) bad.push(m[0].trim());
  }
  // scaled sizes must be floored, or the UI-scale slider can shrink them below 12px
  for (const m of css.matchAll(/(?<!max\(12px, )calc\((\d+(?:\.\d+)?)px \* var\(--ui-scale\)\)/g)) bad.push(m[0]);
  return bad;
}

describe('readability floor', () => {
  for (const file of SHEETS) {
    it(`${file}: no text is set below 12px, at any UI scale`, () => {
      expect(belowFloor(readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('the detector flags a small or unfloored size', () => {
    expect(belowFloor('.x { font: 9px var(--mono); }')).toHaveLength(1);
    expect(belowFloor('.x { font-size: calc(12px * var(--ui-scale)); }')).toHaveLength(1);
    expect(belowFloor('.x { font-size: max(12px, calc(12px * var(--ui-scale))); }')).toEqual([]);
    expect(belowFloor('.x { font: 700 12px var(--mono); font-size: var(--s1); }')).toEqual([]);
  });
});
