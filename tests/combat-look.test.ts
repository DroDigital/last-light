import { describe, expect, it } from 'vitest';
import { engineTrailBrightness, engineTrailWidth, lanternGlow } from '../src/render/combat-look';

describe('combat visual hierarchy', () => {
  it('tapers engine trails to darkness and keeps boosting restrained', () => {
    expect(engineTrailBrightness(0, 1, true)).toBe(0);
    expect(engineTrailBrightness(0.5, 1, false)).toBeLessThan(engineTrailBrightness(1, 1, false));
    expect(engineTrailBrightness(1, 1, true)).toBeLessThan(3);
    expect(engineTrailWidth(0, 1)).toBeLessThan(engineTrailWidth(1, 1));
    expect(engineTrailWidth(1, 1)).toBeLessThan(0.3);
  });

  it('lets collected light enrich the hull while damage dims its glow', () => {
    expect(lanternGlow(300, 1)).toBeGreaterThan(lanternGlow(0, 1));
    expect(lanternGlow(300, 0.2)).toBeLessThan(lanternGlow(300, 1));
    expect(lanternGlow(10000, 1)).toBeLessThanOrEqual(0.4);
    expect(lanternGlow(0, 0)).toBeGreaterThanOrEqual(0);
  });
});
