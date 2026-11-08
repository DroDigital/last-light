import { PerspectiveCamera, Quaternion, Vector3, Euler } from 'three';
import type { World } from './world';
import type { View } from '../render/view';
import type { AudioEngine, SfxId } from '../audio/audio';
import type { GameLoop } from '../core/loop';
import type { Pipeline } from '../render/pipeline';
import { fxRng } from '../core/rng';
import { clamp, damp, noise1, hexToRgb } from '../core/math';
import type { Settings } from '../meta/save';
import { DROP_INFO } from '../data/drops';
import { EFFECTS } from './loot';

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _ax = new Vector3();
const _ay = new Vector3();
const _up = new Vector3(0, 1, 0);

export interface DamageNumber {
  x: number;
  y: number;
  z: number;
  v: number;
  crit: boolean;
  t: number;
  vx: number;
  vy: number;
}

const r = () => fxRng.next();

/**
 * Every meaningful event gets >= 3 channels of feedback (visual, audio,
 * camera/time, UI). All intensities respect accessibility settings.
 */
export class Juice {
  trauma = 0;
  fovKick = 0;
  microKick = 0;
  flash = 0;
  damageGlitch = 0;
  breath = 0;
  numbers: DamageNumber[] = [];
  /** reticle hit marker (0..1, decays) and kill confirm (red X) */
  hitMark = 0;
  killMark = 0;
  /** incoming-damage arcs: where each recent hit came from (world space) */
  damageDirs: { x: number; y: number; z: number; t: number; hull: boolean }[] = [];
  /** Swiss kill confirmations: "DESTROYED / 042" with a signal-orange rule */
  killTags: { x: number; y: number; z: number; n: number; t: number; label: string }[] = [];
  private killTagT = 0;
  private lastHitStop = 0;
  private unsub: (() => void)[] = [];
  private killSoundT = 0;
  /** Throttle decorative muzzle apertures independently of fire rate. */
  private apertureT = 0;
  cam = { yaw: 0, pitch: 0 };
  slowmo = 0;
  /** last-cause for UI toast */
  toasts: { text: string; t: number; color: string }[] = [];
  heartbeatT = 0;
  lowHpMix = 0;
  /** delayed secondary detonations after a heavy hull dies (visual only) */
  private secondaries: { x: number; y: number; z: number; t: number; s: number; r: number; g: number; b: number; f: string }[] = [];
  private ventT = 0;

  constructor(
    private view: View,
    private audio: AudioEngine,
    private loop: GameLoop,
    private pipe: Pipeline,
    private settings: () => Settings,
  ) {}

  private get P() {
    return this.view.particles;
  }

  private pan(x: number, y: number, z: number): number {
    _v.set(x, y, z).project(this.view.camera);
    return clamp(_v.x, -1, 1) * 0.8;
  }
  private distVol(x: number, y: number, z: number): number {
    const d = this.view.camera.position.distanceTo(_v.set(x, y, z));
    return clamp(1.2 - d / 180, 0.15, 1);
  }

  sfx(id: SfxId, x: number, y: number, z: number, vol = 1, pitch = 1): void {
    this.audio.play(id, this.pan(x, y, z), vol * this.distVol(x, y, z), pitch);
  }

  addTrauma(t: number): void {
    this.trauma = Math.min(1, this.trauma + t * this.settings().shake);
  }

  hitStop(ms: number): void {
    const now = performance.now();
    if (now - this.lastHitStop < 120) return;
    this.lastHitStop = now;
    this.loop.hitStop(ms);
  }

  toast(text: string, color = '#fff0c0'): void {
    this.toasts.push({ text, t: 2.2, color });
  }

  attach(w: World): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const ev = w.events;
    const P = () => this.P;
    const lights = this.pipe.lights;

