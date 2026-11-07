/**
 * Animated draft-card previews (brief §13: "a short animated preview of each
 * effect"). Each card gets a tiny looping vignette: the Lantern on the left,
 * Hush targets on the right, and the card's actual effect between them.
 *
 * Rendered in software into a 76×44 additive light buffer, then resolved with
 * the same 4×4 ordered dither the game uses, on the 3 px UI cell grid. Player
 * shots use the reserved player tone and enemies the reserved enemy tone, so
 * the previews read exactly like combat.
 */
import type { DraftCard } from '../game/build';
import type { Behavior, Tag, TriggerDo, TriggerOn, WeaponParams } from '../game/types';
import { hexToRgb } from '../core/math';

export const PV_W = 76;
export const PV_H = 44;
const PERIOD = 2.4;
const SHIP_X = 9;
const MID_Y = 22;

type RGB = [number, number, number];
const PLAYER: RGB = [0.75, 0.96, 1];
const ENEMY: RGB = [1, 0.18, 0.39];
const GOLD: RGB = [1, 0.81, 0.42];
const WHITE: RGB = [1, 1, 1];
const STATUS: Record<string, RGB> = {
  burn: [1, 0.45, 0.1],
  cryo: [0.55, 0.9, 1],
  shock: [0.7, 0.8, 1.3],
  corrode: [0.5, 1, 0.35],
  void: [0.7, 0.35, 1],
  radiant: [1, 0.9, 0.5],
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** What a card does, reduced to the handful of things a vignette can show. */
export interface PreviewSpec {
  shot: Behavior;
  count: number;
  rapid: boolean;
  big: boolean;
  pierce: boolean;
  homing: boolean;
  ricochet: boolean;
  split: boolean;
  explode: boolean;
  chain: boolean;
  crit: boolean;
  knock: boolean;
  status: string | null;
  /** HDR accent for glows/explosions (weapon colour or rarity) */
  accent: RGB;
  ship: 'shield' | 'heal' | 'speed' | 'dodge' | 'magnet' | 'flare' | 'graze' | 'armor' | 'pulse' | null;
  trigger: { on: TriggerOn; do: TriggerDo } | null;
  evolved: boolean;
  curse: boolean;
  seed: number;
}

const SHIP_STAT_FX: Record<string, PreviewSpec['ship']> = {
  hull: 'armor', armor: 'armor', damageTaken: 'armor', iframes: 'armor',
  shield: 'shield', shieldRegen: 'shield', shieldDelay: 'shield',
  regen: 'heal',
  speed: 'speed', boost: 'speed', boostRegen: 'speed',
  dodges: 'dodge', dodgeCd: 'dodge',
  magnet: 'magnet', lightGain: 'magnet', luck: 'magnet', shopDiscount: 'magnet',
  grazeRadius: 'graze', grazeGain: 'graze',
  flareDur: 'flare', flareGain: 'flare',
  abilityCd: 'pulse', shockwave: 'pulse', stasis: 'pulse',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rgb(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b];
}

const RARITY_RGB: Record<string, string> = {
  common: '#b9b4ab', uncommon: '#7fe0a8', rare: '#70b8ff', epic: '#c58bff', legendary: '#ffc24a', artifact: '#ff7ad0', curse: '#ff2e63',
};

function fromParams(s: PreviewSpec, p: Partial<WeaponParams>, tags: readonly Tag[]): void {
  if ((p.count ?? 1) > 1) s.count = Math.min(5, Math.round(p.count!));
  if ((p.pierce ?? 0) > 0) s.pierce = true;
  if ((p.homing ?? 0) > 0) s.homing = true;
  if ((p.ricochet ?? 0) > 0) s.ricochet = true;
  if ((p.split ?? 0) > 0) s.split = true;
  if ((p.explode ?? 0) > 0) s.explode = true;
  if ((p.chain ?? 0) > 0) s.chain = true;
  if ((p.rate ?? 0) > 6) s.rapid = true;
  for (const st of Object.keys(STATUS)) if ((p[st as keyof WeaponParams] ?? 0) > 0) s.status = st;
  for (const t of tags) {
    if (t in STATUS && !s.status) s.status = t;
    if (t === 'pierce') s.pierce = true;
    if (t === 'homing') s.homing = true;
    if (t === 'ricochet') s.ricochet = true;
    if (t === 'split') s.split = true;
    if (t === 'chain') s.chain = true;
    if (t === 'crit') s.crit = true;
    if (t === 'rapid') s.rapid = true;
    if (t === 'area' && s.shot === 'bullet') s.explode = true;
  }
}

export function previewSpec(c: DraftCard): PreviewSpec {
  const s: PreviewSpec = {
    shot: 'bullet', count: 1, rapid: false, big: false, pierce: false, homing: false, ricochet: false, split: false,
    explode: false, chain: false, crit: false, knock: false, status: null, accent: GOLD, ship: null, trigger: null,
    evolved: false, curse: false, seed: 1,
  };
  if (c.kind === 'upgrade') {
    const d = c.def;
    s.seed = hash(d.id);
    s.accent = rgb(RARITY_RGB[d.rarity] ?? '#ffcf6a');
    s.curse = d.rarity === 'curse';
    const wp: Partial<WeaponParams> = {};
    for (const m of d.mods ?? []) {
      const ship = SHIP_STAT_FX[m.s];
      if (ship) s.ship ??= ship;
      else if (m.s === 'damage' || m.s === 'size' || m.s === 'critMul' || m.s === 'globalDamage') s.big = true;
      else if (m.s === 'rate' || m.s === 'globalRate') s.rapid = true;
      else if (m.s === 'crit') s.crit = true;
      else if (m.s === 'knock') s.knock = true;
      else if (m.s === 'count') wp.count = 1 + Math.max(1, Math.round(m.add ?? 1)) + 1;
      else (wp as Record<string, number>)[m.s] = 1;
    }
    fromParams(s, wp, d.tags);
    if (d.tags.includes('drone') || d.visual === 'drone') s.shot = 'drone';
    const t = d.triggers?.[0];
    if (t) {
      s.trigger = { on: t.on, do: t.do };
      // show the action that sets the trigger off, not just its result
      const cause: Partial<Record<TriggerOn, PreviewSpec['ship']>> = { dodge: 'dodge', graze: 'graze', boost: 'speed', flare: 'flare', pickup: 'magnet' };
      s.ship ??= cause[t.on] ?? null;
    }
    if (!s.ship && d.tags.includes('shield')) s.ship = 'shield';
    if (!s.ship && d.tags.includes('dodge')) s.ship = 'dodge';
    if (!s.ship && d.tags.includes('magnet')) s.ship = 'magnet';
    if (!s.ship && d.tags.includes('graze')) s.ship = 'graze';
    if (!s.ship && d.tags.includes('flare')) s.ship = 'flare';
  } else {
    const w = c.kind === 'weapon' ? c.def : c.weapon.def;
    s.seed = hash(w.id + c.kind);
    s.shot = w.behavior;
    s.accent = rgb(c.kind === 'evolve' && w.evolve.color ? w.evolve.color : w.color);
    fromParams(s, w.base, w.tags);
    if (c.kind === 'level') s.big = true;
    if (c.kind === 'evolve') {
      s.evolved = true;
      s.big = true;
      fromParams(s, w.evolve.mods, [w.evolve.tag]);
    }
  }
  return s;
}

/** Software light buffer with a few additive primitives. */
export class Buf {
  readonly px = new Float32Array(PV_W * PV_H * 3);
  clear(): void {
    this.px.fill(0);
  }
  add(x: number, y: number, c: RGB, k = 1): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= PV_W || iy >= PV_H) return;
    const o = (iy * PV_W + ix) * 3;
    this.px[o] = this.px[o]! + c[0] * k;
    this.px[o + 1] = this.px[o + 1]! + c[1] * k;
    this.px[o + 2] = this.px[o + 2]! + c[2] * k;
  }
  glow(x: number, y: number, r: number, c: RGB, k = 1): void {
    const R = Math.ceil(r * 2.2);
    const r2 = r * r;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        this.add(x + dx, y + dy, c, k / (1 + (d2 / r2) * 2.5));
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, k = 1): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) this.add(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, k);
  }
  ring(x: number, y: number, r: number, c: RGB, k = 1): void {
    const n = Math.max(8, Math.ceil(r * 6.5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, c, k);
    }
  }
}

