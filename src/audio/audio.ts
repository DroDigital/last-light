/**
 * Web Audio engine.
 *
 *   weapon -> tone LP -> duck --\
 *   impact ---------> duck ------+-> sfx (volume) -> de-harsh EQ -> glue comp --\
 *   enemy / world / player -----/      ^ hall return, widener return             +-> master -> limiter -> out
 *   ui, ambience, music -------------------------------------------------------/
 *
 * Sound effects are layered patches (src/audio/patches.ts) of round-robin
 * samples from one sprite (src/audio/bank.ts, built by scripts/sfx/build.py)
 * plus small synthesized sweeteners. Until the sprite has decoded, or if it
 * cannot be loaded, every sound falls back to pure synthesis.
 *
 * Anti-fatigue machinery: per-sound voice caps with oldest-voice stealing, a
 * flam guard, density-aware gain (swarms do not stack up loud), pitch/level
 * jitter, weapon habituation (sustained fire slowly settles back and darkens),
 * priority ducking for warnings, distance darkening, and a gentle de-harsh EQ
 * and glue compressor on the whole SFX bus.
 */
import { SampleBank } from './bank';
import { PATCHES, SYNTH_FALLBACK, scaleRate, type BusId, type SynthKit } from './patches';
import { makeHall, makeWidener, type SpaceBus } from './space';
import { Soundtrack } from './soundtrack';
export type SfxId =
  | 'kinetic' | 'heavy' | 'energy' | 'beam' | 'arc' | 'missile' | 'mine' | 'exotic' | 'drone' | 'light' | 'rail' | 'scatter'
  | 'hit' | 'crit' | 'block' | 'kill' | 'killBig' | 'explosion' | 'pickup' | 'graze' | 'hurt' | 'shieldBreak'
  | 'dodge' | 'flareOn' | 'flareOff' | 'lumenFull' | 'enemyShot' | 'enemyBig' | 'telegraph' | 'warpCharge' | 'warpGo'
  | 'warpArrive' | 'uiMove' | 'uiSelect' | 'uiBack' | 'uiBuy' | 'uiDeny' | 'cardIn' | 'shockwave' | 'stasis' | 'boss'
  | 'bossPhase' | 'bossDeath' | 'relight' | 'death' | 'heartbeat' | 'evolve' | 'reaction' | 'spawn' | 'status'
  | 'parry' | 'guard' | 'shieldRam' | 'shieldReflect' | 'streak' | 'laststand' | 'dropSpawn' | 'dropPick' | 'boost';

/** Ambience/mix scene, set by the game state. */
export type AudioScene = 'menu' | 'explore' | 'combat' | 'boss' | 'death';

interface LegacyVoice {
  t: number;
}

interface Voice {
  id: SfxId;
  start: number;
  end: number;
  prio: number;
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
}

interface Loop {
  src: AudioBufferSourceNode;
  filt: BiquadFilterNode;
  gain: GainNode;
}

const LIMITS: Partial<Record<SfxId, number>> = {
  kinetic: 4, energy: 4, hit: 6, kill: 6, pickup: 5, enemyShot: 4, graze: 3, explosion: 5, beam: 1, drone: 3, status: 3, spawn: 3,
};

/** Hard ceiling on concurrent one-shot voices across the whole mix. */
const MAX_VOICES = 56;

const BEDS: Record<AudioScene, { hum: number; air: number; void: number }> = {
  menu: { hum: 0.5, air: 0.32, void: 0 },
  explore: { hum: 0.55, air: 0.38, void: 0.1 },
  combat: { hum: 0.42, air: 0.3, void: 0.3 },
  boss: { hum: 0.34, air: 0.24, void: 0.55 },
  death: { hum: 0.18, air: 0.14, void: 0.45 },
};

