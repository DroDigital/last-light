import type { Controls } from './player';
import type { World } from './world';
import { aim } from './weapons';

/**
 * Replay recording. The simulation is deterministic given (seed, build, per-tick
 * controls), so a replay is just the controls stream. Controls are quantized
 * *before* the sim consumes them, so the recorded stream is bit-identical to
 * what the live game simulated and replays reproduce exactly.
 *
 * Layout per tick (18 bytes): Int16 mx,my,mz (1/32767), Float32 yaw, Float32
 * pitch (radians, rounded to 1e-6), Uint16 button bits, Uint8 aim-assist
 * strength (/255), Uint8 aim-assist cone (/500 rad). Aim assist feeds the sim
 * (it bends the aim direction), so it is part of the input.
 */
const STRIDE = 18;
const B_FIRE1 = 1;
const B_FIRE2 = 2;
const B_BOOST = 4;
const B_DODGE = 8;
const B_AB1 = 16;
const B_AB2 = 32;
const B_FLARE = 64;
const B_LEVEL = 128;
const B_GUARD = 256;

const q16 = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
const qAng = (v: number) => Math.round(v * 1e6) / 1e6;

export class ReplayRecorder {
  private buf: DataView;
  private bytes: Uint8Array;
  ticks = 0;

  constructor(capacityTicks = 60 * 60 * 10) {
    this.bytes = new Uint8Array(capacityTicks * STRIDE);
    this.buf = new DataView(this.bytes.buffer);
  }

  /** Quantize the controls in place and append them. Call once per sim tick. */
  capture(c: Controls): void {
    c.mx = q16(c.mx) / 32767;
    c.my = q16(c.my) / 32767;
    c.mz = q16(c.mz) / 32767;
    c.yaw = Math.fround(qAng(c.yaw));
    c.pitch = Math.fround(qAng(c.pitch));
    if ((this.ticks + 1) * STRIDE > this.bytes.length) this.grow();
    const o = this.ticks * STRIDE;
    const v = this.buf;
    v.setInt16(o, Math.round(c.mx * 32767), true);
    v.setInt16(o + 2, Math.round(c.my * 32767), true);
    v.setInt16(o + 4, Math.round(c.mz * 32767), true);
    v.setFloat32(o + 6, c.yaw, true);
    v.setFloat32(o + 10, c.pitch, true);
    v.setUint16(o + 14, buttons(c), true);
    aim.strength = Math.round(Math.max(0, Math.min(1, aim.strength)) * 255) / 255;
    aim.cone = Math.round(Math.max(0, Math.min(0.5, aim.cone)) * 500) / 500;
    v.setUint8(o + 16, Math.round(aim.strength * 255));
    v.setUint8(o + 17, Math.round(aim.cone * 500));
    this.ticks++;
  }

  private grow(): void {
    const next = new Uint8Array(this.bytes.length * 2);
    next.set(this.bytes);
    this.bytes = next;
    this.buf = new DataView(next.buffer);
  }

  /** Read tick i back into out. */
  read(i: number, out: Controls): Controls {
    const o = i * STRIDE;
    const v = this.buf;
    out.mx = v.getInt16(o, true) / 32767;
    out.my = v.getInt16(o + 2, true) / 32767;
    out.mz = v.getInt16(o + 4, true) / 32767;
    out.yaw = v.getFloat32(o + 6, true);
    out.pitch = v.getFloat32(o + 10, true);
    const b = v.getUint16(o + 14, true);
    out.fire1 = !!(b & B_FIRE1);
    out.fire2 = !!(b & B_FIRE2);
    out.boost = !!(b & B_BOOST);
    out.dodge = !!(b & B_DODGE);
    out.ability1 = !!(b & B_AB1);
    out.ability2 = !!(b & B_AB2);
    out.flare = !!(b & B_FLARE);
    out.autoLevel = !!(b & B_LEVEL);
    out.guard = !!(b & B_GUARD);
    aim.strength = v.getUint8(o + 16) / 255;
    aim.cone = v.getUint8(o + 17) / 500;
    return out;
  }

  reset(): void {
    this.ticks = 0;
  }
}

function buttons(c: Controls): number {
  return (
    (c.fire1 ? B_FIRE1 : 0) |
    (c.fire2 ? B_FIRE2 : 0) |
    (c.boost ? B_BOOST : 0) |
    (c.dodge ? B_DODGE : 0) |
    (c.ability1 ? B_AB1 : 0) |
    (c.ability2 ? B_AB2 : 0) |
    (c.flare ? B_FLARE : 0) |
    (c.autoLevel ? B_LEVEL : 0) |
    (c.guard ? B_GUARD : 0)
  );
}

/** Order-sensitive hash of everything gameplay-relevant in a world. */
export function hashWorld(w: World): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    // hash the float's exact bits
    f64[0] = n;
    h = Math.imul(h ^ u32[0]!, 16777619) >>> 0;
    h = Math.imul(h ^ u32[1]!, 16777619) >>> 0;
  };
  const pl = w.player;
  for (const n of [pl.pos.x, pl.pos.y, pl.pos.z, pl.quat.x, pl.quat.y, pl.quat.z, pl.quat.w, pl.hull, pl.shield, pl.lumen, pl.light]) mix(n);
  mix(w.stats.kills);
  mix(w.enemies.length);
  for (const e of w.enemies) {
    mix(e.pos.x);
    mix(e.pos.y);
    mix(e.pos.z);
    mix(e.hp);
  }
  mix(w.proj.n);
  for (let i = 0; i < w.proj.n; i++) {
    mix(w.proj.x[i]!);
    mix(w.proj.z[i]!);
  }
  mix(w.eproj.n);
  mix(w.motes.n);
  for (const n of w.rng.state()) mix(n);
  return h.toString(16).padStart(8, '0');
}
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
