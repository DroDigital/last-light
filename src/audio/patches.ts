/**
 * The SFX mix table. Each game sound is a patch of layers: round-robin sample
 * groups from the sprite (see scripts/sfx/build.py, all normalised to the same
 * perceptual loudness) and small synthesized sweeteners for sub weight or
 * musical pitch. Levels here are the only mix decisions in the game.
 *
 * Ear-fatigue rules this table follows:
 *  - rapid sounds (weapons, hits, drones) are short, dry, and sit 9-17 dB down;
 *    only rare moments get long tails, reverb and width
 *  - every layer jitters pitch slightly and walks a shuffled bag of takes
 *  - warnings (`duck`) briefly pull the weapon and impact buses down instead of
 *    being turned up, so important cues read without raising the overall level
 *  - nothing bright is layered on top of something already bright
 */

import type { SfxId } from './audio';

export type BusId = 'weapon' | 'impact' | 'enemy' | 'world' | 'player' | 'ui';

export interface SynthKit {
  osc(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, dest: AudioNode, gain: number, attack?: number): void;
  noise(t0: number, dur: number, dest: AudioNode, gain: number, type: BiquadFilterType, f0: number, f1: number, q?: number): void;
  bell(t: number, f: number, dest: AudioNode, gain: number, dur: number): void;
}

/** A procedural layer: `p` is the jittered caller pitch, `pitch` the raw caller value. */
export type Synth = (k: SynthKit, t: number, p: number, dest: AudioNode, pitch: number) => void;

export interface Layer {
  /** sample group (or exact clip) in the sprite */
  s?: string;
  /** procedural layer instead of a sample */
  synth?: Synth;
  /** level in dB relative to the normalised sample (0 = full) */
  db?: number;
  /** random playback-rate range */
  rate?: [number, number];
  /** how strongly the caller's pitch moves this layer (default 1) */
  track?: number;
  /** pickup combo: caller pitch is a pentatonic step */
  scale?: boolean;
  delay?: number;
  /** hard cut length in seconds (with a short fade) */
  dur?: number;
  /** ramp playback rate to `rate * rateTo` over `ramp` seconds (spool-ups) */
  rateTo?: number;
  ramp?: number;
  lp?: number;
  hp?: number;
  /** probability the layer joins this hit (variety) */
  chance?: number;
}

export interface Patch {
  bus: BusId;
  layers: Layer[];
  /** patch master in dB */
  db?: number;
  /** concurrent voices of this sound before the oldest is stolen */
  voices?: number;
  /** minimum seconds between triggers at the same position (flam guard) */
  gap?: number;
  /** hall send 0..1 */
  rev?: number;
  /** stereo widener send 0..1 */
  wide?: number;
  /** duck weapon + impact buses by this many dB for a moment */
  duck?: number;
  /** 0 = expendable .. 3 = must play */
  prio?: number;
  /** random sweep of the stereo position across the sound (whooshes) */
  sweep?: number;
}

const scaleStep = (pitch: number) => {
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  return scale[Math.max(0, Math.min(scale.length - 1, Math.floor(pitch)))]!;
};
export const scaleRate = (pitch: number) => Math.pow(2, scaleStep(pitch) / 12);

// ------------------------------------------------------------------ synth sweeteners
const thud =
  (f0: number, f1: number, dur: number, g: number): Synth =>
  (k, t, p, d) =>
    k.osc('sine', f0 * p, f1, t, dur, d, g, 0.003);
const bells =
  (notes: number[], step: number, g: number, dur: number): Synth =>
  (k, t, p, d) =>
    notes.forEach((f, i) => k.bell(t + i * step, f * p, d, g, dur));