const dbToGain = (db: number) => Math.pow(10, db / 20);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  uiBus!: GainNode;
  ambBus!: GainNode;
  musicFilter!: BiquadFilterNode;
  musicDuck!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private legacyVoices = new Map<SfxId, LegacyVoice[]>();
  private mono = false;
  volumes = { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.7, ambience: 0.6 };
  music: Music | null = null;
  /** recorded soundtrack; when active the procedural score stays silent */
  soundtrack: Soundtrack | null = null;
  /** decoded sample sprite; until ready, SFX are synthesized */
  readonly bank = new SampleBank();
  private buses!: Record<BusId, AudioNode>;
  private duckW!: GainNode;
  private duckI!: GainNode;
  private weaponTone!: BiquadFilterNode;
  private weaponLevel!: GainNode;
  private hall!: SpaceBus;
  private wide!: SpaceBus;
  private kit!: SynthKit;
  private live: Voice[] = [];
  private recent = new Map<SfxId, { t: number; pan: number }[]>();
  private duckUntil = 0;
  private duckDepth = 0;
  private shotsThisFrame = 0;
  private fireRate = 0;
  private fatigue = 0;
  private lastTick = 0;
  private boostNode: { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode } | null = null;
  private beamNode: { srcs: AudioScheduledSourceNode[]; gain: GainNode; rate?: AudioParam } | null = null;
  private beamT = 0;
  private engine: { rumble: Loop; thrust: Loop; level: number } | null = null;
  private beds: { hum: Loop; air: Loop; void: Loop } | null = null;
  private synthAmb: GainNode | null = null;
  private scene: AudioScene = 'menu';
  /** visual cue hook for important sounds (accessibility) */
  onCue: ((id: SfxId, pan: number) => void) | null = null;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.connect(this.limiter).connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicDuck = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFilter).connect(this.musicDuck).connect(this.master);

    // ---- SFX: volume -> de-harsh EQ -> glue compressor -> master
    this.sfxBus = ctx.createGain();
    const deharsh = ctx.createBiquadFilter();
    deharsh.type = 'peaking';
    deharsh.frequency.value = 3300;
    deharsh.Q.value = 0.9;
    deharsh.gain.value = -1.5;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 10500;
    air.gain.value = -1.5;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.008;
    glue.release.value = 0.2;
    this.sfxBus.connect(deharsh).connect(air).connect(glue).connect(this.master);

    // sub-buses
    this.weaponTone = ctx.createBiquadFilter();
    this.weaponTone.type = 'lowpass';
    this.weaponTone.frequency.value = 18000;
    this.weaponTone.Q.value = 0.5;
    this.weaponLevel = ctx.createGain();
    this.duckW = ctx.createGain();
    this.weaponTone.connect(this.weaponLevel).connect(this.duckW).connect(this.sfxBus);
    this.duckI = ctx.createGain();
    this.duckI.connect(this.sfxBus);
    const sub = () => {
      const g = ctx.createGain();
      g.connect(this.sfxBus);
      return g;
    };
    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.master);
    this.buses = { weapon: this.weaponTone, impact: this.duckI, enemy: sub(), world: sub(), player: sub(), ui: this.uiBus };
    this.hall = makeHall(ctx);
    this.hall.output.gain.value = 0.9;
    this.hall.output.connect(this.sfxBus);
    this.wide = makeWidener(ctx);
    this.wide.output.gain.value = 1;
    this.wide.output.connect(this.sfxBus);

    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.kit = {
      osc: (...a) => this.osc(...a),
      noise: (...a) => this.noiseBurst(...a),
      bell: (...a) => this.bell(...a),
    };
    this.applyVolumes();
    this.music = new Music(this);
    this.soundtrack = new Soundtrack(this);
    this.startAmbience();
    void this.bank.load(ctx, import.meta.env.BASE_URL).then(() => {
      if (this.bank.ready) this.startBeds();
    });
  }

  setMono(m: boolean): void {
    this.mono = m;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const v = this.volumes;
    this.master.gain.value = v.master;
    this.musicBus.gain.value = v.music * 0.55;
    this.sfxBus.gain.value = v.sfx * 0.75;
    this.uiBus.gain.value = v.ui * 0.6;
    this.ambBus.gain.value = v.ambience * 0.4;
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Big explosions briefly duck the music. */
  duck(amount = 0.5, time = 0.35): void {
    if (!this.ctx) return;
    const g = this.musicDuck.gain;
    const t = this.now;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - amount, t + 0.02);
    g.linearRampToValueAtTime(1, t + time);
  }

  /** Music low-pass for low health / warp; flare opens it beyond normal. */
  setMusicFilter(freq: number): void {
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(freq, this.now, 0.08);
  }

  /** Ambience beds follow the game state (hum in the hangar, void dread in a boss fight). */
  setScene(scene: AudioScene): void {
    this.scene = scene;
    if (!this.ctx || !this.beds) return;
    const b = BEDS[scene];
    const t = this.now;
    this.beds.hum.gain.gain.setTargetAtTime(b.hum, t, 1.2);
    this.beds.air.gain.gain.setTargetAtTime(b.air, t, 1.2);
    this.beds.void.gain.gain.setTargetAtTime(b.void, t, 2);
  }

  /** Warnings pull the weapon and impact buses down for a moment so they read clearly. */
  private duckSfx(db: number): void {
    const now = this.now;
    if (now < this.duckUntil && db <= this.duckDepth) return;
    this.duckDepth = db;
    this.duckUntil = now + 0.22;
    const target = dbToGain(-db);
    for (const g of [this.duckW.gain, this.duckI.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(target, now, 0.012);
      g.setTargetAtTime(1, now + 0.2, 0.15);
    }
  }

  private allowLegacy(id: SfxId): boolean {
    const lim = LIMITS[id];
    if (!lim) return true;
    const now = this.now;
    let list = this.legacyVoices.get(id);
    if (!list) this.legacyVoices.set(id, (list = []));
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.t < now) list.splice(i, 1);
    if (list.length >= lim) return false;
    list.push({ t: now + 0.08 });
    return true;
  }

  private out(bus: AudioNode, pan: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (!this.mono && pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(bus);
    } else g.connect(bus);
    return g;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, dest: AudioNode, gain: number, attack = 0.002): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(t0: number, dur: number, dest: AudioNode, gain: number, type: BiquadFilterType, f0: number, f1: number, q = 1): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    const off = Math.random() * 1.5;
    s.start(t0, off, dur + 0.05);
  }

  private steal(v: Voice, now: number): void {
    const g = v.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.025);
    for (const s of v.srcs) {
      try {
        s.stop(now + 0.03);
      } catch {
        /* already stopped */
      }
    }
    v.end = now;
  }

  /**
   * Play a sound. pan -1..1, vol 0..1, pitch multiplier, far 0 (close) .. 1
   * (distant: darker and wetter).
   */
  play(id: SfxId, pan = 0, vol = 1, pitch = 1, far = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const patch = id === 'beam' ? undefined : PATCHES[id];
    if (!this.bank.ready || !patch) {
      if (!this.allowLegacy(id)) return;
      this.onCue?.(id, pan);
      const t = ctx.currentTime + 0.005;
      const ui = id.startsWith('ui') || id === 'cardIn';
      const dest = this.out(ui ? this.uiBus : this.sfxBus, pan, vol);
      this.synth(SYNTH_FALLBACK[id] ?? id, t, pitch * rand(0.94, 1.06), pitch, dest);
      return;
    }
    const now = ctx.currentTime;
    // ---- flam guard + density
    let rec = this.recent.get(id);
    if (!rec) this.recent.set(id, (rec = []));
    while (rec.length && now - rec[0]!.t > 0.5) rec.shift();
    if (patch.gap && rec.some((r) => now - r.t < patch.gap! && Math.abs(r.pan - pan) < 0.2)) return;
    const dens = Math.max(0.5, 1 / (1 + 0.1 * Math.max(0, rec.length - 2)));
    rec.push({ t: now, pan });
    // ---- voice management
    this.live = this.live.filter((v) => v.end > now);
    const prio = patch.prio ?? 1;
    const mine = this.live.filter((v) => v.id === id);
    if (mine.length >= (patch.voices ?? 4)) this.steal(mine[0]!, now);
    if (this.live.length >= MAX_VOICES) {
      let victim: Voice | null = null;
      for (const v of this.live) if (v.end > now && v.prio <= prio && (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start))) victim = v;
      if (!victim) return;
      this.steal(victim, now);
    }
    this.onCue?.(id, pan);

    // ---- voice graph: layers -> out -> [far LP] -> [panner] -> bus (+ sends)
    const t = now + 0.004;
    const out = ctx.createGain();
    out.gain.value = dbToGain((patch.db ?? 0) + rand(-1, 1)) * vol * dens;
    let node: AudioNode = out;
    if (far > 0.05) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000 * Math.pow(0.15, Math.min(1, far));
      lp.Q.value = 0.5;
      node = node.connect(lp);
    }
    const sweep = patch.sweep ?? 0;
    if (!this.mono && (pan !== 0 || sweep) && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      const c = Math.max(-1, Math.min(1, pan));
      if (sweep) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        p.pan.setValueAtTime(Math.max(-1, Math.min(1, c - dir * sweep * 0.5)), t);
        p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, c + dir * sweep * 0.5)), t + 0.35);
      } else p.pan.value = c;
      node = node.connect(p);
    }
    node.connect(this.buses[patch.bus]);
    const rev = Math.min(1, (patch.rev ?? 0) + far * 0.25);
    if (rev > 0.005 && patch.bus !== 'ui') {
      const s = ctx.createGain();
      s.gain.value = rev * 0.55;
      node.connect(s).connect(this.hall.input);
    }
    if (patch.wide && !this.mono) {
      const s = ctx.createGain();
      s.gain.value = patch.wide * 0.6;
      node.connect(s).connect(this.wide.input);
    }

    const srcs: AudioScheduledSourceNode[] = [];
    let end = t + 0.3;
    const p = pitch * rand(0.97, 1.03);
    for (const L of patch.layers) {
      if (L.chance !== undefined && Math.random() > L.chance) continue;
      const t0 = t + (L.delay ?? 0);
      const lg = ctx.createGain();
      lg.gain.value = dbToGain(L.db ?? 0);
      lg.connect(out);
      if (L.synth) {
        L.synth(this.kit, t0, p, lg, pitch);
        end = Math.max(end, t0 + 4.5);
        continue;
      }
      const pk = this.bank.pick(L.s!);
      if (!pk) continue;
      const src = ctx.createBufferSource();
      src.buffer = pk.buf;
      const r = L.rate ?? [0.97, 1.03];
      let rate = rand(r[0], r[1]);
      rate *= L.scale ? scaleRate(pitch) : 1 + (pitch - 1) * (L.track ?? 1);
      rate = Math.max(0.1, rate);
      src.playbackRate.setValueAtTime(rate, t0);
      if (L.rateTo) src.playbackRate.exponentialRampToValueAtTime(rate * L.rateTo, t0 + (L.ramp ?? pk.buf.duration));
      lg.gain.value *= pk.gain;
      let head: AudioNode = src;
      if (L.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = L.lp;
        head = head.connect(f);
      }
      if (L.hp) {
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = L.hp;
        head = head.connect(f);
      }
      head.connect(lg);
      src.start(t0);
      let len = pk.buf.duration / Math.min(rate, L.rateTo ? rate * L.rateTo : rate);
      if (L.dur && L.dur < len) {
        len = L.dur;
        lg.gain.setValueAtTime(lg.gain.value, t0 + len - 0.03);
        lg.gain.linearRampToValueAtTime(0, t0 + len);
        src.stop(t0 + len + 0.01);
      }
      end = Math.max(end, t0 + len);
      srcs.push(src);
    }
    this.live.push({ id, start: now, end, prio, out, srcs });
    if (patch.duck) this.duckSfx(patch.duck);
    if (patch.bus === 'weapon') this.shotsThisFrame++;
  }

  /** Procedural voice for every id (used before the sprite decodes, or if it cannot). */
  private synth(id: SfxId, t: number, p: number, pitch: number, dest: AudioNode): void {
    switch (id) {
      case 'kinetic':
        this.noiseBurst(t, 0.06, dest, 0.5, 'bandpass', 3200 * p, 900, 1.2);
        this.osc('square', 180 * p, 60, t, 0.07, dest, 0.25);
        this.osc('sine', 90 * p, 40, t, 0.1, dest, 0.4);
        break;
      case 'scatter':
        this.noiseBurst(t, 0.18, dest, 0.8, 'lowpass', 5000, 300, 0.7);
        this.osc('sine', 110 * p, 35, t, 0.2, dest, 0.7);
        this.noiseBurst(t + 0.02, 0.3, dest, 0.25, 'highpass', 3000, 6000);
        break;
      case 'heavy':
        this.osc('sawtooth', 160 * p, 40, t, 0.18, dest, 0.35);
        this.osc('sine', 70 * p, 30, t, 0.25, dest, 0.7);
        this.noiseBurst(t, 0.15, dest, 0.5, 'lowpass', 2500, 200);
        break;
      case 'rail':
        this.osc('sawtooth', 2400 * p, 120, t, 0.35, dest, 0.25);
        this.osc('sine', 60, 30, t, 0.4, dest, 0.8);
        this.noiseBurst(t, 0.5, dest, 0.5, 'bandpass', 8000, 400, 2);
        break;
      case 'energy':
        this.osc('square', 1400 * p, 300 * p, t, 0.09, dest, 0.12);
        this.osc('sine', 900 * p, 200, t, 0.12, dest, 0.25);
        break;
      case 'beam': {
        // continuous: handled by beamHold
        break;
      }
      case 'arc':
        this.noiseBurst(t, 0.12, dest, 0.5, 'bandpass', 4000, 1500, 4);
        this.osc('sawtooth', 220 * p, 80, t, 0.15, dest, 0.15);
        this.osc('square', 1800 * p, 600, t, 0.05, dest, 0.08);
        break;
      case 'missile':
        this.noiseBurst(t, 0.35, dest, 0.35, 'bandpass', 600, 3000, 1.5);
        this.osc('triangle', 300 * p, 800 * p, t, 0.2, dest, 0.1);
        break;
      case 'mine':
        this.osc('square', 600 * p, 600 * p, t, 0.05, dest, 0.1);
        this.osc('square', 900 * p, 900 * p, t + 0.06, 0.05, dest, 0.08);
        break;
      case 'exotic':
        this.osc('sine', 120 * p, 400 * p, t, 0.4, dest, 0.35, 0.05);
        this.osc('sawtooth', 60 * p, 30, t, 0.5, dest, 0.12, 0.05);
        break;
      case 'drone':
        this.osc('square', 1600 * p, 900, t, 0.04, dest, 0.06);
        break;
      case 'light':
        this.bell(t, 880 * p, dest, 0.25, 0.5);
        this.bell(t, 1320 * p, dest, 0.12, 0.4);
        break;
      case 'hit':
        this.noiseBurst(t, 0.04, dest, 0.35, 'highpass', 2500 * p, 5000);
        this.osc('square', 700 * p, 300, t, 0.03, dest, 0.06);
        break;
      case 'crit':
        this.osc('square', 1600 * p, 2400 * p, t, 0.06, dest, 0.12);
        this.noiseBurst(t, 0.08, dest, 0.4, 'highpass', 4000, 8000);
        break;
      case 'block':
        this.osc('triangle', 2200 * p, 1800, t, 0.06, dest, 0.15);
        break;
      case 'kill':
        this.noiseBurst(t, 0.22, dest, 0.6, 'lowpass', 3000 * p, 200, 0.8);
        this.osc('sine', 150 * p, 40, t, 0.2, dest, 0.6);
        this.osc('triangle', 600 * p, 1200 * p, t, 0.08, dest, 0.12);
        break;
      case 'killBig':
      case 'explosion':
        this.noiseBurst(t, 0.6, dest, 0.9, 'lowpass', 2200 * p, 80, 0.6);
        this.osc('sine', 80 * p, 25, t, 0.7, dest, 0.9);
        this.noiseBurst(t + 0.05, 1.0, dest, 0.25, 'bandpass', 900, 200, 0.5);
        this.crackle(t + 0.1, 0.6, dest, 0.2);
        break;
      case 'pickup': {
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
        const step = scale[Math.min(scale.length - 1, Math.floor(pitch))]!;
        const f = 660 * Math.pow(2, step / 12);
        this.bell(t, f, dest, 0.12, 0.25);
        break;
      }
      case 'graze':
        this.osc('sine', 2600 * p, 4200 * p, t, 0.08, dest, 0.1);
        this.noiseBurst(t, 0.06, dest, 0.15, 'highpass', 6000, 9000);
        break;
      case 'hurt':
        this.noiseBurst(t, 0.25, dest, 0.9, 'lowpass', 1800, 200, 1.5);
        this.osc('sawtooth', 120, 50, t, 0.3, dest, 0.5);
        this.osc('square', 1200, 200, t, 0.1, dest, 0.15);
        break;
      case 'shieldBreak':
        this.osc('sawtooth', 1800, 200, t, 0.4, dest, 0.25);
        this.noiseBurst(t, 0.5, dest, 0.5, 'highpass', 3000, 800);
        break;
      case 'dodge':
        this.noiseBurst(t, 0.25, dest, 0.45, 'bandpass', 800, 3500, 2);
        break;
      case 'flareOn':
        this.osc('sawtooth', 110, 880, t, 0.9, dest, 0.25, 0.05);
        [523, 659, 784, 1046].forEach((f, i) => this.bell(t + 0.05 + i * 0.05, f, dest, 0.18, 1.8));
        this.noiseBurst(t, 1.2, dest, 0.35, 'highpass', 1000, 8000);
        break;
      case 'flareOff':
        this.osc('sine', 880, 220, t, 0.6, dest, 0.15);
        break;
      case 'lumenFull':
        [784, 988, 1175].forEach((f, i) => this.bell(t + i * 0.07, f, dest, 0.15, 0.8));
        break;
      case 'enemyShot':
        this.osc('triangle', 500 * p, 250 * p, t, 0.1, dest, 0.12);
        break;
      case 'enemyBig':
        this.osc('sawtooth', 300 * p, 90, t, 0.3, dest, 0.18);
        this.noiseBurst(t, 0.2, dest, 0.2, 'bandpass', 1200, 400);
        break;
      case 'telegraph':
        this.osc('sine', 1200 * p, 1200 * p, t, 0.12, dest, 0.12, 0.01);
        this.osc('sine', 1500 * p, 1500 * p, t + 0.14, 0.12, dest, 0.12, 0.01);
        break;
      case 'warpCharge':
        this.osc('sawtooth', 60, 900, t, 2.2, dest, 0.18, 1.5);
        this.osc('sine', 120, 1800, t, 2.2, dest, 0.15, 1.5);
        this.noiseBurst(t, 2.3, dest, 0.3, 'bandpass', 200, 6000, 3);
        break;
      case 'warpGo':
        this.noiseBurst(t, 1.2, dest, 0.9, 'lowpass', 9000, 100);
        this.osc('sine', 50, 20, t, 1.2, dest, 0.9);
        break;
      case 'warpArrive':
        this.osc('sine', 40, 30, t, 1.5, dest, 0.9);
        this.noiseBurst(t, 1.5, dest, 0.4, 'lowpass', 1500, 80);
        [392, 523, 659].forEach((f, i) => this.bell(t + 0.2 + i * 0.08, f, dest, 0.12, 2));
        break;
      case 'uiMove':
        this.osc('square', 1200, 1200, t, 0.025, dest, 0.06);
        break;
      case 'uiSelect':
        this.osc('square', 880, 1760, t, 0.08, dest, 0.1);
        this.bell(t + 0.03, 1320, dest, 0.08, 0.3);
        break;
      case 'uiBack':
        this.osc('square', 900, 450, t, 0.08, dest, 0.08);
        break;
      case 'uiBuy':
        [1046, 1318, 1568].forEach((f, i) => this.bell(t + i * 0.04, f, dest, 0.1, 0.4));
        break;
      case 'uiDeny':
        this.osc('square', 200, 150, t, 0.15, dest, 0.12);
        break;
      case 'cardIn':
        this.noiseBurst(t, 0.15, dest, 0.25, 'bandpass', 2000 * p, 5000, 2);
        break;
      case 'shockwave':
        this.osc('sine', 200, 30, t, 0.6, dest, 0.8);
        this.noiseBurst(t, 0.5, dest, 0.7, 'lowpass', 6000, 100);
        break;
      case 'stasis':
        this.osc('sine', 1200, 300, t, 1, dest, 0.2, 0.05);
        this.osc('sine', 1210, 302, t, 1, dest, 0.2, 0.05);
        break;
      case 'boss':
        this.osc('sawtooth', 55, 40, t, 2.5, dest, 0.4, 0.4);
        this.osc('sawtooth', 82, 60, t, 2.5, dest, 0.25, 0.4);
        this.noiseBurst(t, 2.5, dest, 0.3, 'lowpass', 400, 80);
        break;
      case 'bossPhase':
        this.osc('sawtooth', 110, 55, t, 1.2, dest, 0.35);
        this.noiseBurst(t, 1, dest, 0.6, 'lowpass', 3000, 100);
        break;
      case 'bossDeath':
        this.noiseBurst(t, 3, dest, 1, 'lowpass', 5000, 40, 0.5);
        this.osc('sine', 60, 20, t, 3, dest, 1);
        this.crackle(t + 0.2, 2.5, dest, 0.3);
        break;
      case 'relight':
        [261, 329, 392, 523, 659, 784].forEach((f, i) => this.bell(t + i * 0.12, f, dest, 0.2, 3));
        this.osc('sine', 130, 130, t, 4, dest, 0.15, 1);
        break;
      case 'death':
        this.osc('sine', 440, 55, t, 2.5, dest, 0.4, 0.01);
        this.noiseBurst(t, 2, dest, 0.6, 'lowpass', 2000, 50);
        break;
      case 'heartbeat':
        this.osc('sine', 70, 40, t, 0.15, dest, 0.7);
        this.osc('sine', 65, 35, t + 0.2, 0.18, dest, 0.5);
        break;
      case 'evolve':
        [392, 494, 587, 784, 988].forEach((f, i) => this.bell(t + i * 0.06, f, dest, 0.2, 1.5));
        this.osc('sawtooth', 100, 800, t, 1, dest, 0.15, 0.3);
        break;
      case 'reaction':
        this.osc('square', 300 * p, 1500 * p, t, 0.15, dest, 0.15);
        this.noiseBurst(t, 0.2, dest, 0.4, 'bandpass', 3000, 800, 2);
        break;
      case 'spawn':
        this.osc('sine', 200 * p, 800 * p, t, 0.25, dest, 0.06, 0.1);
        break;
      case 'status':
        this.noiseBurst(t, 0.1, dest, 0.15, 'bandpass', 2000 * p, 4000, 3);
        break;
    }
  }

  private bell(t: number, f: number, dest: AudioNode, gain: number, dur: number): void {
    this.osc('sine', f, f, t, dur, dest, gain, 0.003);
    this.osc('sine', f * 2.76, f * 2.76, t, dur * 0.4, dest, gain * 0.3, 0.002);
  }

  private crackle(t: number, dur: number, dest: AudioNode, gain: number): void {
    for (let i = 0; i < 6; i++) this.noiseBurst(t + Math.random() * dur, 0.04, dest, gain * Math.random(), 'highpass', 3000, 6000);
  }

  private loop(name: string, bus: AudioNode, type: BiquadFilterType, freq: number, rate = 1): Loop | null {
    const ctx = this.ctx!;
    const pk = this.bank.pick(name);
    if (!pk) return null;
    const src = ctx.createBufferSource();
    src.buffer = pk.buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(bus);
    // start each bed at a random point so sessions never sound identical
    src.start(ctx.currentTime + 0.01, Math.random() * pk.buf.duration);
    return { src, filt, gain };
  }

  /** Continuous sounds held while active. Call every frame. */
  boostHold(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (on && !this.boostNode) {
      if (this.bank.ready) {
        const l = this.loop('thrust_loop', this.buses.player, 'lowpass', 900, rand(0.95, 1.05));
        if (!l) return;
        // ignition: a deep whoomp, then the burner opens up
        this.play('boost', 0, 0.8);
        l.gain.gain.setValueAtTime(0, t);
        l.gain.gain.linearRampToValueAtTime(0.3, t + 0.12);
        l.filt.frequency.setTargetAtTime(5200, t, 0.12);
        this.boostNode = { src: l.src, gain: l.gain, filt: l.filt };
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 300;
      filt.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(0.45, t + 0.1);
      filt.frequency.linearRampToValueAtTime(900, t + 0.4);
      src.connect(filt).connect(gain).connect(this.sfxBus);
      src.start();
      this.boostNode = { src, gain, filt };
    } else if (!on && this.boostNode) {
      const b = this.boostNode;
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setValueAtTime(b.gain.gain.value, t);
      b.gain.gain.linearRampToValueAtTime(0, t + 0.35);
      b.filt.frequency.cancelScheduledValues(t);
      b.filt.frequency.setTargetAtTime(500, t, 0.1);
      b.src.stop(t + 0.4);
      this.boostNode = null;
    }
  }

  /**
   * Ship engine bed: a low rumble and a thrust texture that rise with speed.
   * `speed` is 0..1; pass active=false outside combat.
   */
  engineHold(active: boolean, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bank.ready) return;
    if (!this.engine) {
      if (!active) return; // build the loops on first flight, not on the title screen
      const rumble = this.loop('rumble_loop', this.buses.player, 'lowpass', 500);
      const thrust = this.loop('engine_loop', this.buses.player, 'lowpass', 900);
      if (!rumble || !thrust) return;
      this.engine = { rumble, thrust, level: -1 };
    }
    const s = active ? Math.max(0, Math.min(1, speed)) : 0;
    const e = this.engine;
    const target = active ? s : -0.5;
    if (Math.abs(target - e.level) < 0.01) return;
    e.level = target;
    const t = ctx.currentTime;
    const k = 0.12;
    e.rumble.gain.gain.setTargetAtTime(active ? 0.2 + 0.14 * s : 0, t, active ? k : 0.4);
    e.rumble.src.playbackRate.setTargetAtTime(0.85 + 0.3 * s, t, k);
    e.rumble.filt.frequency.setTargetAtTime(380 + 600 * s, t, k);
    e.thrust.gain.gain.setTargetAtTime(active ? 0.03 + 0.15 * s : 0, t, active ? k : 0.4);
    e.thrust.src.playbackRate.setTargetAtTime(0.9 + 0.45 * s, t, k);
    e.thrust.filt.frequency.setTargetAtTime(600 + 2800 * s, t, k);
  }

  beamHold(on: boolean, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on) this.beamT = 0.1;
    if (on && this.beamNode?.rate) this.beamNode.rate.setTargetAtTime(pitch, ctx.currentTime, 0.05);
    if (!on || this.beamNode) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    if (this.bank.ready) {
      // burning texture + a soft harmonic hum with slow filter drift; kept dark and low
      const pk = this.bank.pick('beam_loop');
      const tex = ctx.createBufferSource();
      tex.buffer = pk!.buf;
      tex.loop = true;
      tex.playbackRate.value = pitch;
      const texF = ctx.createBiquadFilter();
      texF.type = 'lowpass';
      texF.frequency.value = 3600;
      const texG = ctx.createGain();
      texG.gain.value = 0.32 * pk!.gain;
      tex.connect(texF).connect(texG).connect(gain);
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 110 * pitch;
      const hum2 = ctx.createOscillator();
      hum2.type = 'triangle';
      hum2.frequency.value = 165.5 * pitch;
      const humF = ctx.createBiquadFilter();
      humF.type = 'lowpass';
      humF.frequency.value = 1100;
      humF.Q.value = 2;
      const drift = ctx.createOscillator();
      drift.frequency.value = 0.7;
      const driftG = ctx.createGain();
      driftG.gain.value = 350;
      drift.connect(driftG).connect(humF.frequency);
      const humG = ctx.createGain();
      humG.gain.value = 0.05;
      hum.connect(humF);
      hum2.connect(humF);
      humF.connect(humG).connect(gain);
      gain.connect(this.buses.weapon);
      const send = ctx.createGain();
      send.gain.value = 0.08;
      gain.connect(send).connect(this.hall.input);
      for (const n of [tex, hum, hum2, drift]) n.start(t);
      gain.gain.linearRampToValueAtTime(1.1, t + 0.05);
      this.beamNode = { srcs: [tex, hum, hum2, drift], gain, rate: tex.playbackRate };
      this.play('exotic', 0, 0.25, 1.4);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 220 * pitch;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 331 * pitch;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 30;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 20;
    lfo.connect(lfoG).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    gain.gain.linearRampToValueAtTime(0.12, t + 0.05);
    osc.connect(f);
    osc2.connect(f);
    f.connect(gain).connect(this.sfxBus);
    for (const n of [osc, osc2, lfo]) n.start(t);
    this.beamNode = { srcs: [osc, osc2, lfo], gain };
  }

  tick(dt: number): void {
    const ctx = this.ctx;
    if (this.beamNode && ctx) {
      this.beamT -= dt;
      if (this.beamT <= 0) {
        const b = this.beamNode;
        const t = ctx.currentTime;
        b.gain.gain.cancelScheduledValues(t);
        b.gain.gain.setValueAtTime(b.gain.gain.value, t);
        b.gain.gain.setTargetAtTime(0, t, 0.04);
        for (const s of b.srcs) s.stop(t + 0.3);
        this.beamNode = null;
      }
    }
    if (ctx && this.weaponLevel) {
      // weapon habituation: sustained fire settles ~3 dB and darkens, then recovers.
      // Measured on the audio clock: game dt is clamped and scaled by hit-stop/slow-mo.
      const t = ctx.currentTime;
      const adt = t - this.lastTick;
      this.lastTick = t;
      if (adt > 0 && adt < 3) {
        this.fireRate += (this.shotsThisFrame / adt - this.fireRate) * (1 - Math.exp(-adt / 0.6));
        this.fatigue = Math.max(0, Math.min(1, this.fatigue + (this.fireRate > 4 ? adt / 7 : -adt / 2)));
        this.weaponLevel.gain.setTargetAtTime(1 - 0.3 * this.fatigue, t, 0.4);
        this.weaponTone.frequency.setTargetAtTime(18000 - 8500 * this.fatigue, t, 0.4);
      }
      this.shotsThisFrame = 0;
    }
    this.soundtrack?.tick();
    this.music?.tick();
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const bed = ctx.createGain();
    bed.connect(this.ambBus);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(f).connect(gain).connect(bed);
    src.start();
    // slow drone
    const o = ctx.createOscillator();
    o.frequency.value = 55;
    const og = ctx.createGain();
    og.gain.value = 0.05;
    o.connect(og).connect(bed);
    o.start();
    this.synthAmb = bed;
  }

  /** Swap the synthesized ambience for the recorded beds once the sprite is in. */
  private startBeds(): void {
    const ctx = this.ctx!;
    const hum = this.loop('amb_hum', this.ambBus, 'lowpass', 700);
    const air = this.loop('amb_air', this.ambBus, 'lowpass', 2200);
    const vd = this.loop('amb_void', this.ambBus, 'lowpass', 1300);
    if (!hum || !air || !vd) return;
    this.beds = { hum, air, void: vd };
    // the hum breathes very slowly so the room never feels static
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(hum.filt.frequency);
    lfo.start();
    if (this.synthAmb) this.synthAmb.gain.setTargetAtTime(0, ctx.currentTime, 1);
    this.setScene(this.scene);
  }
}