    this.unsub.push(
      ev.on('shot', (s) => {
        const c = hexToRgb(s.w.color);
        lights.spawn(s.x, s.y, s.z, c[0] * 5, c[1] * 5, c[2] * 5, 7, 0.05);
        // A few weapons leave a short aperture at the muzzle. The projectile
        // itself keeps its reserved player tone; this is just local feedback.
        if (this.apertureT <= 0 && !this.settings().reducedMotion) {
          const behavior = s.w.def.behavior;
          if (behavior === 'rail' || behavior === 'missile' || behavior === 'well') {
            this.apertureT = 0.22;
            const radius = behavior === 'rail' ? 2.3 : behavior === 'missile' ? 1.4 : 3;
            this.view.addRing(s.x, s.y, s.z, 0.35, radius, 0.22, 0.35, 0.9, 1);
          }
        }
        // muzzle star: a short crisp cross of light at the barrel
        if (!this.settings().reducedMotion) {
          const k = s.secondary ? 1.4 : 1;
          this.view.addSpark(s.x, s.y, s.z, s.dx * 90 * k, s.dy * 90 * k, s.dz * 90 * k, 0.06, 0.035, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 30);
          P().spawn(s.x, s.y, s.z, s.dx * 25, s.dy * 25, s.dz * 25, 0.045, c[0] * 9 + 3, c[1] * 9 + 3, c[2] * 9 + 3, 5 * k, 1.5, 8);
        }
        for (let i = 0; i < 3; i++)
          P().spawn(s.x, s.y, s.z, s.dx * 40 + (r() - 0.5) * 20, s.dy * 40 + (r() - 0.5) * 20, s.dz * 40 + (r() - 0.5) * 20, 0.1, c[0] * 4, c[1] * 4, c[2] * 4, 2.5, 0.5, 6);
        // Each installed hardpoint effect has its own short-lived signature.
        // Keep the flashes local to the muzzle so the aiming space stays clear.
        const ids = s.side ? w.build.effects[s.side < 0 ? 'port' : 'starboard'] : [];
        ids.forEach((id, slot) => {
          const effect = EFFECTS.find((entry) => entry.id === id);
          if (!effect) return;
          const tint = hexToRgb(effect.color);
          const n = id === 'ion' ? 7 : id === 'prism' ? 5 : 4;
          const spread = id === 'frost' ? 28 : id === 'void' ? 14 : 22;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + slot * 0.6;
            const drift = id === 'void' ? -10 : id === 'ember' ? 24 : 38;
            P().spawn(s.x, s.y, s.z,
              s.dx * drift + Math.cos(a) * spread,
              s.dy * drift + Math.sin(a) * spread,
              s.dz * drift + (r() - 0.5) * spread,
              id === 'ember' ? 0.32 : 0.22,
              tint[0] * 4, tint[1] * 4, tint[2] * 4,
              id === 'frost' ? 2.8 : 1.8, 0.2, 4);
          }
          if (id === 'prism' || id === 'radiant' || id === 'void')
            this.view.addRing(s.x, s.y, s.z, 0.3 + slot * 0.3, id === 'void' ? 3 : 5, 0.18, tint[0], tint[1], tint[2]);
          lights.spawn(s.x, s.y, s.z, tint[0] * 4, tint[1] * 4, tint[2] * 4, 5, 0.06);
        });
        // energy ejecta
        if (s.w.def.family === 'kinetic' && r() < 0.5) {
          const pl = w.player;
          pl.right(_w);
          P().spawn(s.x, s.y, s.z, _w.x * 15 + (r() - 0.5) * 5, _w.y * 15 + 6, _w.z * 15, 0.5, 2, 1.4, 0.6, 1.5, 1, 2, 10);
        }
        // Beams already use a sustained loop and beamTick feedback.
        if (s.w.def.behavior === 'beam') return;
        const id = s.w.def.sfx;
        // rising pitch on sustained fire
        const sustain = Math.min(1, s.w.shots / 40) * 0.15;
        this.audio.play(id, 0, s.secondary ? 0.9 : 0.55, 1 + sustain);
        this.microKick += (s.w.def.recoil ?? 0.05) * 0.4;
        if (s.w.def.shake) this.addTrauma(s.w.def.shake * 0.6);
      }),
      ev.on('beamTick', (b) => {
        this.audio.beamHold(true, b.secondary ? 0.8 : 1);
        this.microKick += 0.004;
      }),
      ev.on('hit', (h) => {
        const c = h.crit ? [3, 3, 3] : [2.2, 1.6, 0.9];
        const n = h.crit ? 7 : 3;
        for (let i = 0; i < n; i++) {
          const sp = 20 + r() * 40;
          P().spawn(h.x, h.y, h.z, (h.nx + (r() - 0.5) * 1.2) * sp, (h.ny + (r() - 0.5) * 1.2) * sp, (h.nz + (r() - 0.5) * 1.2) * sp, 0.18 + r() * 0.12, c[0]!, c[1]!, c[2]!, 1.6, 0.4, 5);
        }
        if (this.settings().damageNumbers && h.dmg >= 1) {
          this.numbers.push({ x: h.x, y: h.y, z: h.z, v: Math.round(h.dmg), crit: h.crit, t: 0, vx: (r() - 0.5) * 40, vy: -60 - r() * 30 });
          if (this.numbers.length > 80) this.numbers.shift();
        }
        this.hitMark = Math.max(this.hitMark, h.crit ? 1 : 0.7);
        if (h.crit) this.view.shells.add(h.x, h.y, h.z, 0.3, 2.2, 0.16, 2, 1.6, 1.5, 1.2, 0.9);
        this.sfx(h.crit ? 'crit' : 'hit', h.x, h.y, h.z, 0.5);
        // crisp vector sparks along the impact normal
        const vs = h.crit ? 4 : 2;
        for (let i = 0; i < vs; i++) {
          const sp = 40 + r() * 60;
          this.view.addSpark(h.x, h.y, h.z, (h.nx + (r() - 0.5)) * sp, (h.ny + (r() - 0.5)) * sp, (h.nz + (r() - 0.5)) * sp, 0.22, 0.03, 1, h.crit ? 1 : 0.85, h.crit ? 0.6 : 0.4, 4);
        }
      }),
      ev.on('breakup', (b) => {
        const e = b.e;
        const t = e.tint;
        const rr = e.radius * e.scale;
        // plating blows off: a small layered pop, a ring, a fan of hot sparks
        this.explosionFx(b.x, b.y, b.z, rr * (0.35 + b.stage * 0.15), t.x, t.y, t.z, e.def.faction, 0.3 + b.stage * 0.2);
        this.view.addRing(b.x, b.y, b.z, rr * 0.2, rr * (1.6 + b.stage * 0.6), 0.35, 1, 0.95, 0.36);
        _w.set(b.x - e.pos.x, b.y - e.pos.y, b.z - e.pos.z).normalize();
        for (let i = 0; i < 6 + b.stage * 4; i++) {
          const sp = 40 + r() * 70;
          this.view.addSpark(b.x, b.y, b.z, (_w.x + (r() - 0.5) * 1.4) * sp, (_w.y + (r() - 0.5) * 1.4) * sp, (_w.z + (r() - 0.5) * 1.4) * sp, 0.35 + r() * 0.3, 0.05, 1, 0.75, 0.3, 3);
        }
        lights.spawn(b.x, b.y, b.z, 40, 30, 16, 26, 0.25);
        this.sfx('explosion', b.x, b.y, b.z, 0.35 + b.stage * 0.15, 1.3 - b.stage * 0.15);
        this.addTrauma(0.06 + b.stage * 0.05);
      }),
      ev.on('block', (b) => {
        for (let i = 0; i < 4; i++) P().spawn(b.x, b.y, b.z, (r() - 0.5) * 50, (r() - 0.5) * 50, (r() - 0.5) * 50, 0.15, 1.5, 1.5, 2, 1.5, 0.5, 5);
        this.sfx('block', b.x, b.y, b.z, 0.4);
      }),
      ev.on('kill', (k) => {
        const e = k.e;
        if (e.def.role === 'inert') {
          this.explosionFx(k.x, k.y, k.z, e.radius * 1.2, 0.8, 0.6, 0.4, 'none', 0.5);
          this.sfx('kill', k.x, k.y, k.z, 0.6, 0.7);
          return;
        }
        const big = k.big;
        this.killMark = 1;
        const tint = e.tint;
        this.explosionFx(k.x, k.y, k.z, e.radius * e.scale * 1.2, tint.x, tint.y, tint.z, e.def.faction, big);
        // vector double shock ring: hot yellow outer, cyan inner (style C)
        const rr = e.radius * e.scale;
        this.view.addRing(k.x, k.y, k.z, rr * 0.4, rr * 4 + big * 6, 0.5 + big * 0.15, 1, 0.95, 0.36);
        this.view.addRing(k.x, k.y, k.z, rr * 0.2, rr * 2.4 + big * 4, 0.42, 0.16, 0.94, 1);
        for (let i = 0; i < 6 + big * 4; i++) {
          _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(40 + r() * 80);
          this.view.addSpark(k.x, k.y, k.z, _v.x, _v.y, _v.z, 0.5 + r() * 0.4, 0.06, 0.16, 0.94, 1, 2.5);
        }
        // Swiss kill confirmation for anything that matters (throttled in swarms)
        if (big > 0.55 || e.elite || this.killTagT <= 0) {
          this.killTagT = 0.35;
          this.killTags.push({ x: k.x, y: k.y, z: k.z, n: w.stats.kills, t: 0, label: e.rarity === 3 ? e.rankName : e.rarity > 0 ? `${e.def.name} / ${['', 'magic', 'rare', 'unique'][e.rarity]}` : e.def.name });
          if (this.killTags.length > 8) this.killTags.shift();
        }
        // hit-stop scaled by size (30–80 ms)
        const hs = clamp(25 + big * 20, 30, 80);
        if (big > 0.6 || w.killsThisTick === 1) this.hitStop(big > 0.6 ? hs : 18);
        this.addTrauma(clamp(0.08 + big * 0.12, 0.05, 0.6));
        // chain reactions cascade with escalating sound
        const pitch = 1 + Math.min(k.chain, 16) * 0.05;
        if (this.killSoundT <= 0 || big > 1) {
          this.sfx(big > 1 ? 'killBig' : 'kill', k.x, k.y, k.z, 0.8, pitch);
          this.killSoundT = 0.03;
        }
        if (big > 1.5) this.audio.duck(0.4, 0.4);
        // heavy hulls go up in a staggered chain of secondary detonations
        if (e.heavy) {
          const n = 3 + Math.min(2, Math.floor(big));
          for (let i = 0; i < n; i++) {
            _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(rr * (0.5 + r() * 0.9));
            this.secondaries.push({ x: k.x + _v.x, y: k.y + _v.y, z: k.z + _v.z, t: 0.12 + i * 0.13 + r() * 0.08, s: rr * (0.4 + r() * 0.4), r: tint.x, g: tint.y, b: tint.z, f: e.def.faction });
          }
        }
        if (k.chain === 10 || k.chain === 20 || k.chain === 40) this.toast(`CHAIN ×${k.chain}`, '#ffd890');
      }),
      ev.on('explosion', (x) => {
        this.explosionFx(x.x, x.y, x.z, x.radius * 0.55, x.r, x.g, x.b, 'none', x.radius / 12);
        if (x.radius > 6) this.sfx('explosion', x.x, x.y, x.z, clamp(x.radius / 20, 0.3, 1), clamp(1.4 - x.radius / 40, 0.6, 1.4));
        const d = this.view.camera.position.distanceTo(_v.set(x.x, x.y, x.z));
        this.addTrauma(clamp((x.radius / 25) * (1 - d / 150), 0, 0.35));
      }),
      ev.on('drop', (d) => {
        const col = hexToRgb(DROP_INFO[d.kind].color);
        if (!d.picked) {
          this.view.addRing(d.x, d.y, d.z, 0.4, 5, 0.4, col[0], col[1], col[2]);
          this.audio.play('cardIn', 0, 0.35, d.kind === 'cache' || d.kind === 'prism' ? 0.8 : 1.3);
          return;
        }
        this.view.addRing(d.x, d.y, d.z, 0.5, 7, 0.35, col[0], col[1], col[2]);
        for (let i = 0; i < 10; i++) P().spawn(d.x, d.y, d.z, (r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30, 0.35, col[0] * 3, col[1] * 3, col[2] * 3, 2.5, 0.5, 4);
        this.audio.play('uiBuy', 0, 0.6, d.kind === 'repair' || d.kind === 'cell' ? 1.2 : 1);
        this.toast(`+ ${DROP_INFO[d.kind].name.toUpperCase()}`, DROP_INFO[d.kind].color);
      }),
      ev.on('pickup', (p) => {
        P().spawn(p.x, p.y, p.z, 0, 4, 0, 0.3, 3, 2.8, 1.4, 3, 0.5, 3);
        this.audio.play('pickup', 0, 0.35, Math.min(10, p.combo * 0.5));
        this.breath = Math.min(0.3, this.breath + 0.02);
      }),
      ev.on('graze', (g) => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          P().spawn(g.x, g.y, g.z, Math.cos(a) * 18, Math.sin(a) * 18, (r() - 0.5) * 10, 0.25, 2.4, 2.8, 3, 1.6, 0.3, 6);
        }
        this.audio.play('graze', this.pan(g.x, g.y, g.z), 0.5, 1 + Math.min(g.count % 20, 10) * 0.03);
      }),
      ev.on('hurt', (h) => {
        this.addTrauma(h.hull ? 0.5 : 0.28);
        if (h.sx !== undefined && h.sy !== undefined && h.sz !== undefined) {
          this.damageDirs.push({ x: h.sx, y: h.sy, z: h.sz, t: 1, hull: h.hull });
          if (this.damageDirs.length > 6) this.damageDirs.shift();
        }
        // shield took it: the bubble lights up around the ship
        if (!h.hull) {
          const pp = w.player.pos;
          this.view.shells.add(pp.x, pp.y, pp.z, 2.6, 3.1, 0.38, 1, 0.35, 0.95, 1.4, 1.2, pp);
        }
        this.damageGlitch = Math.min(1, this.damageGlitch + (h.hull ? 0.9 : 0.45));
        this.flash = Math.max(this.flash, h.hull ? 0.12 : 0.05);
        this.audio.play('hurt', 0, h.hull ? 1 : 0.6);
        this.hitStop(h.hull ? 60 : 30);
        for (let i = 0; i < 16; i++) {
          _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(30);
          P().spawn(h.x, h.y, h.z, _v.x, _v.y, _v.z, 0.3, h.hull ? 3 : 0.6, h.hull ? 0.8 : 2, h.hull ? 0.4 : 3, 2, 0.5, 4);
        }
      }),
      ev.on('shieldBreak', () => {
        this.audio.play('shieldBreak', 0, 1);
        {
          const pp = w.player.pos;
          this.view.shells.add(pp.x, pp.y, pp.z, 2.8, 9, 0.55, 1, 0.4, 1, 1.5, 1.6);
        }
        this.toast('SHIELD DOWN', '#80e0ff');
        const p = w.player.pos;
        for (let i = 0; i < 40; i++) {
          _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(40);
          P().spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, 0.5, 0.6, 2, 3, 2, 0.3, 3);
        }
      }),
      ev.on('dodge', () => {
        this.audio.play('dodge', 0, 0.8);
        this.fovKick += 6;
      }),
      ev.on('flare', (f) => {
        if (f.on) {
          this.audio.play('flareOn', 0, 1);
          this.slowmo = 0.45;
          this.flash = 0.6;
          this.addTrauma(0.4);
          this.toast('FLARE', '#fff6c0');
          const p = w.player.pos;
          if (!this.settings().reducedMotion) {
            // The flare leaves two brief contours behind the lightship.
            this.view.addRing(p.x, p.y, p.z, 1, 14, 0.65, 1, 0.84, 0.45);
            this.view.addRing(p.x, p.y, p.z, 0.5, 9, 0.9, 0.38, 0.95, 1);
          }
          for (let i = 0; i < 160; i++) {
            _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(30 + r() * 60);
            P().spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, 0.9 + r() * 0.5, 4, 3.6, 2.2, 3, 0.5, 2, 0, 1);
          }
          lights.spawn(p.x, p.y, p.z, 120, 110, 70, 90, 1.2);
        } else this.audio.play('flareOff', 0, 0.6);
      }),
      ev.on('lumenFull', () => {
        this.audio.play('lumenFull', 0, 0.7);
        this.toast('LUMEN FULL — [F] FLARE', '#fff6c0');
      }),
      ev.on('enemyShot', (s) => {
        this.sfx(s.big ? 'enemyBig' : 'enemyShot', s.x, s.y, s.z, 0.45);
        lights.spawn(s.x, s.y, s.z, 20, 6, 3, 10, 0.08);
      }),
      ev.on('telegraph', (t) => {
        this.sfx('telegraph', t.x, t.y, t.z, 0.5, t.kind === 'line' ? 1 : 0.8);
      }),
      ev.on('status', (s) => {
        const col: Record<string, [number, number, number]> = {
          burn: [3, 1.2, 0.3], cryo: [1, 2.4, 3], shock: [1.6, 1.8, 3.5], corrode: [1, 2.6, 0.6], void: [1.6, 0.6, 2.8], radiant: [3, 2.8, 1.6],
        };
        const c = col[s.kind]!;
        for (let i = 0; i < 4; i++) P().spawn(s.x, s.y, s.z, (r() - 0.5) * 16, r() * 12, (r() - 0.5) * 16, 0.5, c[0], c[1], c[2], 2, 1, 2);
        if (r() < 0.3) this.sfx('status', s.x, s.y, s.z, 0.3);
      }),
      ev.on('reaction', (x) => {
        this.sfx('reaction', x.x, x.y, x.z, 0.7);
        const names: Record<string, string> = { r_shatter: 'SHATTER', r_overload: 'OVERLOAD', r_melt: 'MELT', r_implosion: 'IMPLOSION', r_glint: 'GLINT', r_static: 'STATIC ROT' };
        if (r() < 0.25) this.numbers.push({ x: x.x, y: x.y + 2, z: x.z, v: -1, crit: true, t: 0, vx: 0, vy: -40, label: names[x.id] } as DamageNumber);
      }),
      ev.on('ability', (a) => {
        if (a.kind === 'shockwave') {
          this.audio.play('shockwave', 0, 1);
          this.addTrauma(0.35);
          this.hitStop(40);
          const p = w.player.pos;
          if (!this.settings().reducedMotion)
            this.view.addRing(p.x, p.y, p.z, 2, 24, 0.5, 0.28, 0.95, 0.9);
          for (let i = 0; i < 80; i++) {
            const ang = (i / 80) * Math.PI * 2;
            P().spawn(p.x, p.y, p.z, Math.cos(ang) * 90, (r() - 0.5) * 10, Math.sin(ang) * 90, 0.35, 1.4, 3, 2.8, 2.5, 1, 4);
          }
        } else {
          this.audio.play('stasis', 0, 0.9);
          this.flash = Math.max(this.flash, 0.15);
          if (!this.settings().reducedMotion) {
            const p = w.player.pos;
            this.view.addRing(p.x, p.y, p.z, 2, 12, 0.8, 0.45, 0.8, 1);
          }
        }
      }),
      ev.on('spawn', (s) => {
        const c = s.faction === 'hush' ? [1.4, 0.5, 2.4] : s.faction === 'choir' ? [2.4, 1.2, 2.2] : [2.6, 1.4, 0.5];
        for (let i = 0; i < (s.big ? 30 : 10); i++) {
          _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(s.big ? 20 : 10);
          P().spawn(s.x + _v.x, s.y + _v.y, s.z + _v.z, -_v.x * 2, -_v.y * 2, -_v.z * 2, 0.5, c[0]!, c[1]!, c[2]!, 2, 0.5, 0);
        }
        if (s.faction !== 'none') this.sfx('spawn', s.x, s.y, s.z, s.big ? 0.6 : 0.25);
      }),
      ev.on('bossPhase', (b) => {
        if (b.phase === 99) {
          this.audio.play('bossDeath', 0, 1);
          this.audio.duck(0.9, 3);
          this.addTrauma(0.8);
          return;
        }
        this.audio.play('bossPhase', 0, 1);
        this.addTrauma(0.6);
        this.flash = 0.25;
        this.hitStop(80);
        this.toast(`PHASE ${b.phase + 1}`, '#ff9070');
      }),
      ev.on('bossDeath', (b) => {
        this.audio.play('relight', 0, 1);
        this.flash = 1;
        this.addTrauma(1);
        this.hitStop(80);
        lights.spawn(b.x, b.y, b.z, 300, 260, 200, 260, 2.5);
        if (!this.settings().reducedMotion) {
          // A clean outward pulse punctuates the transition into the relit sky.
          this.view.addRing(b.x, b.y, b.z, 3, 95, 2.2, 1, 0.78, 0.38);
          this.view.addRing(b.x, b.y, b.z, 2, 65, 1.5, 0.45, 0.95, 1);
        }
        for (let i = 0; i < 1200; i++) {
          _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(20 + r() * 140);
          const k = r();
          P().spawn(b.x, b.y, b.z, _v.x, _v.y, _v.z, 1 + r() * 2.5, 3 + k * 3, 2.5 + k * 2, 1.2 + k * 2, 4, 1, 0.8, 0, 1);
        }
      }),
      ev.on('playerDeath', () => {
        this.audio.play('death', 0, 1);
        this.slowmo = 1.2;
        this.addTrauma(1);
        const p = w.player.pos;
        const bloom = this.settings() && (w as unknown as { deathBloom?: boolean }).deathBloom;
        for (let i = 0; i < 400; i++) {
          _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(10 + r() * 60);
          P().spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, 1 + r() * 2, bloom ? 3 : 2.5, bloom ? 1.5 : 2.2, bloom ? 2.5 : 1.5, 3, 1, 1.2, 0, 1);
        }
        this.pipe.lights.spawn(p.x, p.y, p.z, 100, 90, 70, 60, 2);
      }),
      ev.on('evolve', (e) => {
        this.audio.play('evolve', 0, 1);
        this.toast(`EVOLVED: ${e.name.toUpperCase()}`, '#ffe080');
      }),
    );
  }

  /** Layered explosion: flash, fireball, shockwave ring, embers, sparks, light. */
  explosionFx(x: number, y: number, z: number, size: number, tr: number, tg: number, tb: number, faction: string, big: number): void {
    const P = this.P;
    const s = clamp(size, 0.6, 14);
    const budget = clamp(P.budgetScale, 0.3, 1);
    // flash
    P.spawn(x, y, z, 0, 0, 0, 0.07, 30, 28, 24, s * 10, s * 14, 0);
    // volumetric fireball: a boiling white-hot core that cools to embers,
    // with a slower, larger second bloom on big kills
    const sh = this.view.shells;
    const tint = faction === 'choir' ? [1.2, 0.8, 1.3] : faction === 'hush' ? [0.7, 0.5, 1.4] : [1, 0.85, 0.7];
    sh.add(x, y, z, s * 0.35, s * (1.6 + big * 0.5), 0.42 + big * 0.12, 0, tint[0]!, tint[1]!, tint[2]!, 1);
    if (big > 0.6) sh.add(x, y, z, s * 0.6, s * (2.6 + big * 0.6), 0.75 + big * 0.15, 0, tint[0]!, tint[1]!, tint[2]!, 0.55);
    // a thin energy shock sphere that outruns the fire
    if (big > 0.3) sh.add(x, y, z, s * 0.5, s * (4.2 + big * 1.4), 0.35, 2, 0.9 + tr * 0.4, 0.9 + tg * 0.4, 1 + tb * 0.4, 0.6);
    if (faction === 'none' && big > 0.4) this.view.addRing(x, y, z, s * 0.5, s * 3.2, 0.4, Math.min(1, tr), Math.min(1, tg), Math.min(1, tb));
    // dynamic light that lights the nebula and hulls nearby
    this.pipe.lights.spawn(x, y, z, 40 + tr * 40, 25 + tg * 30, 10 + tb * 25, 18 + s * 9, 0.35 + big * 0.15);
    const hot = faction === 'choir' ? [2.6, 1.6, 2.6] : faction === 'hush' ? [1.6, 0.7, 2.8] : [3.2, 1.6, 0.5];
    // fireball
    const nf = Math.round((10 + s * 6) * budget);
    for (let i = 0; i < nf; i++) {
      _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar((6 + r() * 16) * s);
      const k = r();
      P.spawn(x, y, z, _v.x, _v.y, _v.z, 0.35 + r() * 0.45, hot[0]! * (1 + k), hot[1]! * (1 + k * 0.5), hot[2]!, 4 + s, 1 + s * 0.3, 3.5);
    }
    // shockwave ring in a random plane
    const nr = Math.round((16 + s * 4) * budget);
    _w.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const ax = _ax.crossVectors(_w, _up).normalize();
    const ay = _ay.crossVectors(_w, ax).normalize();
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * Math.PI * 2;
      const vx = (ax.x * Math.cos(a) + ay.x * Math.sin(a)) * s * 28;
      const vy = (ax.y * Math.cos(a) + ay.y * Math.sin(a)) * s * 28;
      const vz = (ax.z * Math.cos(a) + ay.z * Math.sin(a)) * s * 28;
      P.spawn(x, y, z, vx, vy, vz, 0.3, 1.4 + tr, 1.4 + tg, 1.4 + tb, 2, 1, 5);
    }
    // embers drifting
    const ne = Math.round((6 + s * 3) * budget);
    for (let i = 0; i < ne; i++) {
      _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(4 + r() * 10 * s);
      P.spawn(x, y, z, _v.x, _v.y, _v.z, 1.2 + r() * 1.6, 2.4, 1.1, 0.3, 1.5, 0.8, 1.2, -1.5, 1);
    }
    // faction flavor
    if (faction === 'hush') {
      // dithered static: sparse white/violet flecks that blink out
      for (let i = 0; i < 20 * budget; i++) {
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(s * 3);
        P.spawn(x + _v.x, y + _v.y, z + _v.z, 0, 0, 0, 0.1 + r() * 0.4, r() < 0.5 ? 2 : 0.8, 1.6, 2.6, 2, 2, 0);
      }
    } else if (faction === 'choir') {
      for (let i = 0; i < 16 * budget; i++) {
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(40 + r() * 40);
        P.spawn(x, y, z, _v.x, _v.y, _v.z, 0.6, 3, 2.4, 3, 1.4, 0.6, 2);
      }
    } else if (faction === 'salvage') {
      for (let i = 0; i < 14 * budget; i++) {
        _v.set(r() - 0.5, r() * 0.5, r() - 0.5).normalize().multiplyScalar(30 + r() * 50);
        P.spawn(x, y, z, _v.x, _v.y, _v.z, 0.5 + r() * 0.5, 3.5, 2, 0.6, 1.2, 0.4, 1.5, 20);
      }
    }
  }

  /** Per-frame: camera shake, FOV, numbers, low-health heartbeat, post fx. */
  frame(dt: number, w: World | null): void {
    const st = this.settings();
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.microKick = damp(this.microKick, 0, 18, dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.damageGlitch = Math.max(0, this.damageGlitch - dt * 2.5);
    this.breath = damp(this.breath, 0, 3, dt);
    this.killSoundT -= dt;
    this.apertureT -= dt;
    this.hitMark = Math.max(0, this.hitMark - dt * 6);
    this.killMark = Math.max(0, this.killMark - dt * 2.5);
    for (let i = this.damageDirs.length - 1; i >= 0; i--) {
      const d = this.damageDirs[i]!;
      d.t -= dt * 0.9;
      if (d.t <= 0) this.damageDirs.splice(i, 1);
    }
    this.killTagT -= dt;
    for (let i = this.secondaries.length - 1; i >= 0; i--) {
      const sc = this.secondaries[i]!;
      sc.t -= dt;
      if (sc.t > 0) continue;
      this.explosionFx(sc.x, sc.y, sc.z, sc.s, sc.r, sc.g, sc.b, sc.f, 0.5);
      this.view.addRing(sc.x, sc.y, sc.z, sc.s * 0.3, sc.s * 3, 0.32, 1, 0.95, 0.36);
      this.pipe.lights.spawn(sc.x, sc.y, sc.z, 60, 44, 24, 30, 0.3);
      this.sfx('explosion', sc.x, sc.y, sc.z, 0.45, 0.9 + r() * 0.3);
      this.addTrauma(0.08);
      this.secondaries.splice(i, 1);
    }
    // damaged heavy hulls vent embers and smoke from their breaches
    this.ventT -= dt;
    if (w && this.ventT <= 0) {
      this.ventT = 1 / 30;
      const P = this.P;
      for (const e of w.enemies) {
        if (!e.alive || e.breakStage === 0) continue;
        if (r() > 0.35 * e.breakStage) continue;
        const rr = e.radius * e.scale * 0.7;
        _v.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
        const x = e.pos.x + _v.x * rr;
        const y = e.pos.y + _v.y * rr;
        const z = e.pos.z + _v.z * rr;
        const hot = r() < 0.5;
        P.spawn(x, y, z, e.vel.x * 0.6 + _v.x * 8, e.vel.y * 0.6 + _v.y * 8 + 2, e.vel.z * 0.6 + _v.z * 8, 0.5 + r() * 0.6, hot ? 3 : 0.5, hot ? 1.6 : 0.45, hot ? 0.5 : 0.5, hot ? 0.9 : 1.6, hot ? 0.2 : 3.2, 1.5, 0, 0.6);
      }
    }
    for (let i = this.killTags.length - 1; i >= 0; i--) {
      this.killTags[i]!.t += dt;
      if (this.killTags[i]!.t > 1.4) this.killTags.splice(i, 1);
    }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i]!;
      n.t += dt;
      if (n.t > 0.8) this.numbers.splice(i, 1);
    }
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i]!.t -= dt;
      if (this.toasts[i]!.t <= 0) this.toasts.splice(i, 1);
    }
    // slow-mo (flare activation / death), eased
    if (this.slowmo > 0) this.slowmo -= dt;
    // low health
    let low = 0;
    if (w && w.player.alive) {
      const f = w.player.hull / w.player.maxHull;
      low = f < 0.35 ? (0.35 - f) / 0.35 : 0;
      if (low > 0) {
        this.heartbeatT -= dt;
        if (this.heartbeatT <= 0) {
          this.heartbeatT = 1.1 - low * 0.5;
          this.audio.play('heartbeat', 0, 0.4 + low * 0.5);
        }
      }
    }
    this.lowHpMix = damp(this.lowHpMix, low, 4, dt);
    const fx = this.pipe.fx;
    fx.lowHp = this.lowHpMix;
    fx.damage = this.damageGlitch * (st.reducedMotion ? 0.3 : 1);
    fx.flash = this.flash * st.flash;
    fx.breath = this.breath + (w && w.player.flareT > 0 ? 0.2 : 0);
    this.pipe.reduceFlash = st.flash;
  }

  /** Apply trauma-based shake (smooth noise, not random jitter) to the camera. */
  applyShake(cam: PerspectiveCamera, time: number): void {
    const st = this.settings();
    const s = this.trauma * this.trauma * (st.reducedMotion ? 0.35 : 1);
    if (s <= 0.0001 && this.microKick < 0.0001) return;
    const amp = 0.06 * s;
    _e.set(noise1(time * 23) * amp + this.microKick * 0.02, noise1(time * 23 + 50) * amp, noise1(time * 19 + 100) * amp * 1.5);
    _q.setFromEuler(_e);
    cam.quaternion.multiply(_q);
  }
}