function ship(b: Buf, x: number, y: number, k = 1): void {
  // the Lantern: a forward chevron with a hot core
  b.line(x - 3, y - 3, x + 3, y, PLAYER, 0.9 * k);
  b.line(x - 3, y + 3, x + 3, y, PLAYER, 0.9 * k);
  b.line(x - 3, y - 3, x - 2, y, PLAYER, 0.6 * k);
  b.line(x - 3, y + 3, x - 2, y, PLAYER, 0.6 * k);
  b.glow(x, y, 1.2, GOLD, 0.7 * k);
  b.add(x - 5, y, GOLD, 0.5 * k);
  b.add(x - 6, y, GOLD, 0.25 * k);
}

function target(b: Buf, x: number, y: number, k: number, tint: RGB = ENEMY): void {
  if (k <= 0.02) return;
  b.line(x, y - 3, x + 3, y, tint, k);
  b.line(x + 3, y, x, y + 3, tint, k);
  b.line(x, y + 3, x - 3, y, tint, k);
  b.line(x - 3, y, x, y - 3, tint, k);
  b.add(x, y, tint, k * 0.8);
}

function bolt(b: Buf, x: number, y: number, dx: number, dy: number, s: PreviewSpec, k = 1): void {
  const len = s.big ? 4 : 3;
  const l = Math.hypot(dx, dy) || 1;
  b.line(x - (dx / l) * len, y - (dy / l) * len, x, y, PLAYER, 0.9 * k);
  b.glow(x, y, s.big ? 1.3 : 0.9, s.status ? STATUS[s.status]! : PLAYER, 0.8 * k);
}

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/** Draw one frame of a card's vignette at loop time t (seconds). */
export function drawPreview(b: Buf, s: PreviewSpec, time: number): void {
  b.clear();
  const t = time % PERIOD;
  // faint parallax star field, seeded per card
  let h = s.seed;
  for (let i = 0; i < 14; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const sx = (((h & 0xffff) / 0xffff) * PV_W - time * (2 + (i % 3) * 2) + PV_W * 4) % PV_W;
    const sy = ((h >>> 16) / 0xffff) * PV_H;
    b.add(sx, sy, WHITE, 0.12 + (i % 3) * 0.08);
  }
  const accent = s.evolved ? GOLD : s.accent;
  // three targets: one centre-right, two flanking further back
  const T = [
    { x: 50, y: MID_Y, hitT: 0.55 },
    { x: 64, y: MID_Y - 11, hitT: 0.75 },
    { x: 64, y: MID_Y + 11, hitT: 0.75 },
  ];
  const killT = 1.15;
  const respawn = 1.95;
  const alive = (i: number) => (i === 0 ? t < killT || t > respawn : true);
  const tk = (i: number) => (i === 0 && t > respawn ? ease((t - respawn) / 0.35) : 1);

  // ship motion for ship-centric cards
  let sx = SHIP_X;
  let sy = MID_Y + Math.sin(time * 2.1) * 1.2;
  if (s.ship === 'dodge') {
    const d = ease((t - 0.9) / 0.15) - ease((t - 1.7) / 0.3);
    sy += d * 9;
    if (t > 0.9 && t < 1.1) for (let i = 1; i < 4; i++) ship(b, sx, sy - i * 2.5, 0.25 / i);
  }
  if (s.ship === 'speed') {
    for (let i = 0; i < 5; i++) {
      const lx = ((PV_W + 20 - ((time * 60 + i * 17) % (PV_W + 20))) | 0) - 10;
      b.line(lx, 6 + i * 8, lx + 5, 6 + i * 8, PLAYER, 0.25);
    }
    sx += Math.sin(time * 3) * 2;
  }

  // weapon visual
  const fireTimes = s.rapid ? [0.1, 0.22, 0.34, 0.46] : [0.1];
  const travel = 0.45;
  const shot = s.shot;
  if (shot === 'beam' || shot === 'rail') {
    const on = shot === 'rail' ? t > 0.35 && t < 0.6 : t > 0.2 && t < 1.1;
    if (shot === 'rail' && t < 0.35) b.glow(sx + 4, sy, 0.6 + t * 4, accent, 0.5);
    if (on) {
      const k = shot === 'rail' ? 1 - (t - 0.35) / 0.25 : 0.8 + Math.sin(time * 40) * 0.2;
      b.line(sx + 4, sy, s.pierce || shot === 'rail' ? PV_W : T[0]!.x - 3, sy, PLAYER, k);
      b.line(sx + 4, sy - 1, s.pierce || shot === 'rail' ? PV_W : T[0]!.x - 3, sy - 1, accent, k * 0.35);
      b.glow(T[0]!.x - 3, sy, 1.5, accent, k * 0.8);
    }
  } else if (shot === 'arc') {
    if (t > 0.2 && t < 0.9) {
      let px = sx + 4;
      let py = sy;
      const tx = T[0]!.x;
      for (let i = 1; i <= 6; i++) {
        const nx = sx + 4 + ((tx - sx - 4) * i) / 6;
        const ny = MID_Y + (i < 6 ? (((s.seed >> i) & 7) - 3.5) * 1.4 * Math.sin(time * 30 + i) : 0);
        b.line(px, py, nx, ny, STATUS.shock!, 0.9);
        px = nx;
        py = ny;
      }
    }
  } else if (shot === 'nova' || shot === 'pulse' || shot === 'halo') {
    const r = shot === 'halo' ? 10 : ((t * 1.4) % 1) * 46;
    if (shot === 'halo') {
      for (let i = 0; i < 6; i++) {
        const a = time * 2.5 + (i / 6) * Math.PI * 2;
        b.glow(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.85, 0.9, PLAYER, 0.9);
      }
      b.ring(sx, sy, r, accent, 0.12);
    } else {
      b.ring(sx, sy, r, PLAYER, 0.7 * (1 - r / 46));
      b.ring(sx, sy, r * 0.92, accent, 0.4 * (1 - r / 46));
    }
  } else if (shot === 'well') {
    const wx = 52;
    const r = 4 + Math.sin(time * 6) * 0.8;
    b.glow(wx, MID_Y, 2, STATUS.void!, 1);
    b.ring(wx, MID_Y, r + 3, STATUS.void!, 0.35);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + time;
      const rr = 14 - ((time * 9 + i * 3) % 12);
      b.add(wx + Math.cos(a) * rr, MID_Y + Math.sin(a) * rr * 0.8, STATUS.void!, 0.6);
    }
  } else if (shot === 'mine') {
    const mx = 34;
    b.glow(mx, MID_Y + 6, 1, (Math.floor(time * 4) & 1) === 0 ? ENEMY : accent, 0.7);
    b.line(sx, sy, mx, MID_Y + 6, PLAYER, 0.1);
  } else if (shot === 'drone') {
    for (let i = 0; i < 2; i++) {
      const a = time * 3 + i * Math.PI;
      const dx = sx + Math.cos(a) * 6;
      const dy = sy + Math.sin(a) * 5;
      b.glow(dx, dy, 0.8, PLAYER, 0.9);
      const ft = (t * 2 + i * 0.5) % 1;
      if (ft < 0.6) {
        const u = ft / 0.6;
        bolt(b, dx + (T[0]!.x - dx) * u, dy + (MID_Y - dy) * u, 1, 0, s, 0.8);
      }
    }
  } else {
    // bullets / missiles: a fan of `count` shots per volley
    const n = s.count;
    for (const ft of fireTimes) {
      const u = (t - ft) / travel;
      if (u < 0 || u > (s.pierce ? 1.5 : 1)) continue;
      for (let j = 0; j < n; j++) {
        const off = n > 1 ? (j / (n - 1) - 0.5) * 2 : 0;
        const ty = MID_Y + off * 9;
        let x = sx + 4 + (T[0]!.x - 3 - sx - 4) * u;
        let y = sy + (ty - sy) * Math.min(1, u);
        if (s.homing || shot === 'missile') {
          // curve out and back in
          y += Math.sin(u * Math.PI) * (j % 2 === 0 ? -7 : 7) * (n > 1 ? 0.6 : 1);
        }
        if (s.ricochet && u > 1) {
          x = T[0]!.x - 3 + (T[1]!.x - T[0]!.x) * (u - 1) * 2;
          y = MID_Y + (T[1]!.y - MID_Y) * (u - 1) * 2;
        }
        if (shot === 'missile') {
          for (let k = 1; k < 5; k++) b.add(x - k * 1.6, y + Math.sin(u * 9 + k) * 0.6, accent, 0.25 / k);
        }
        bolt(b, x, y, 1, 0, s, u > 1 ? 1.5 - u : 1);
      }
    }
  }

  // impact on the first target
  const hit = t > T[0]!.hitT && t < T[0]!.hitT + 0.5;
  const hk = hit ? 1 - (t - T[0]!.hitT) / 0.5 : 0;
  if (hit && shot !== 'halo' && shot !== 'well' && shot !== 'mine') {
    const hx = T[0]!.x;
    const st = s.status ? STATUS[s.status]! : accent;
    b.glow(hx, MID_Y, (s.crit ? 3 : 1.6) * (0.6 + hk), s.crit ? WHITE : st, hk * (s.crit ? 1.6 : 1));
    if (s.explode) {
      const r = (1 - hk) * 12;
      b.ring(hx, MID_Y, r, GOLD, hk);
      b.ring(hx, MID_Y, r * 0.6, PLAYER, hk * 0.6);
    }
    if (s.split) {
      for (let i = -1; i <= 1; i += 2) {
        const u = 1 - hk;
        bolt(b, hx + u * 14, MID_Y + i * u * 10, 1, i * 0.7, s, hk);
      }
    }
    if (s.chain) {
      for (const o of [T[1]!, T[2]!]) {
        const mx = (hx + o.x) / 2 + Math.sin(time * 50) * 1.5;
        const my = (MID_Y + o.y) / 2 + Math.cos(time * 43) * 1.5;
        b.line(hx, MID_Y, mx, my, STATUS.shock!, hk);
        b.line(mx, my, o.x, o.y, STATUS.shock!, hk);
      }
    }
    if (s.crit) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.line(hx + Math.cos(a) * 2, MID_Y + Math.sin(a) * 2, hx + Math.cos(a) * (3 + (1 - hk) * 6), MID_Y + Math.sin(a) * (3 + (1 - hk) * 6), WHITE, hk * 0.8);
    }
  }
  // status flicker on the struck target
  const statusOn = s.status && t > T[0]!.hitT && t < killT;

  // targets
  for (let i = 0; i < 3; i++) {
    const tg = T[i]!;
    if (!alive(i)) continue;
    let x = tg.x;
    let y = tg.y + Math.sin(time * 1.7 + i * 2) * 1;
    if (shot === 'well') {
      x += (52 - x) * 0.25 * (0.5 + Math.sin(time * 3) * 0.5);
      y += (MID_Y - y) * 0.25 * (0.5 + Math.sin(time * 3) * 0.5);
    }
    if (s.knock && i === 0 && hit) x += (1 - hk) * 4;
    const tint = i === 0 && statusOn && (Math.floor(time * 12) & 1) ? STATUS[s.status!]! : ENEMY;
    target(b, x, y, (i === 0 ? 0.95 : 0.55) * tk(i), tint);
    if (i === 0 && s.status === 'cryo' && statusOn) b.ring(x, y, 4.5, STATUS.cryo!, 0.5);
  }
  // kill burst + on-kill triggers
  if (t > killT && t < killT + 0.6) {
    const u = (t - killT) / 0.6;
    const hx = T[0]!.x;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + s.seed;
      b.add(hx + Math.cos(a) * u * 9, MID_Y + Math.sin(a) * u * 7, ENEMY, (1 - u) * 0.9);
    }
    b.glow(hx, MID_Y, 2.5 * (1 - u) + 0.5, GOLD, (1 - u) * 1.2);
    const tr = s.trigger;
    if (tr && (tr.on === 'kill' || tr.on === 'eliteKill' || tr.on === 'hit' || tr.on === 'crit' || tr.on === 'nthShot')) triggerFx(b, tr.do, hx, MID_Y, sx, sy, u, time);
  }
  // Light motes drift to the ship after the kill
  if (t > killT + 0.1 && t < respawn) {
    const u = ease((t - killT - 0.1) / (s.ship === 'magnet' ? 0.45 : 0.75));
    for (let i = 0; i < (s.ship === 'magnet' ? 6 : 3); i++) {
      const ox = T[0]!.x + Math.cos(i * 2.1) * 4;
      const oy = MID_Y + Math.sin(i * 2.1) * 4;
      if (u < 1) b.glow(ox + (sx - ox) * u, oy + (sy - oy) * u, 0.6, GOLD, 0.9);
    }
    if (s.ship === 'magnet') b.ring(sx, sy, 6 + Math.sin(time * 8), GOLD, 0.25);
  }

  // ship-centric effects
  const se = s.ship;
  if (se === 'shield' || se === 'armor') {
    const k = se === 'shield' ? 0.45 + Math.sin(time * 5) * 0.15 : 0.35;
    b.ring(sx, sy, se === 'shield' ? 6 : 5, se === 'shield' ? PLAYER : GOLD, k);
    if (se === 'armor') for (let i = -1; i <= 1; i += 2) b.line(sx - 2, sy + i * 5, sx + 2, sy + i * 5, GOLD, 0.6);
  }
  if (se === 'heal' && t > 1 && t < 2) {
    const u = (t - 1) / 1;
    const cy = sy - 5 - u * 4;
    b.line(sx - 1, cy, sx + 1, cy, [0.5, 1, 0.6], 1 - u);
    b.line(sx, cy - 1, sx, cy + 1, [0.5, 1, 0.6], 1 - u);
  }
  if (se === 'flare') b.glow(sx, sy, 3 + Math.sin(time * 4), GOLD, 0.45);
  if (se === 'pulse' && t > 1.3 && t < 2) b.ring(sx, sy, (t - 1.3) * 40, PLAYER, 1 - (t - 1.3) / 0.7);
  if (se === 'graze' || (s.trigger && (s.trigger.on === 'graze' || s.trigger.on === 'dodge'))) {
    // an enemy round slides past the hull and throws sparks
    const u = ((t + 0.3) % PERIOD) / 1.2;
    if (u < 1) {
      const ex = PV_W - u * (PV_W + 6);
      const ey = sy - 4;
      b.glow(ex, ey, 0.9, ENEMY, 0.9);
      if (Math.abs(ex - sx) < 4) for (let i = 0; i < 3; i++) b.add(sx + i - 1, sy - 3 - i, GOLD, 0.9);
    }
  }
  if (s.trigger && (s.trigger.on === 'hurt' || s.trigger.on === 'shieldBreak' || s.trigger.on === 'lowHp' || s.trigger.on === 'boost' || s.trigger.on === 'flare' || s.trigger.on === 'dodge' || s.trigger.on === 'graze' || s.trigger.on === 'pickup' || s.trigger.on === 'waveStart' || s.trigger.on === 'secondary') && t > 1.4 && t < 2.1)
    triggerFx(b, s.trigger.do, sx, sy, sx, sy, (t - 1.4) / 0.7, time);

  ship(b, sx, sy, 1);
  if (s.evolved) b.ring(sx, sy, 5 + ((time * 6) % 3), GOLD, 0.3);
  if (s.curse) for (let i = 0; i < 3; i++) b.add((s.seed * (i + 3) + time * 30) % PV_W, (s.seed >> (i * 3)) % PV_H, ENEMY, 0.5);
}