/**
 * Procedural adaptive soundtrack: synthwave meets cosmic ambient.
 * Stems (pad, bass, drums, arp/lead) fade with `intensity` (0..1) and boss mode.
 * Each sector has its own key, scale, tempo and timbre.
 */
export class Music {
  bpm = 104;
  root = 45; // MIDI
  scale = [0, 3, 5, 7, 10];
  voice: 'glass' | 'warm' | 'cold' | 'pulse' | 'void' = 'glass';
  intensity = 0;
  targetIntensity = 0.2;
  boss = false;
  playing = false;
  private nextT = 0;
  private step = 0;
  private bar = 0;
  private stems: Record<'pad' | 'bass' | 'drums' | 'lead', GainNode>;
  private progression = [0, 5, 3, 4];
  /** beat callback for visuals */
  onBeat: ((step: number, bar: number) => void) | null = null;
  silence = 0; // seconds of silence (boss reveal)
  private muted = false;

  constructor(private a: AudioEngine) {
    const ctx = a.ctx!;
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(a.musicBus);
      return g;
    };
    this.stems = { pad: mk(), bass: mk(), drums: mk(), lead: mk() };
    // gentle stereo delay on lead for space
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.stems.lead.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(a.musicBus);
  }

  configure(cfg: { root: number; scale: number[]; bpm: number; voice: Music['voice'] }): void {
    this.root = cfg.root;
    this.scale = cfg.scale;
    this.bpm = cfg.bpm;
    this.voice = cfg.voice;
    const progs: Record<Music['voice'], number[]> = {
      glass: [0, 5, 3, 4],
      warm: [0, 3, 4, 1],
      cold: [0, 2, 4, 3],
      pulse: [0, 0, 5, 4],
      void: [0, 1, 0, 4],
    };
    this.progression = progs[cfg.voice];
  }

  start(): void {
    const ctx = this.a.ctx;
    if (!ctx) return;
    if (!this.playing) {
      this.playing = true;
      this.nextT = ctx.currentTime + 0.1;
      this.step = 0;
    }
  }

  stop(): void {
    this.playing = false;
  }

  private note(deg: number, oct: number): number {
    const n = this.scale.length;
    const o = Math.floor(deg / n);
    const d = ((deg % n) + n) % n;
    const midi = this.root + 12 * (oct + o) + this.scale[d]!;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  tick(): void {
    const ctx = this.a.ctx;
    if (!ctx || !this.playing) return;
    this.intensity += (this.targetIntensity - this.intensity) * 0.02;
    const I = this.intensity;
    const t = ctx.currentTime;
    if (this.a.soundtrack?.active) {
      // the recorded soundtrack has the floor: hold the stems silent, schedule nothing
      if (!this.muted) {
        this.muted = true;
        for (const g of Object.values(this.stems)) g.gain.setTargetAtTime(0, t, 0.4);
      }
      this.nextT = t + 0.05;
      return;
    }
    this.muted = false;
    const silent = this.silence > t;
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(silent ? 0 : v, t, 0.3);
    set(this.stems.pad, 0.5 - I * 0.1);
    set(this.stems.bass, Math.min(0.55, I * 0.9));
    set(this.stems.drums, I > 0.25 ? Math.min(0.6, (I - 0.2) * 1.0) : 0);
    set(this.stems.lead, I > 0.55 ? Math.min(0.35, (I - 0.5) * 0.8) : 0.05);
    const stepDur = 60 / this.bpm / 4;
    while (this.nextT < t + 0.15) {
      this.schedule(this.nextT, this.step, stepDur);
      const s = this.step;
      const b = this.bar;
      const fireAt = this.nextT;
      if (this.onBeat && s % 4 === 0) {
        const delayMs = Math.max(0, (fireAt - t) * 1000);
        setTimeout(() => this.onBeat?.(s, b), delayMs);
      }
      this.nextT += stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private schedule(t: number, step: number, sd: number): void {
    const ctx = this.a.ctx!;
    const chord = this.progression[Math.floor(this.bar / 2) % this.progression.length]!;
    const v = this.voice;
    // PAD: every 2 bars
    if (step === 0 && this.bar % 2 === 0) {
      const dur = sd * 32;
      for (const deg of [0, 2, 4]) {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = v === 'cold' || v === 'glass' ? 'triangle' : 'sawtooth';
          o.frequency.value = this.note(chord + deg, 0);
          o.detune.value = det;
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setValueAtTime(400, t);
          f.frequency.linearRampToValueAtTime(v === 'void' ? 500 : 1400, t + dur * 0.5);
          f.frequency.linearRampToValueAtTime(400, t + dur);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.06, t + dur * 0.3);
          g.gain.linearRampToValueAtTime(0, t + dur);
          o.connect(f).connect(g).connect(this.stems.pad);
          o.start(t);
          o.stop(t + dur + 0.1);
        }
      }
    }
    // BASS: driving eighths (synthwave)
    if (step % 2 === 0) {
      const pattern = v === 'void' ? [1, 0, 0, 0, 1, 0, 0, 0] : v === 'pulse' ? [1, 1, 1, 1, 1, 1, 1, 1] : [1, 0, 1, 1, 1, 0, 1, 1];
      if (pattern[(step / 2) % 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const oct = step % 4 === 2 && v !== 'void' ? -1 : -2;
        o.frequency.value = this.note(chord, oct + 1);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 6;
        f.frequency.setValueAtTime(1400 * (0.5 + this.intensity), t);
        f.frequency.exponentialRampToValueAtTime(120, t + sd * 1.8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + sd * 1.9);
        o.connect(f).connect(g).connect(this.stems.bass);
        o.start(t);
        o.stop(t + sd * 2);
      }
    }
    // DRUMS
    const kick = this.boss ? step % 4 === 0 || step === 14 : step % 4 === 0;
    if (kick) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.stems.drums);
      o.start(t);
      o.stop(t + 0.35);
    }
    if (step % 8 === 4) this.drumNoise(t, 0.18, 0.4, 1800, 'bandpass');
    if (step % 2 === 1 || (this.intensity > 0.7 && step % 1 === 0)) this.drumNoise(t, 0.04, step % 4 === 2 ? 0.18 : 0.1, 8000, 'highpass');
    // LEAD / ARP
    const arpOn = this.intensity > 0.55 ? true : step % 4 === 0;
    if (arpOn) {
      const arp = [0, 2, 4, 7, 4, 2, 5, 4];
      const deg = chord + arp[step % 8]!;
      const o = ctx.createOscillator();
      o.type = v === 'glass' || v === 'cold' ? 'sine' : v === 'pulse' ? 'square' : 'triangle';
      o.frequency.value = this.note(deg, 2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + sd * 2.5);
      o.connect(g).connect(this.stems.lead);
      o.start(t);
      o.stop(t + sd * 3);
    }
  }

  private drumNoise(t: number, dur: number, gain: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.a.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = (this.a as unknown as { noise: AudioBuffer }).noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.stems.drums);
    s.start(t, Math.random(), dur + 0.02);
  }
}
