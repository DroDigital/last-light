import { Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import type { World } from './world';

export interface Controls {
  mx: number;
  my: number;
  mz: number;
  yaw: number; // radians this tick
  pitch: number;
  fire1: boolean;
  fire2: boolean;
  boost: boolean;
  dodge: boolean;
  ability1: boolean;
  ability2: boolean;
  flare: boolean;
  autoLevel: boolean;
}

export const emptyControls = (): Controls => ({
  mx: 0, my: 0, mz: 0, yaw: 0, pitch: 0, fire1: false, fire2: false, boost: false, dodge: false,
  ability1: false, ability2: false, flare: false, autoLevel: true,
});

const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _t = new Vector3();
const _q = new Quaternion();
const AX_Y = new Vector3(0, 1, 0);
const AX_X = new Vector3(1, 0, 0);
const AX_Z = new Vector3(0, 0, 1);

/** Local co-op: up to four pilots (P1 + three drop-in wingmen). */
export const MAX_PILOTS = 4;
/** Per-pilot colour for P2..P4 (index = slot), HUD hex and linear tint. P1 uses the hull accent. */
export const PILOT_HEX = ['#f3eee2', '#7fe0a8', '#ffc46a', '#c49aff'] as const;
export const PILOT_TINT: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [0.5, 1, 0.75],
  [1, 0.78, 0.42],
  [0.78, 0.6, 1],
];

export class Player {
  /** co-op seat: 0 = P1, 1..3 = P2..P4 */
  slot = 0;
  /** a wingman's own cooldowns on the shared primary/secondary */
  wingCd = { primary: 0, secondary: 0 };
  /** seconds a partner has hovered beside this pilot while it is down */
  reviveT = 0;
  pos = new Vector3();
  prev = new Vector3();
  vel = new Vector3();
  quat = new Quaternion();
  prevQuat = new Quaternion();
  hull = 100;
  shield = 50;
  shieldDelayT = 0;
  boostEnergy = 1;
  boosting = false;
  dodgeCharges = 2;
  dodgeRecharge = 0;
  dodgeT = 0;
  dodgeDir = new Vector3();
  roll = 0; // visual barrel roll angle
  bank = 0; // visual bank from strafing
  iframeT = 0;
  hurtT = 0;
  lumen = 0;
  flareT = 0;
  light = 0;
  lightTotal = 0;
  heat = 0;
  shockCd = 0;
  stasisCd = 0;
  stasisT = 0;
  /** slowed by a Frostbound aura */
  slowT = 0;
  alive = true;
  deathCause = '';
  aimDir = new Vector3(0, 0, -1);
  aimTarget = -1;
  recoil = 0;
  thrust = 0;
  buffT = 0; // threadneedle
  critBuff = false; // wraith
  hullDamageTaken = 0;
  lowHpFired = false;
  boostTrig = 0;
  firingT = 0; // time since last primary shot
  radius = 1.1;

  reset(w: World): void {
    const s = w.build.ship;
    this.pos.set(0, 0, 60);
    this.prev.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.quat.identity();
    this.prevQuat.identity();
    this.hull = s.hull;
    this.shield = s.shield;
    this.dodgeCharges = s.dodges;
    this.alive = true;
    this.lumen = 0;
    this.flareT = 0;
  }

  get maxHull(): number {
    return this.world.build.ship.hull;
  }
  get maxShield(): number {
    return this.world.build.ship.shield;
  }

  constructor(private world: World) {}

