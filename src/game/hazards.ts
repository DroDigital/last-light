import { Vector3 } from 'three';
import type { World } from './world';
import type { SectorDef } from '../data/world';
import { ringBurst } from './ai';
import { raySphere } from './world';

/**
 * Act II environment hazards. Each Deep sector has one, running through every
 * fight there (at reduced pressure during the boss). All of them telegraph.
 */
export type HazardKind = NonNullable<SectorDef['hazard']>;

export const HAZARD_INFO: Record<HazardKind, { name: string; desc: string }> = {
  storms: { name: 'Ion storms', desc: 'Strike zones flare up where you are heading, then detonate.' },
  gravity: { name: 'Gravity well', desc: 'The black hole at the centre pulls you in. Its edge burns.' },
  jets: { name: 'Quasar jets', desc: 'Two jets sweep the arena. Their warm-up line shows where they will be.' },
  pulses: { name: 'Magnetic pulses', desc: 'The field throws a ring of iron and shoves you outward.' },
  rifts: { name: 'Void rifts', desc: 'Rifts tear open near you and spill out hostiles.' },
};

const _a = new Vector3();
const _b = new Vector3();
const JET_AXIS = new Vector3(0.25, 1, 0.1).normalize();

export class Hazard {
  t = 3;
  phase = 0;
  /** quasar jets: current direction, on/warm state */
  jetDir = new Vector3(1, 0, 0);
  jetOn = false;
  jetWarm = 0;
  /** gravity: radius of the burning horizon */
  readonly horizon = 13;

  constructor(
    readonly kind: HazardKind,
    private pressure: number,
    private spawnRift: (x: number, y: number, z: number) => void,
  ) {}

  update(w: World, dt: number): void {
    if (!w.anyAlive()) return;
    this.t -= dt * this.pressure;
    // continuous hazards act on every ship; periodic ones aim at the nearest
    if (this.kind === 'gravity' || this.kind === 'jets') {
      const fire = this.kind === 'gravity' ? this.t <= 0 : false;
      for (const p of w.players) if (p.alive) w.withPlayer(p, () => this.tick(w, dt, fire));
      if (fire) this.t = 0.5;
      if (this.kind === 'jets') this.phase += dt;
      return;
    }
    this.tick(w, dt, false);
  }

  private tick(w: World, dt: number, gravityBurn: boolean): void {
    const pl = w.player;
    switch (this.kind) {
      case 'storms': {
        if (this.t > 0) return;
        this.t = 3.5 + w.rng.next() * 2;
        const n = 1 + (w.rng.chance(0.4) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          _a.copy(pl.pos).addScaledVector(pl.vel, 1.1).add(_b.set(w.rng.range(-14, 14), w.rng.range(-6, 6), w.rng.range(-14, 14)));
          const x = _a.x;
          const y = _a.y;
          const z = _a.z;
          w.addTelegraph({ kind: 'sphere', ax: x, ay: y, az: z, bx: 0, by: 0, bz: 0, radius: 11, dur: 1.5, owner: -2 });
          w.later(1.5, () => {
            w.explode(x, y, z, 11, 22, -1, { enemy: true, color: [1, 0.55, 0.3] });
            ringBurst(w, x, y, z, 8, 24, 8, 2, w.time);
          });
        }
        return;
      }
      case 'gravity': {
        // gentle, constant pull toward the singularity at the arena centre
        _a.copy(pl.pos);
        const d = _a.length() || 1;
        pl.vel.addScaledVector(_a, (-6 * this.pressure * dt) / d);
        if (d < this.horizon + pl.radius && gravityBurn) w.hurtPlayer(9, 'Event horizon');
        return;
      }
      case 'jets': {
        // cycle: 1.6 s warm-up line, 7 s sweeping, 4 s rest (phase advanced once per tick by update)
        const cycle = this.phase % 12.6;
        if (pl === w.p1 || !w.p1.alive) this.jetDir.applyAxisAngle(JET_AXIS, dt * 0.16 * this.pressure);
        this.jetWarm = cycle < 1.6 ? cycle / 1.6 : 0;
        this.jetOn = cycle >= 1.6 && cycle < 8.6;
        const len = w.arenaRadius * 1.25;
        for (const s of [1, -1]) {
          const dx = this.jetDir.x * s;
          const dy = this.jetDir.y * s;
          const dz = this.jetDir.z * s;
          if (this.jetWarm > 0) {
            w.telegraphs.push({ kind: 'line', ax: 0, ay: 0, az: 0, bx: dx * len, by: dy * len, bz: dz * len, radius: 3, t: this.jetWarm * 0.98, dur: 1, owner: -3 });
          } else if (this.jetOn) {
            w.beams.push({ ax: 0, ay: 0, az: 0, bx: dx * len, by: dy * len, bz: dz * len, width: 3.2, r: 0.6, g: 0.85, b: 1.2, enemy: true });
            const hit = raySphere(0, 0, 0, dx, dy, dz, pl.pos.x, pl.pos.y, pl.pos.z, pl.radius + 1.6);
            if (hit >= 0 && hit < len) w.hurtPlayerBeam(18, 'Quasar jet');
          }
        }
        return;
      }
      case 'pulses': {
        if (this.t > 0) return;
        this.t = 7 + w.rng.next() * 2;
        w.addTelegraph({ kind: 'sphere', ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, radius: 20, dur: 1.2, owner: -4 });
        w.later(1.2, () => {
          ringBurst(w, 0, 0, 0, 28, 34, 9, 1, w.time, _b.set(0, 1, 0));
          ringBurst(w, 0, 0, 0, 20, 26, 9, 2, w.time + 0.3);
          const d = pl.pos.length() || 1;
          if (d < 140) pl.vel.addScaledVector(_a.copy(pl.pos).multiplyScalar(1 / d), 55);
          w.events.emit('explosion', { x: 0, y: 0, z: 0, radius: 22, r: 0.5, g: 1, b: 0.9, enemy: true });
        });
        return;
      }
      case 'rifts': {
        if (this.t > 0) return;
        this.t = 9 + w.rng.next() * 3;
        const a = w.rng.next() * Math.PI * 2;
        _a.set(Math.cos(a) * 40, w.rng.range(-10, 10), Math.sin(a) * 40).add(pl.pos);
        const x = _a.x;
        const y = _a.y;
        const z = _a.z;
        w.addTelegraph({ kind: 'sphere', ax: x, ay: y, az: z, bx: 0, by: 0, bz: 0, radius: 7, dur: 1.4, owner: -5 });
        w.later(1.4, () => {
          w.events.emit('explosion', { x, y, z, radius: 8, r: 0.6, g: 0.9, b: 0.5, enemy: false });
          this.spawnRift(x, y, z);
        });
        return;
      }
    }
  }
}
