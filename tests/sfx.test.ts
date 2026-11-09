import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SampleBank } from '../src/audio/bank';
import { PATCHES } from '../src/audio/patches';
import { hallImpulse } from '../src/audio/space';

const index = JSON.parse(readFileSync(new URL('../public/sfx/sfx.json', import.meta.url), 'utf8')) as {
  sampleRate: number;
  targetLoud: number;
  clips: Record<string, { s: number; n: number; loud: number; peak: number; loop?: boolean }>;
};

/** Minimal BaseAudioContext stand-in: just enough for buffers. */
function fakeCtx(sampleRate = 48000) {
  return {
    sampleRate,
    createBuffer(channels: number, length: number, sr: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        sampleRate: sr,
        length,
        duration: length / sr,
        numberOfChannels: channels,
        getChannelData: (c: number) => data[c]!,
      };
    },
  } as unknown as BaseAudioContext;
}

describe('sfx sprite', () => {
  it('every patch layer references a clip or round-robin group in the sprite', () => {
    const names = new Set(Object.keys(index.clips));
    const groups = new Set([...names].map((n) => n.replace(/\d+$/, '')));
    const missing: string[] = [];
    for (const [id, patch] of Object.entries(PATCHES)) {
      for (const layer of patch.layers)
        if (layer.s && !names.has(layer.s) && !groups.has(layer.s)) missing.push(`${id}:${layer.s}`);
    }
    expect(missing).toEqual([]);
  });

  it('engine loops and ambience beds exist and are marked as loops', () => {
    for (const n of [
      'beam_loop',
      'rumble_loop',
      'engine_loop',
      'thrust_loop',
      'amb_hum',
      'amb_air',
      'amb_void',
    ]) {
      expect(index.clips[n]?.loop, n).toBe(true);
    }
  });

  it('clips are gain-staged to one loudness and never clip', () => {
    for (const [n, m] of Object.entries(index.clips)) {
      expect(m.peak, n).toBeLessThanOrEqual(-0.9);
      expect(Math.abs(m.loud - index.targetLoud), n).toBeLessThan(6);
    }
  });

  it('clips do not overlap inside the sprite', () => {
    const spans = Object.values(index.clips).sort((a, b) => a.s - b.s);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]!.s).toBeGreaterThanOrEqual(spans[i - 1]!.s + spans[i - 1]!.n);
  });
});

describe('sample bank', () => {
  const sprite = (len: number) => {
    const ctx = fakeCtx();
    const buf = ctx.createBuffer(1, len, 48000);
    buf.getChannelData(0).fill(0.5);
    return { ctx, buf };
  };

  it('slices sample-exactly and fades one-shot edges to silence', () => {
    const { ctx, buf } = sprite(10000);
    const bank = new SampleBank();
    bank.slice(ctx, buf, {
      sampleRate: 48000,
      targetLoud: -18,
      clips: {
        a0: { s: 1000, n: 2000, loud: -18, peak: -3 },
        bed: { s: 4000, n: 3000, loud: -18, peak: -3, loop: true },
      },
    });
    const a = bank.pick('a')!.buf;
    expect(a.length).toBe(2000);
    expect(a.getChannelData(0)[0]).toBe(0);
    expect(a.getChannelData(0)[1999]).toBe(0);
    expect(a.getChannelData(0)[1000]).toBeCloseTo(0.5);
    // loops keep their edges untouched so the seam stays continuous
    const bed = bank.pick('bed')!.buf;
    expect(bed.getChannelData(0)[0]).toBeCloseTo(0.5);
  });

  it('maps offsets when the context decodes at a different rate', () => {
    const ctx = fakeCtx(44100);
    const buf = ctx.createBuffer(1, 44100, 44100);
    const bank = new SampleBank();
    bank.slice(ctx, buf, {
      sampleRate: 48000,
      targetLoud: -18,
      clips: { x: { s: 4800, n: 4800, loud: -18, peak: -3 } },
    });
    expect(bank.pick('x')!.buf.length).toBe(4410);
  });

  it('round-robin never plays the same take twice in a row', () => {
    const { ctx, buf } = sprite(20000);
    const clips: Record<string, { s: number; n: number; loud: number; peak: number }> = {};
    for (let i = 0; i < 4; i++) clips[`hit${i}`] = { s: i * 4000, n: 3000, loud: -18, peak: -3 };
    const bank = new SampleBank();
    bank.slice(ctx, buf, { sampleRate: 48000, targetLoud: -18, clips });
    let last: AudioBuffer | null = null;
    const seen = new Set<AudioBuffer>();
    for (let i = 0; i < 400; i++) {
      const b = bank.pick('hit')!.buf;
      expect(b).not.toBe(last);
      seen.add(b);
      last = b;
    }
    expect(seen.size).toBe(4);
  });
});

describe('hall reverb', () => {
  it('builds a finite, decorrelated stereo impulse that ends in silence', () => {
    const ir = hallImpulse(fakeCtx(), 1.2, 1);
    const l = ir.getChannelData(0);
    const r = ir.getChannelData(1);
    expect(l.every(Number.isFinite)).toBe(true);
    expect(Math.abs(l[l.length - 1]!)).toBeLessThan(1e-6);
    let dot = 0;
    let el = 0;
    let er = 0;
    for (let i = 0; i < l.length; i++) {
      dot += l[i]! * r[i]!;
      el += l[i]! ** 2;
      er += r[i]! ** 2;
    }
    expect(Math.abs(dot / Math.sqrt(el * er))).toBeLessThan(0.3);
  });
});
