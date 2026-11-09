/**
 * Sample bank: one Ogg Vorbis sprite (public/sfx/sfx.ogg) plus a JSON index,
 * both built by scripts/sfx/build.py from CC0 / CC BY sources (CREDITS.md).
 * The sprite is fetched and decoded once, then sliced into per-clip buffers.
 *
 * Clips named `name0`, `name1`, ... form a round-robin group `name`. Picking
 * from a group walks a shuffled bag and never repeats the previous take, so
 * rapid sounds keep changing timbre instead of machine-gunning one file.
 */

interface ClipMeta {
  /** start and length in samples at the index sample rate */
  s: number;
  n: number;
  loud: number;
  peak: number;
  loop?: boolean;
}

interface SpriteIndex {
  sampleRate: number;
  targetLoud: number;
  clips: Record<string, ClipMeta>;
}

class Bag {
  private order: number[] = [];
  private last = -1;
  constructor(readonly names: string[]) {}
  next(): string {
    const n = this.names.length;
    if (n === 1) return this.names[0]!;
    if (this.order.length === 0) {
      this.order = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!];
      }
      // a fresh bag must not open with the take that closed the old one
      if (this.order[n - 1] === this.last)
        [this.order[n - 1], this.order[0]] = [this.order[0]!, this.order[n - 1]!];
    }
    this.last = this.order.pop()!;
    return this.names[this.last]!;
  }
}

export class SampleBank {
  ready = false;
  failed = false;
  private buffers = new Map<string, AudioBuffer>();
  private comp = new Map<string, number>();
  private bags = new Map<string, Bag>();

  async load(ctx: BaseAudioContext, base: string): Promise<void> {
    try {
      const [idxRes, binRes] = await Promise.all([fetch(`${base}sfx/sfx.json`), fetch(`${base}sfx/sfx.ogg`)]);
      if (!idxRes.ok || !binRes.ok) throw new Error('sfx sprite missing');
      const index = (await idxRes.json()) as SpriteIndex;
      const sprite = await ctx.decodeAudioData(await binRes.arrayBuffer());
      this.slice(ctx, sprite, index);
      this.ready = true;
    } catch (err) {
      // the synthesized fallback keeps the game fully voiced
      this.failed = true;
      console.warn('[audio] sample sprite unavailable, using synthesized SFX', err);
    }
  }

  /** Slice the decoded sprite into clips (also used by tests with a fake context). */
  slice(ctx: BaseAudioContext, sprite: AudioBuffer, index: SpriteIndex): void {
    const sr = sprite.sampleRate;
    const k = sr / index.sampleRate; // decodeAudioData resamples to the context rate
    const src = sprite.getChannelData(0);
    for (const [name, m] of Object.entries(index.clips)) {
      const start = Math.round(m.s * k);
      const len = Math.max(1, Math.min(src.length - start, Math.round(m.n * k)));
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      d.set(src.subarray(start, start + len));
      if (!m.loop) {
        // lossy decoding can leave a few non-zero samples at a hard edge:
        // a 1 ms fade-in and 3 ms fade-out guarantee click-free starts/stops
        const fi = Math.min(len >> 2, Math.round(sr * 0.001));
        const fo = Math.min(len >> 2, Math.round(sr * 0.003));
        for (let i = 0; i < fi; i++) d[i]! *= i / fi;
        for (let i = 0; i < fo; i++) d[len - 1 - i]! *= i / fo;
      }
      this.buffers.set(name, buf);
      // loudness compensation onto the shared target (never more than +3 dB)
      this.comp.set(name, Math.min(1.41, Math.pow(10, (index.targetLoud - m.loud) / 20)));
    }
    const groups = new Map<string, string[]>();
    for (const name of this.buffers.keys()) {
      const g = name.replace(/\d+$/, '');
      if (g !== name) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(name);
      }
    }
    for (const [g, names] of groups) this.bags.set(g, new Bag(names));
  }

  has(group: string): boolean {
    return this.bags.has(group) || this.buffers.has(group);
  }

  /** Next take from a group (or the named clip itself). */
  pick(group: string): { buf: AudioBuffer; gain: number } | null {
    const name = this.buffers.has(group) ? group : this.bags.get(group)?.next();
    if (!name) return null;
    return { buf: this.buffers.get(name)!, gain: this.comp.get(name) ?? 1 };
  }
}
