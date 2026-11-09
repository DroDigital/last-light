/** Bounded visual values keep the Lantern and its exhaust below combat telegraphs. */
const unit = (value: number): number => Math.max(0, Math.min(1, value));

/** Brightest at the engines, with a smooth fade towards the old end of the trail. */
export function engineTrailBrightness(fraction: number, thrust: number, boosting: boolean): number {
  const f = unit(fraction);
  return f * f * 1.35 * (0.3 + unit(thrust)) * (boosting ? 1.55 : 1);
}

/** A narrow ribbon, tapered to a fine point. */
export function engineTrailWidth(fraction: number, scale: number): number {
  return (0.025 + 0.19 * unit(fraction)) * Math.max(0, scale);
}

/** Collected light slowly brightens the hull; critical damage subdues it. */
export function lanternGlow(light: number, hullFraction: number): number {
  return 0.34 * unit(light / 900) * (0.2 + 0.8 * unit(hullFraction));
}

export type ShipGlow = 'classic' | 'soft' | 'shine' | 'ember';

/**
 * Player ship light styles: the shader blend (SHIP_GLOW_CHUNK in shaders.ts) and
 * multipliers for the vector edges [halo, core], and how white the crisp edge
 * line is (lower = it takes the hull accent). Classic is the original look.
 */
export const SHIP_GLOW: Record<ShipGlow, { style: number; label: string; edges: [number, number]; white: number }> = {
  classic: { style: 0, label: 'Classic (bright)', edges: [1, 1], white: 0.62 },
  soft: { style: 1, label: 'Soft inlay', edges: [0.5, 0.5], white: 0.4 },
  shine: { style: 2, label: 'Shine-through', edges: [0.4, 0.38], white: 0.28 },
  ember: { style: 3, label: 'Ember (subtle)', edges: [0.1, 0.2], white: 0.15 },
};
