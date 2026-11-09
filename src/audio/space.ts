/**
 * Shared "space" processors for the SFX mix:
 *
 *  - a synthesized stereo hall (convolution) with sparse early reflections,
 *    a dense decorrelated tail and time-varying high damping, so tails darken
 *    as they decay the way a real large room does. Sends are tiny for rapid
 *    sounds and generous only for rare, big moments, so the mix never smears.
 *  - a modulated Haas/chorus widener: the dry sound stays centred while two
 *    slowly drifting delayed copies sit left and right, giving shimmer and
 *    width without phasey mono collapse. Bass is kept out of it.
 */

export function hallImpulse(ctx: BaseAudioContext, seconds = 2.6, rt60 = 2.2, predelay = 0.022): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const ir = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(predelay * sr);
  // deterministic noise so the room is identical every launch
  let seed = 0x2545f491;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    // early reflections: a handful of taps that differ per ear
    for (let i = 0; i < 9; i++) {
      const t = pre + Math.floor((0.006 + Math.abs(rnd()) * 0.075) * sr);
      if (t < len) d[t] = (d[t] ?? 0) + rnd() * 0.55 * Math.exp(-i * 0.22);
    }
    // late tail with damping that closes from ~9 kHz down to ~1.8 kHz
    let lp = 0;
    const decay = 6.91 / rt60;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const cutoff = 9000 * Math.exp(-t * 0.8) + 1800;
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
      lp += a * (rnd() - lp);
      // gentle fade-in of the tail density (the first 40 ms belong to the reflections)
      const build = Math.min(1, t / 0.04);
      d[i] = (d[i] ?? 0) + lp * Math.exp(-t * decay) * build * 0.9;
    }
    // end with silence so the convolver never clicks
    const fade = Math.floor(0.08 * sr);
    for (let i = 0; i < fade; i++) d[len - 1 - i]! *= i / fade;
  }
  // normalise energy so the send level means the same thing whatever the length
  let e = 0;
  for (let ch = 0; ch < 2; ch++) for (const v of ir.getChannelData(ch)) e += v * v;
  const k = 1 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i]! *= k * 0.5;
  }
  return ir;
}

export interface SpaceBus {
  input: GainNode;
  output: GainNode;
}

/** Hall send: input -> pre-EQ -> convolver -> return EQ -> output. */
export function makeHall(ctx: AudioContext): SpaceBus {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 260; // no low-end wash
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 7000;
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = hallImpulse(ctx);
  const dip = ctx.createBiquadFilter();
  dip.type = 'peaking';
  dip.frequency.value = 2800;
  dip.Q.value = 0.8;
  dip.gain.value = -3; // keep the tail out of the fatigue band
  const output = ctx.createGain();
  input.connect(hp).connect(lp).connect(conv).connect(dip).connect(output);
  return { input, output };
}

/** Stereo widener: two slow-drifting delays panned hard left/right, bass excluded. */
export function makeWidener(ctx: AudioContext): SpaceBus {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 320;
  input.connect(hp);
  const merger = ctx.createChannelMerger(2);
  const output = ctx.createGain();
  const taps: [number, number, number][] = [
    [0.0119, 0.21, 0],
    [0.0173, 0.27, 1],
  ];
  for (const [base, rate, ch] of taps) {
    const d = ctx.createDelay(0.05);
    d.delayTime.value = base;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.value = 0.0016;
    lfo.connect(depth).connect(d.delayTime);
    lfo.start();
    hp.connect(d).connect(merger, 0, ch);
  }
  merger.connect(output);
  return { input, output };
}
