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
  /** held: raise the guard (a tap at the right moment parries) */
  guard: boolean;
  autoLevel: boolean;
}

export const emptyControls = (): Controls => ({
  mx: 0, my: 0, mz: 0, yaw: 0, pitch: 0, fire1: false, fire2: false, boost: false, dodge: false,
  ability1: false, ability2: false, flare: false, guard: false, autoLevel: true,
});

/** Guard tuning. A shot that lands within PARRY_WINDOW of raising the guard is reflected. */
export const GUARD = {
  /** seconds after raising the guard that count as a perfect parry */
  parryWindow: 0.16,
  /** longest the guard can stay up */
  maxHold: 1.1,
  /** lockout after the guard drops (a perfect parry clears it) */
  cooldown: 0.5,
  /** damage a plain (late) block lets through */
  blockLeak: 0.3,
  /** movement speed while guarding */
  moveMul: 0.65,
};

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
  wingCd: Record<string, number> = { primary: 0, secondary: 0 };
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
  /** distance to the locked target (guns converge there); 90 when nothing is locked */
  aimDist = 90;
  /** class keystones: Unbreakable recharge, Slipstream damage window */
  lastStandCd = 0;
  slipT = 0;
  recoil = 0;
  thrust = 0;
  buffT = 0; // threadneedle
  critBuff = false; // wraith
  hullDamageTaken = 0;
  lowHpFired = false;
  boostTrig = 0;
  firingT = 0; // time since last primary shot
  radius = 1.1;
  /** seconds since the guard went up; -1 while it is down */
  guardT = -1;
  /** lockout before the guard can be raised again */
  guardCd = 0;
  private guardHeld = false;
  /** visual flash after a perfect parry */
  parryFlash = 0;
  /** Second Wind (emergency shield) and Capacitor Burst cooldowns */
  emergencyCd = 0;
  capBurstCd = 0;

  get guarding(): boolean {
    return this.guardT >= 0;
  }

  /** Highest the shield can go: Overcharge Cells let pickups and kills push it past max. */
  get shieldCap(): number {
    return this.maxShield * (this.world.build.flags.has('overshield') ? 1.5 : 1);
  }

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
    this.guardT = -1;
    this.guardCd = 0;
    this.parryFlash = 0;
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
    this.updateGuard(c, dt);
    const maxSpeed = 46 * s.speed * (this.slowT > 0 ? 0.6 : 1) * (this.guardT >= 0 ? GUARD.moveMul : 1);
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
    if (this.lastStandCd > 0) this.lastStandCd -= dt;
    if (this.slipT > 0) this.slipT -= dt;
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
    // overcharge above max bleeds away; nothing else may exceed the cap
    if (this.shield > this.maxShield) this.shield = Math.max(this.maxShield, Math.min(this.shieldCap, this.shield - 6 * dt));
    if (this.hull > this.maxHull) this.hull = this.maxHull;
    if (this.emergencyCd > 0) this.emergencyCd -= dt;
    if (this.capBurstCd > 0) this.capBurstCd -= dt;
    if (this.parryFlash > 0) this.parryFlash -= dt;

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

  /**
   * Guard: pressing raises it (edge-triggered, so holding the key never
   * re-arms the parry window). It drops on release or after GUARD.maxHold,
   * then locks out for GUARD.cooldown. Dodging cancels it.
   */
  private updateGuard(c: Controls, dt: number): void {
    const pressed = c.guard && !this.guardHeld;
    this.guardHeld = c.guard;
    if (this.guardCd > 0) this.guardCd -= dt;
    if (this.guardT >= 0) {
      this.guardT += dt;
      if (!c.guard || this.guardT > GUARD.maxHold || this.dodgeT > 0) this.dropGuard();
    } else if (pressed && this.guardCd <= 0 && this.dodgeT <= 0) {
      this.guardT = 0;
      this.world.events.emit('guard', { up: true, x: this.pos.x, y: this.pos.y, z: this.pos.z });
    }
  }

  dropGuard(): void {
    if (this.guardT < 0) return;
    this.guardT = -1;
    this.guardCd = GUARD.cooldown;
    this.world.events.emit('guard', { up: false, x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** True while a hit landing now would be a perfect parry. */
  parryOpen(): boolean {
    const win = GUARD.parryWindow * (this.world.build.flags.has('riposte') ? 1.5 : 1);
    return this.guardT >= 0 && this.guardT <= win;
  }

  /** Damage multiplier from player buffs. */
  damageMul(): number {
    const w = this.world;
    let m = 1;
    if (this.flareT > 0) m *= 1.5;
    if (this.buffT > 0) m *= 1.3;
    if (w.build.flags.has('glassStar') && this.shield >= this.maxShield - 0.5 && this.maxShield > 0) m *= 2;
    if (w.build.flags.has('chargedShield') && this.maxShield > 0 && this.shield >= this.maxShield * 0.5) m *= 1.15;
    if (this.lowHpFired) for (const t of w.build.triggers) if (t.on === 'lowHp' && t.do === 'buff') m *= 1 + t.p;
    if (w.build.flags.has('emberHull')) m *= 1 + this.heat * 0.6;
    if (this.slipT > 0 && w.build.flags.has('stSlipstream')) m *= 1.3;
    if (w.build.flags.has('vgIronWill')) m *= 1 + 0.5 * this.missingHull();
    return m;
  }

  /** 0 at full hull, 1 at none. */
  missingHull(): number {
    const max = this.maxHull;
    return max > 0 ? Math.max(0, Math.min(1, 1 - this.hull / max)) : 0;
  }
}
