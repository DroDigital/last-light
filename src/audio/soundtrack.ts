/**
 * Recorded soundtrack (digitaldro, see docs/CREDITS.md).
 *
 * Each track streams from an <audio> element through its own gain into the
 * engine's music bus, so the volume slider, low-HP/flare filter and explosion
 * ducking all still apply. Cues crossfade; a track that is faded out keeps its
 * position, so short fights do not restart the exploration song every time.
 */
import type { AudioEngine } from './audio';

export type Cue = 'menu' | 'explore' | 'combat' | 'boss' | 'finale';

interface TrackDef {
  file: string;
  title: string;
}

export const TRACKS: Record<Cue, TrackDef[]> = {
  menu: [{ file: 'menu-last-analog-dawn.mp3', title: 'Last Analog Dawn' }],
  explore: [
    { file: 'explore-proximity-to-earth.mp3', title: 'Proximity to Earth' },
    { file: 'explore-proximity-to-earth-2.mp3', title: 'Proximity to Earth (II)' },
  ],
  combat: [
    { file: 'combat-warp-drive.mp3', title: 'Warp Drive' },
    { file: 'combat-void-engagements.mp3', title: 'Void Engagements' },
  ],
  boss: [{ file: 'boss-void-leviathan.mp3', title: 'Void Leviathan' }],
  finale: [{ file: 'finale-last-transmission.mp3', title: 'Last Transmission' }],
};

/** Recorded masters sit at about -15.5 LUFS; this trim seats them under the SFX. */
const TRIM = 0.62;

class Track {
  el: HTMLAudioElement;
  gain: GainNode;
  failed = false;
  constructor(
    ctx: AudioContext,
    bus: AudioNode,
    readonly def: TrackDef,
    readonly cue: Cue,
    onEnded: (t: Track) => void,
    onError: (t: Track) => void,
  ) {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.src = `${import.meta.env.BASE_URL}music/${def.file}`;
    el.loop = TRACKS[cue].length === 1;
    el.addEventListener('ended', () => onEnded(this));
    el.addEventListener('error', () => {
      this.failed = true;
      onError(this);
    });
    this.el = el;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(this.gain).connect(bus);
  }
}

export class Soundtrack {
  /** true while a recorded cue is (or is about to be) audible */
  active = false;
  cue: Cue | null = null;
  /** beat-ish onsets from the low band, for visual pulse */
  onBeat: (() => void) | null = null;
  /** called when a cue cannot play (missing file) so the engine can fall back */
  onUnavailable: ((cue: Cue) => void) | null = null;
  private tracks = new Map<string, Track>();
  private index: Record<Cue, number> = { menu: 0, explore: 0, combat: 0, boss: 0, finale: 0 };
  private current: Track | null = null;
  private bus: GainNode;
  private analyser: AnalyserNode;
  private bins: Uint8Array<ArrayBuffer>;
  private energyAvg = 0;
  private lastBeat = 0;
  private pendingStart = 0;
  private pendingTimer: number | null = null;
  private playbackAttempt = 0;

  constructor(private a: AudioEngine) {
    const ctx = a.ctx!;
    this.bus = ctx.createGain();
    this.bus.gain.value = TRIM;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.5;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.bus.connect(a.musicBus);
    this.bus.connect(this.analyser);
  }

  private track(cue: Cue, i: number): Track {
    const def = TRACKS[cue][i % TRACKS[cue].length]!;
    let t = this.tracks.get(def.file);
    if (!t) {
      t = new Track(
        this.a.ctx!,
        this.bus,
        def,
        cue,
        (tr) => this.ended(tr),
        (tr) => {
          if (this.current !== tr) return;
          this.active = false;
          this.onUnavailable?.(tr.cue);
        },
      );
      this.tracks.set(def.file, t);
    }
    return t;
  }

  /** Warm the browser cache for a cue that is likely next. */
  prefetch(cue: Cue): void {
    if (!this.a.ctx) return;
    this.track(cue, this.index[cue]);
  }