/** Every sound id has a patch ('beam' is the sustained loop in AudioEngine.beamHold). */
export const PATCHES: Record<Exclude<SfxId, 'beam'>, Patch> = {
  // ---------------------------------------------------------------- player weapons
  kinetic: {
    bus: 'weapon', voices: 5, gap: 0.02, rev: 0.03, prio: 0,
    layers: [
      { s: 'kin_b', db: -9, rate: [0.94, 1.06], lp: 5500 },
      { s: 'tick_m', db: -19, rate: [0.55, 0.65], chance: 0.6 },
      { synth: thud(100, 46, 0.075, 0.26) },
    ],
  },
  scatter: {
    bus: 'weapon', db: 2, voices: 3, rev: 0.08, prio: 1,
    layers: [
      { s: 'scat', db: -5, rate: [0.94, 1.05] },
      { s: 'plate_h', db: -12, rate: [0.9, 1.1], chance: 0.7 },
      { synth: thud(110, 34, 0.18, 0.4) },
    ],
  },
  heavy: {
    bus: 'weapon', voices: 3, rev: 0.08, prio: 1,
    layers: [
      { s: 'hv', db: -7, rate: [0.92, 1.04] },
      { s: 'plate_h', db: -12, rate: [0.85, 1] },
      { synth: thud(78, 30, 0.22, 0.42) },
    ],
  },
  rail: {
    bus: 'weapon', voices: 2, rev: 0.22, wide: 0.35, prio: 2,
    layers: [
      { s: 'rail_c', db: -4, rate: [0.96, 1.04] },
      { s: 'sub1', db: -7, rate: [0.95, 1.05], dur: 0.6 },
      { s: 'ffield', db: -13, rate: [1.3, 1.45], delay: 0.02 },
      { synth: thud(62, 30, 0.4, 0.45) },
    ],
  },
  energy: {
    bus: 'weapon', voices: 4, gap: 0.02, rev: 0.04, wide: 0.1, prio: 0,
    layers: [{ s: 'en', db: -10, rate: [0.95, 1.05] }],
  },
  arc: {
    bus: 'weapon', voices: 3, rev: 0.06, wide: 0.2, prio: 1,
    layers: [
      { s: 'arc', db: -9, rate: [0.93, 1.08] },
      { s: 'glitch', db: -11, rate: [0.9, 1.2], delay: 0.02 },
      { s: 'glitch', db: -13, rate: [0.8, 1.3], delay: 0.07, chance: 0.6 },
    ],
  },
  missile: {
    bus: 'weapon', db: -3, voices: 4, rev: 0.06, wide: 0.2, prio: 1,
    layers: [
      { s: 'mis', db: -9, rate: [0.9, 1.1] },
      { s: 'tick_m', db: -17, rate: [0.6, 0.72] },
    ],
  },
  mine: {
    bus: 'weapon', voices: 3, gap: 0.04, prio: 0,
    layers: [{ s: 'mine', db: -12, rate: [0.72, 0.78] }],
  },
  exotic: {
    bus: 'weapon', db: 3, voices: 3, rev: 0.2, wide: 0.4, prio: 1,
    layers: [
      { s: 'exo', db: -8, rate: [0.94, 1.06] },
      { s: 'ffield', db: -15, rate: [0.5, 0.58] },
    ],
  },
  drone: {
    bus: 'weapon', voices: 3, gap: 0.03, prio: 0,
    layers: [{ s: 'drone', db: -17, rate: [1, 1.15] }],
  },
  light: {
    bus: 'weapon', voices: 3, rev: 0.2, wide: 0.5, prio: 1,
    layers: [
      { s: 'glass', db: -13, rate: [0.97, 1.03] },
      { synth: bells([880, 1320], 0, 0.1, 0.45) },
    ],
  },

  // ---------------------------------------------------------------- impacts
  hit: {
    bus: 'impact', voices: 6, gap: 0.015, rev: 0.02, prio: 0,
    layers: [
      { s: 'hit', db: -12, rate: [0.9, 1.1] },
      { s: 'tick_m', db: -21, rate: [0.6, 0.7], chance: 0.4 },
    ],
  },
  crit: {
    bus: 'impact', voices: 3, gap: 0.03, rev: 0.1, wide: 0.2, prio: 1,
    layers: [
      { s: 'crit', db: -10, rate: [0.95, 1.05], track: 0.3 },
      { s: 'hit', db: -13, rate: [0.85, 0.95], track: 0 },
    ],
  },
  block: {
    bus: 'impact', voices: 3, gap: 0.04, rev: 0.15, wide: 0.3, prio: 1,
    layers: [{ s: 'bell', db: -14, rate: [0.97, 1.03], dur: 0.35, track: 0.6 }],
  },
  parry: {
    bus: 'player', voices: 2, rev: 0.35, wide: 0.5, duck: 3, prio: 3,
    layers: [
      { s: 'bell', db: -6, rate: [1.18, 1.22], track: 0 },
      { s: 'crit', db: -8, rate: [1, 1.05], track: 0 },
      { s: 'glass_h', db: -15, rate: [1.1, 1.2], track: 0 },
      { s: 'ffield', db: -12, rate: [1.55, 1.65], track: 0, delay: 0.01 },
      { synth: bells([1318, 1760], 0.035, 0.07, 0.9), track: 0 },
    ],
  },
  guard: {
    bus: 'player', voices: 2, gap: 0.08, rev: 0.1, wide: 0.2, prio: 1,
    layers: [
      { s: 'bell', db: -16, rate: [1.45, 1.55], dur: 0.25, track: 0 },
      { s: 'whs', db: -17, rate: [1.2, 1.3], track: 0 },
    ],
  },
  shieldRam: {
    bus: 'impact', voices: 2, gap: 0.06, rev: 0.1, prio: 1,
    layers: [
      { s: 'punch', db: -8, rate: [0.9, 1] },
      { s: 'bell', db: -16, rate: [0.78, 0.82], dur: 0.3, track: 0 },
    ],
  },
  shieldReflect: {
    bus: 'impact', voices: 3, gap: 0.04, rev: 0.15, wide: 0.3, prio: 1,
    layers: [
      { s: 'bell', db: -15, rate: [1.36, 1.44], dur: 0.25, track: 0 },
      { s: 'ping', db: -17, rate: [0.6, 0.66] },
    ],
  },
  kill: {
    bus: 'world', db: 1, voices: 5, gap: 0.025, rev: 0.08, wide: 0.15, prio: 1,
    layers: [
      { s: 'boom_s', db: -6, rate: [0.92, 1.06], track: 0.5 },
      { s: 'punch', db: -14, rate: [0.8, 1], chance: 0.6, track: 0.3 },
      { synth: thud(150, 40, 0.2, 0.32), track: 0.3 },
    ],
  },
  killBig: {
    bus: 'world', db: 3, voices: 3, rev: 0.3, wide: 0.3, prio: 2,
    layers: [
      { s: 'boom_l', db: -3, rate: [0.92, 1.04], track: 0.4 },
      { s: 'sub', db: -6, rate: [0.95, 1.05], track: 0.2 },
      { s: 'plate_h', db: -13, rate: [0.7, 0.85], track: 0 },
    ],
  },
  explosion: {
    bus: 'world', db: 4, voices: 4, gap: 0.03, rev: 0.25, wide: 0.25, prio: 1,
    layers: [
      { s: 'boom_l', db: -4, rate: [0.92, 1.05], track: 0.6 },
      { s: 'sub', db: -8, rate: [0.95, 1.05], track: 0.3, chance: 0.8 },
    ],
  },

  // ---------------------------------------------------------------- player state
  pickup: {
    bus: 'player', voices: 5, gap: 0.02, rev: 0.12, wide: 0.5, prio: 0,
    layers: [
      // glass pluck retuned so its fundamental lands on the bell's note
      { s: 'tink', db: -20, rate: [0.34, 0.35], scale: true, lp: 6000 },
      { synth: (k, t, _p, d, pitch) => k.bell(t, 660 * scaleRate(pitch), d, 0.085, 0.3) },
    ],
  },
  graze: {
    bus: 'player', voices: 3, gap: 0.04, rev: 0.05, wide: 0.2, sweep: 0.3, prio: 0,
    layers: [
      { s: 'whs', db: -12, rate: [1.3, 1.5] },
      { synth: (k, t, p, d) => k.osc('sine', 2400 * p, 3600 * p, t, 0.08, d, 0.03) },
    ],
  },
  hurt: {
    bus: 'player', voices: 2, gap: 0.05, rev: 0.12, duck: 5, prio: 3,
    layers: [
      { s: 'punch', db: -3, rate: [0.9, 1] },
      { s: 'hull', db: -7, rate: [0.92, 1.05] },
      { s: 'sub1', db: -14, rate: [1.1, 1.2], dur: 0.4 },
    ],
  },
  shieldBreak: {
    bus: 'player', voices: 1, rev: 0.3, wide: 0.5, duck: 5, prio: 3,
    layers: [
      { s: 'glass_h', db: -4, rate: [0.9, 1] },
      { s: 'shield_dn', db: -6 },
      { s: 'ffield', db: -9, rate: [0.68, 0.72] },
      { synth: (k, t, _p, d) => k.osc('sawtooth', 1600, 200, t, 0.4, d, 0.035) },
    ],
  },
  dodge: {
    bus: 'player', voices: 2, gap: 0.08, rev: 0.06, wide: 0.3, sweep: 0.6, prio: 2,
    layers: [
      { s: 'swsh', db: -7, rate: [0.95, 1.08] },
      { s: 'whm', db: -15, rate: [0.8, 0.9], chance: 0.5 },
    ],
  },
  flareOn: {
    bus: 'player', db: 2, voices: 1, rev: 0.5, wide: 0.7, duck: 3, prio: 3,
    layers: [
      { s: 'pwr_m0', db: -6 },
      { s: 'ffield', db: -8, rate: [0.78, 0.82] },
      { s: 'sub0', db: -11 },
      { synth: bells([523, 659, 784, 1046], 0.05, 0.08, 1.8) },
      { synth: (k, t, _p, d) => k.noise(t, 1.1, d, 0.06, 'bandpass', 1200, 7000, 0.7) },
    ],
  },
  flareOff: {
    bus: 'player', voices: 1, rev: 0.25, wide: 0.4, prio: 1,
    layers: [
      { s: 'ph_dn', db: -10, rate: [0.78, 0.82] },
      { s: 'ffield', db: -17, rate: [0.58, 0.62] },
    ],
  },
  lumenFull: {
    bus: 'player', voices: 1, gap: 0.3, rev: 0.3, wide: 0.6, prio: 2,
    layers: [
      { synth: bells([784, 988, 1175], 0.07, 0.09, 0.8) },
      { s: 'glass', db: -15, rate: [1.18, 1.22] },
    ],
  },
  streak: {
    bus: 'player', voices: 1, gap: 0.3, rev: 0.3, wide: 0.5, prio: 2,
    layers: [
      { s: 'pwr', db: -11, rate: [0.98, 1.02] },
      { synth: bells([784, 988, 1175], 0.06, 0.07, 0.7) },
    ],
  },
  boost: {
    bus: 'player', voices: 1, gap: 0.15, rev: 0.05, wide: 0.2, prio: 1,
    layers: [
      { s: 'whm', db: -9, rate: [0.6, 0.7] },
      { s: 'sub1', db: -16, rate: [1.2, 1.3], dur: 0.35 },
    ],
  },
  heartbeat: {
    bus: 'player', voices: 1, prio: 2,
    layers: [
      { s: 'thump', db: -4, rate: [0.95, 1] },
      { s: 'thump', db: -10, rate: [0.9, 0.95], delay: 0.22 },
    ],
  },
  laststand: {
    bus: 'player', db: 3, voices: 1, rev: 0.6, wide: 0.6, duck: 4, prio: 3,
    layers: [
      { s: 'bell', db: -4, rate: [0.58, 0.62], track: 0 },
      { s: 'sub1', db: -6 },
      { s: 'ffield', db: -9, rate: [0.48, 0.52] },
    ],
  },

  // ---------------------------------------------------------------- enemies & threats
  enemyShot: {
    bus: 'enemy', db: -2, voices: 4, gap: 0.03, rev: 0.05, prio: 1,
    layers: [{ s: 'eshot', db: -11, rate: [0.9, 1.1] }],
  },
  enemyBig: {
    bus: 'enemy', voices: 2, gap: 0.06, rev: 0.15, wide: 0.2, prio: 2,
    layers: [
      { s: 'ebig', db: -7, rate: [0.95, 1.05] },
      { s: 'sub1', db: -16, rate: [1.3, 1.4], dur: 0.3 },
    ],
  },
  telegraph: {
    bus: 'enemy', voices: 2, gap: 0.1, rev: 0.1, duck: 3, prio: 3,
    layers: [{ s: 'tele', db: -9, rate: [0.99, 1.01] }],
  },
  spawn: {
    bus: 'enemy', voices: 3, gap: 0.05, rev: 0.25, wide: 0.3, prio: 0,
    layers: [
      { s: 'ph_up', db: -14, rate: [0.9, 1.1] },
      { s: 'glitch', db: -19, rate: [0.8, 1.1], delay: 0.05 },
    ],
  },
  status: {
    bus: 'impact', voices: 3, gap: 0.06, prio: 0,
    layers: [{ s: 'glitch', db: -16, rate: [0.85, 1.2] }],
  },
  reaction: {
    bus: 'impact', voices: 3, gap: 0.05, rev: 0.15, wide: 0.3, prio: 1,
    layers: [
      { s: 'zapt', db: -8, rate: [0.95, 1.1] },
      { s: 'glass_h', db: -15, rate: [1, 1.2] },
    ],
  },
  shockwave: {
    bus: 'world', db: 3, voices: 2, gap: 0.1, rev: 0.45, wide: 0.5, duck: 2, prio: 2,
    layers: [
      { s: 'sub1', db: -4 },
      { s: 'ffield', db: -7, rate: [0.58, 0.64] },
      { s: 'whm', db: -10, rate: [0.48, 0.55] },
    ],
  },
  stasis: {
    bus: 'world', db: 4, voices: 1, rev: 0.5, wide: 0.8, prio: 2,
    layers: [
      { s: 'ffield', db: -7, rate: [0.43, 0.47] },
      { s: 'ph_dn', db: -10, rate: [0.48, 0.52] },
      { synth: (k, t, _p, d) => (k.osc('sine', 1200, 300, t, 1, d, 0.05, 0.05), k.osc('sine', 1207, 302, t, 1, d, 0.05, 0.05)) },
    ],
  },
  boss: {
    bus: 'world', db: 3, voices: 1, rev: 0.5, wide: 0.5, duck: 6, prio: 3,
    layers: [
      { s: 'dread', db: -3 },
      { s: 'creep', db: -8 },
      { s: 'sub0', db: -6, delay: 0.05 },
      { synth: (k, t, _p, d) => (k.osc('triangle', 55, 40, t, 2.5, d, 0.09, 0.4), k.osc('triangle', 82, 60, t, 2.5, d, 0.06, 0.4)) },
    ],
  },
  bossPhase: {
    bus: 'world', voices: 1, rev: 0.45, wide: 0.4, duck: 5, prio: 3,
    layers: [
      { s: 'dread', db: -5 },
      { s: 'boom_l', db: -6, rate: [0.8, 0.88] },
      { s: 'sub', db: -6 },
    ],
  },
  bossDeath: {
    bus: 'world', db: 3, voices: 1, rev: 0.7, wide: 0.5, duck: 6, prio: 3,
    layers: [
      { s: 'sub0', db: -1 },
      { s: 'boom_l', db: -3, rate: [0.9, 0.95] },
      { s: 'boom_l', db: -6, rate: [0.78, 0.82], delay: 0.35 },
      { s: 'boom_l', db: -8, rate: [0.68, 0.72], delay: 0.8 },
      { s: 'dread', db: -8, delay: 0.1 },
      { s: 'sub1', db: -8, delay: 1.2 },
    ],
  },
  relight: {
    bus: 'world', db: 2, voices: 1, gap: 0.5, rev: 0.7, wide: 0.8, prio: 3,
    layers: [
      { s: 'chime_up', db: -8, track: 0.3 },
      { s: 'pwr_m1', db: -15, track: 0.3 },
      { synth: bells([261, 329, 392, 523, 659, 784], 0.12, 0.09, 3) },
      { synth: (k, t, _p, d) => k.osc('sine', 130, 130, t, 4, d, 0.06, 1) },
    ],
  },
  death: {
    bus: 'world', db: 3, voices: 1, rev: 0.7, wide: 0.5, duck: 6, prio: 3,
    layers: [
      { s: 'sub0', db: -4 },
      { s: 'dread', db: -6 },
      { s: 'chime_dn', db: -10, delay: 0.4 },
      { synth: (k, t, _p, d) => k.osc('sine', 440, 55, t, 2.5, d, 0.12, 0.01) },
    ],
  },
  evolve: {
    bus: 'player', db: 2, voices: 1, rev: 0.5, wide: 0.7, prio: 3,
    layers: [
      { s: 'pwr_m0', db: -6 },
      { s: 'pwr', db: -11, delay: 0.05 },
      { synth: bells([392, 494, 587, 784, 988], 0.06, 0.08, 1.5) },
    ],
  },

  // ---------------------------------------------------------------- warp
  warpCharge: {
    bus: 'world', voices: 1, rev: 0.4, wide: 0.6, prio: 3,
    layers: [
      { s: 'spool', db: -6, rate: [0.55, 0.55], rateTo: 3.2, ramp: 2.3, track: 0, lp: 5000 },
      { s: 'ffield', db: -14, rate: [0.5, 0.52], delay: 1.6 },
      { synth: (k, t, _p, d) => (k.osc('sawtooth', 60, 900, t, 2.2, d, 0.05, 1.5), k.osc('sine', 120, 1800, t, 2.2, d, 0.06, 1.5)) },
    ],
  },
  warpGo: {
    bus: 'world', db: 3, voices: 1, rev: 0.6, wide: 0.6, duck: 4, prio: 3,
    layers: [
      { s: 'sub0', db: -2 },
      { s: 'boom_l', db: -9, rate: [0.7, 0.75], lp: 2500 },
      { s: 'whm', db: -8, rate: [0.58, 0.62] },
      { s: 'swsh', db: -10, rate: [0.48, 0.52] },
    ],
  },
  warpArrive: {
    bus: 'world', voices: 1, rev: 0.55, wide: 0.7, prio: 3,
    layers: [
      { s: 'ffield', db: -8, rate: [0.53, 0.57] },
      { s: 'sub1', db: -8 },
      { s: 'chime_up', db: -15, rate: [0.9, 0.9] },
      { synth: bells([392, 523, 659], 0.08, 0.07, 2) },
    ],
  },

  // ---------------------------------------------------------------- interface
  uiMove: {
    bus: 'ui', voices: 2, gap: 0.03, prio: 1,
    layers: [{ s: 'ui_tap', db: -13, rate: [0.97, 1.03] }],
  },
  uiSelect: {
    bus: 'ui', voices: 2, gap: 0.04, prio: 2,
    layers: [
      { s: 'ui_click', db: -10, rate: [0.97, 1.03] },
      { s: 'ui_conf', db: -12, rate: [0.99, 1.01] },
    ],
  },
  uiBack: {
    bus: 'ui', db: -2, voices: 2, gap: 0.04, prio: 2,
    layers: [{ s: 'ui_back', db: -10, rate: [0.98, 1.02] }],
  },
  uiBuy: {
    bus: 'ui', voices: 2, gap: 0.05, prio: 2,
    layers: [
      { s: 'ui_buy', db: -9, rate: [0.99, 1.01] },
      { s: 'ping', db: -19, rate: [0.6, 0.64] },
    ],
  },
  uiDeny: {
    bus: 'ui', voices: 1, gap: 0.08, prio: 2,
    layers: [{ s: 'ui_err', db: -9, rate: [0.98, 1.02] }],
  },
  cardIn: {
    bus: 'ui', voices: 3, gap: 0.02, sweep: 0.25, prio: 1,
    layers: [
      { s: 'whs', db: -12, rate: [1.1, 1.3] },
      { s: 'ui_tap', db: -19, rate: [0.95, 1.05] },
    ],
  },
  dropSpawn: {
    bus: 'player', voices: 2, gap: 0.05, rev: 0.2, wide: 0.4, prio: 1,
    layers: [
      { s: 'ping', db: -16, rate: [0.58, 0.62], track: 0.5 },
      { s: 'ph_up', db: -18, rate: [1.5, 1.7] },
    ],
  },
  dropPick: {
    bus: 'player', voices: 2, gap: 0.05, rev: 0.15, wide: 0.4, prio: 2,
    layers: [
      { s: 'ui_buy', db: -10, rate: [0.99, 1.01] },
      { s: 'glass', db: -15, rate: [0.98, 1.02] },
      { synth: bells([1046, 1318], 0.04, 0.05, 0.5) },
    ],
  },
};

/** Sounds that existed before the sample patches: fallback synthesis for new ids. */
export const SYNTH_FALLBACK: Partial<Record<SfxId, SfxId>> = {
  parry: 'crit', guard: 'block', shieldRam: 'block', shieldReflect: 'block', streak: 'lumenFull',
  laststand: 'shockwave', dropSpawn: 'cardIn', dropPick: 'uiBuy', boost: 'dodge',
};