function triggerFx(b: Buf, d: TriggerDo, x: number, y: number, sx: number, sy: number, u: number, time: number): void {
  const k = 1 - u;
  switch (d) {
    case 'nova':
    case 'freeze':
    case 'pull':
      b.ring(x, y, u * 16, d === 'freeze' ? STATUS.cryo! : d === 'pull' ? STATUS.void! : GOLD, k);
      break;
    case 'chain':
      b.line(x, y, 64, y - 11, STATUS.shock!, k);
      b.line(x, y, 64, y + 11, STATUS.shock!, k);
      break;
    case 'missiles':
      for (let i = -1; i <= 1; i++) b.glow(sx + u * 40, sy + Math.sin(u * Math.PI) * i * 10, 0.8, GOLD, k);
      break;
    case 'shards':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.line(x + Math.cos(a) * u * 6, y + Math.sin(a) * u * 6, x + Math.cos(a) * u * 10, y + Math.sin(a) * u * 10, PLAYER, k);
      }
      break;
    case 'shield':
    case 'buff':
      b.ring(sx, sy, 6, d === 'shield' ? PLAYER : GOLD, k * 0.9);
      break;
    case 'heal':
      b.line(sx - 1, sy - 6, sx + 1, sy - 6, [0.5, 1, 0.6], k);
      b.line(sx, sy - 7, sx, sy - 5, [0.5, 1, 0.6], k);
      break;
    case 'motes':
    case 'lumen':
    case 'reload':
      for (let i = 0; i < 4; i++) b.glow(x + (sx - x) * u + i, y + (sy - y) * u + Math.sin(i + time) * 2, 0.6, GOLD, k);
      break;
    case 'mine':
      b.glow(x, y + 4, 1, ENEMY, (Math.floor(time * 6) & 1) * k);
      break;
    case 'burnAura':
      b.ring(sx, sy, 7, STATUS.burn!, k * 0.8);
      break;
    case 'decoy':
      ship(b, sx + 8, sy - 6, k * 0.4);
      break;
  }
}