  /**
   * Switch to a cue. `fade` is the crossfade in seconds; `delay` holds the new
   * cue back (the boss reveal plays into silence first).
   */
  play(cue: Cue, opts: { fade?: number; delay?: number; restart?: boolean } = {}): void {
    const ctx = this.a.ctx;
    if (!ctx) return;
    const fade = opts.fade ?? 2.5;
    if (this.cue === cue && this.current && !opts.restart && !this.current.failed) return;
    this.cue = cue;
    this.active = true;
    const next = this.track(cue, this.index[cue]);
    if (next.failed) {
      this.active = false;
      this.onUnavailable?.(cue);
      return;
    }
    const prev = this.current;
    const t = ctx.currentTime;
    if (prev && prev !== next) this.fadeOut(prev, opts.delay ? Math.min(fade, opts.delay) : fade);
    this.current = next;
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    const start = () => {
      this.pendingTimer = null;
      if (this.current !== next) return;
      const now = ctx.currentTime;
      if (opts.restart || next.el.ended) next.el.currentTime = 0;
      // resume where we left off unless the remainder is too short to matter
      if (next.el.duration && next.el.duration - next.el.currentTime < 12) next.el.currentTime = 0;
      this.startPlayback(next);
      const g = next.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + (opts.delay ? 0.05 : fade));
    };
    if (opts.delay) {
      this.pendingStart = t + opts.delay;
      this.pendingTimer = window.setTimeout(start, opts.delay * 1000);
    } else start();
  }

  private startPlayback(track: Track): void {
    const attempt = ++this.playbackAttempt;
    this.active = true;
    void track.el.play().catch(() => {
      // Ignore an older rejection if a later user gesture already retried.
      if (this.current === track && this.playbackAttempt === attempt) this.active = false;
    });
  }

  /** Retry playback during a later user gesture if autoplay blocked the cue. */
  retryPlayback(): void {
    if (this.current && !this.current.failed && this.current.el.paused && this.pendingTimer === null) {
      this.startPlayback(this.current);
    }
  }

  /** Fade everything out (death screen, procedural fallback). */
  stop(fade = 2): void {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    if (this.current) this.fadeOut(this.current, fade);
    this.current = null;
    this.cue = null;
    this.active = false;
  }

  /** Dip the soundtrack without switching cue (death, pause). */
  setLevel(v: number, time = 0.8): void {
    const ctx = this.a.ctx;
    if (!ctx) return;
    this.bus.gain.setTargetAtTime(TRIM * v, ctx.currentTime, time / 3);
  }

  get title(): string {
    return this.current?.def.title ?? '';
  }

  private fadeOut(tr: Track, fade: number): void {
    const ctx = this.a.ctx!;
    const now = ctx.currentTime;
    const g = tr.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    window.setTimeout(
      () => {
        if (this.current !== tr) tr.el.pause();
      },
      fade * 1000 + 60,
    );
  }

  private ended(tr: Track): void {
    if (this.current !== tr) return;
    // advance the cue's playlist; single-track cues loop natively
    const list = TRACKS[tr.cue];
    this.index[tr.cue] = (this.index[tr.cue] + 1) % list.length;
    tr.el.currentTime = 0;
    tr.gain.gain.value = 0;
    this.current = null;
    this.cue = null;
    this.play(tr.cue, { fade: 0.6 });
  }

  /** Per-frame: low-band onset detection for the beat pulse. */
  tick(): void {
    if (!this.active || !this.onBeat || !this.a.ctx) return;
    const now = this.a.ctx.currentTime;
    if (now < this.pendingStart) return;
    this.analyser.getByteFrequencyData(this.bins);
    // ~47-190 Hz at 48 kHz / 512
    const e = (this.bins[1]! + this.bins[2]! + this.bins[3]! + this.bins[4]!) / 1020;
    this.energyAvg += (e - this.energyAvg) * 0.05;
    if (e > 0.35 && e > this.energyAvg * 1.25 && now - this.lastBeat > 0.28) {
      this.lastBeat = now;
      this.onBeat();
    }
  }
}