  forward(out: Vector3): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }
  right(out: Vector3): Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }
  up(out: Vector3): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  update(c: Controls, dt: number): void {
    const w = this.world;
    const s = w.build.ship;
    this.prev.copy(this.pos);
    this.prevQuat.copy(this.quat);
    if (!this.alive) {
      this.vel.multiplyScalar(0.97);
      this.pos.addScaledVector(this.vel, dt);
      return;
    }

    // --- rotation: local yaw/pitch, auto-level roll toward world up
    _q.setFromAxisAngle(AX_Y, -c.yaw);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(AX_X, -c.pitch);
    this.quat.multiply(_q);
    if (c.autoLevel) {
      this.right(_r);
      const err = Math.asin(clamp(_r.y, -1, 1));
      _q.setFromAxisAngle(AX_Z, -err * Math.min(1, dt * 3.5));
      this.quat.multiply(_q);
    }
    this.quat.normalize();

    // --- translation
    this.forward(_f);
    this.right(_r);
    this.up(_u);
    const maxSpeed = 46 * s.speed * (this.slowT > 0 ? 0.6 : 1);
    const boostCap = s.boost;
    const wantBoost = c.boost && this.boostEnergy > 0.02;
    this.boosting = wantBoost;
    if (wantBoost) {
      this.boostEnergy = Math.max(0, this.boostEnergy - (dt / (2.6 * boostCap)));
      this.boostTrig += dt;
    } else {
      this.boostEnergy = Math.min(1, this.boostEnergy + (dt * 0.32 * s.boostRegen) / boostCap);
    }
    const fwdIn = c.mz >= 0 ? c.mz : c.mz * 0.6;
    _t.set(0, 0, 0)
      .addScaledVector(_f, fwdIn * maxSpeed)
      .addScaledVector(_r, c.mx * maxSpeed * 0.85)
      .addScaledVector(_u, c.my * maxSpeed * 0.7);
    if (wantBoost) _t.addScaledVector(_f, maxSpeed * 1.6);
    const k = this.dodgeT > 0 ? 1.5 : 7;
    this.vel.x = damp(this.vel.x, _t.x, k, dt);
    this.vel.y = damp(this.vel.y, _t.y, k, dt);
    this.vel.z = damp(this.vel.z, _t.z, k, dt);
    this.thrust = damp(this.thrust, wantBoost ? 1.6 : Math.max(0, fwdIn), 8, dt);
    this.bank = damp(this.bank, -c.mx * 0.45 - c.yaw * 6, 6, dt);

    // --- dodge roll
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      this.roll += dt * 18 * Math.sign(this.dodgeDir.dot(_r) || 1);
      if (this.dodgeT <= 0) this.roll = 0;
    }
    if (this.dodgeCharges < s.dodges) {
      this.dodgeRecharge += dt;
      if (this.dodgeRecharge >= s.dodgeCd) {
        this.dodgeRecharge = 0;
        this.dodgeCharges++;
      }
    }
    if (c.dodge && this.dodgeCharges > 0 && this.dodgeT <= 0) {
      this.dodgeCharges--;
      if (Math.abs(c.mx) + Math.abs(c.my) > 0.1) {
        this.dodgeDir.set(0, 0, 0).addScaledVector(_r, c.mx).addScaledVector(_u, c.my).normalize();
      } else if (c.mz < -0.1) this.dodgeDir.copy(_f).negate();
      else this.dodgeDir.copy(_r);
      this.vel.addScaledVector(this.dodgeDir, 85);
      this.dodgeT = 0.38;
      this.iframeT = Math.max(this.iframeT, s.iframes);
      w.onDodge();
    }

    this.pos.addScaledVector(this.vel, dt);

    // --- soft arena boundary
    const R = w.arenaRadius;
    const d = this.pos.length();
    if (d > R) {
      _t.copy(this.pos).multiplyScalar(1 / d);
      this.vel.addScaledVector(_t, -(d - R) * 6 * dt * 10);
      if (d > R + 40) this.pos.copy(_t).multiplyScalar(R + 40);
    }

    // --- timers
    if (this.iframeT > 0) this.iframeT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.buffT > 0) this.buffT -= dt;
    this.recoil = damp(this.recoil, 0, 14, dt);
    this.firingT += dt;

    // shields
    if (this.shieldDelayT > 0) this.shieldDelayT -= dt;
    else if (this.shield < this.maxShield) {
      let regen = s.shieldRegen;
      if (w.build.flags.has('bulwark') && this.firingT > 0.6) regen *= 2;
      this.shield = Math.min(this.maxShield, this.shield + regen * dt);
    }
    if (s.regen !== 0) {
      this.hull = Math.min(this.maxHull, this.hull + s.regen * dt);
      if (this.hull <= 0) w.killPlayer('Blood Light');
    }
    if (this.shield > this.maxShield) this.shield = this.maxShield;
    if (this.hull > this.maxHull) this.hull = this.maxHull;

    // abilities
    if (this.shockCd > 0) this.shockCd -= dt;
    if (this.stasisCd > 0) this.stasisCd -= dt;
    if (this.stasisT > 0) this.stasisT -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (c.ability1 && this.shockCd <= 0) {
      this.shockCd = 9 * s.abilityCd;
      w.shockwave();
    }
    if (c.ability2 && this.stasisCd <= 0) {
      this.stasisCd = 14 * s.abilityCd;
      this.stasisT = 3 * s.stasis;
      w.events.emit('ability', { kind: 'stasis' });
    }

    // flare
    if (this.flareT > 0) {
      this.flareT -= dt;
      if (this.flareT <= 0) {
        this.flareT = 0;
        w.events.emit('flare', { on: false });
      }
    } else if (c.flare && this.lumen >= 100) {
      this.lumen = 0;
      this.flareT = s.flareDur;
      w.onFlare();
    }

    // ember heat
    if (w.build.flags.has('emberHull')) {
      if (this.firingT < 0.15) this.heat = Math.min(1, this.heat + dt * 0.12 * s.heatGain);
      else this.heat = Math.max(0, this.heat - dt * 0.25);
      if (this.heat >= 1) {
        this.heat = 0.3;
        w.explode(this.pos.x, this.pos.y, this.pos.z, 22, 60 * s.globalDamage, -1, { color: [1, 0.5, 0.2], noSelf: true });
      }
    }

    // low hp trigger
    if (this.hull / this.maxHull < 0.3) {
      if (!this.lowHpFired) {
        this.lowHpFired = true;
        w.fireTriggers('lowHp', this.pos.x, this.pos.y, this.pos.z, 0);
      }
    } else this.lowHpFired = false;
  }

  /** Damage multiplier from player buffs. */
  damageMul(): number {
    const w = this.world;
    let m = 1;
    if (this.flareT > 0) m *= 1.5;
    if (this.buffT > 0) m *= 1.3;
    if (w.build.flags.has('glassStar') && this.shield >= this.maxShield - 0.5 && this.maxShield > 0) m *= 2;
    if (this.lowHpFired) for (const t of w.build.triggers) if (t.on === 'lowHp' && t.do === 'buff') m *= 1 + t.p;
    if (w.build.flags.has('emberHull')) m *= 1 + this.heat * 0.6;
    return m;
  }
}