/** Resolve the light buffer to dithered RGBA (ink background). */
export function resolve(b: Buf, out: Uint8ClampedArray, tint: RGB): void {
  const px = b.px;
  for (let y = 0; y < PV_H; y++)
    for (let x = 0; x < PV_W; x++) {
      const i = y * PV_W + x;
      const th = BAYER4[(y & 3) * 4 + (x & 3)]!;
      // faint rarity floor glow toward the bottom edge
      const floor = Math.max(0, (y - PV_H * 0.7) / (PV_H * 0.3)) * 0.045;
      const o = i * 4;
      for (let c = 0; c < 3; c++) {
        const v = Math.min(1, px[i * 3 + c]! + floor * tint[c]!);
        const q = Math.floor(v * 3 + th) / 3;
        out[o + c] = Math.min(255, (c === 0 ? 7 : c === 1 ? 6 : 11) + q * 248);
      }
      out[o + 3] = 255;
    }
}

/**
 * Mount looping previews on the given canvases. Each loop stops by itself
 * once its canvas leaves the DOM. With reduced motion, a single key frame
 * (the impact) is drawn instead of an animation.
 */
export function mountPreviews(canvases: HTMLCanvasElement[], cards: DraftCard[], reducedMotion: boolean, phases?: number[]): void {
  const items = canvases.map((cv, i) => {
    cv.width = PV_W;
    cv.height = PV_H;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(PV_W, PV_H);
    const spec = previewSpec(cards[i]!);
    return { cv, ctx, img, spec, buf: new Buf(), phase: (phases?.[i] ?? i * 0.37) % PERIOD };
  });
  const frame = (time: number) => {
    for (const it of items) {
      drawPreview(it.buf, it.spec, time + it.phase);
      resolve(it.buf, it.img.data, it.spec.accent);
      it.ctx.putImageData(it.img, 0, 0);
    }
  };
  if (reducedMotion) {
    frame(0.62);
    return;
  }
  const t0 = performance.now();
  let last = 0;
  const loop = (now: number) => {
    if (!items.some((it) => it.cv.isConnected)) return;
    // 30 fps stepping matches the UI's stepped animations and halves the cost
    if (now - last >= 33) {
      last = now;
      frame((now - t0) / 1000);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
