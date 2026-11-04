import * as THREE from 'three';
import type { World } from '../game/world';
import { Pipeline } from './pipeline';
import { Particles, Streaks, Bullets, Telegraphs } from './fx';
import { Space } from './space';
import { buildEnemyMesh, buildPlayerShip, type MeshKind } from './meshes';
import { makeHullMaterial } from './materials';
import { haloPositions } from '../game/weapons';
import { hexToRgb } from '../core/math';
import { fxRng } from '../core/rng';
import { EdgeBatch } from './edges';

const KINDS: MeshKind[] = [
  'hushSpike', 'hushDart', 'hushBlob', 'hushEye', 'salvBox', 'salvRam', 'salvGun', 'salvHauler', 'salvTurret',
  'choirShard', 'choirPrism', 'choirHalo', 'choirSeraph', 'asteroid', 'plate', 'segment', 'bossCore',
];

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _halo: THREE.Vector3[] = [];
// frame scratch (the view runs every frame: no allocations in sync paths)
const _q2 = new THREE.Quaternion();
const _ux = new THREE.Vector3();
const _uy = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _rgbCache = new Map<string, [number, number, number]>();
const WHITE: [number, number, number] = [1, 1, 1];
function rgb(hex: string): [number, number, number] {
  let c = _rgbCache.get(hex);
  if (!c) _rgbCache.set(hex, (c = hexToRgb(hex)));
  return c;
}

class InstancedKind {
  mesh: THREE.InstancedMesh;
  fx: THREE.InstancedBufferAttribute;
  count = 0;
  /** vector edge lines sharing this kind's instance data (style C) */
  edges: EdgeBatch | null = null;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.fx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFx', this.fx);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.layers.enable(1); // native-res depth prepass for hidden-line edges
  }
  withEdges(view: View, opts: { haloGain?: number; coreGain?: number } = {}): this {
    this.edges = new EdgeBatch(this.mesh.geometry, { matrix: this.mesh.instanceMatrix, color: this.mesh.instanceColor!, fx: this.fx }, opts);
    view.world.add(this.edges.halo);
    view.tele.add(this.edges.core);
    return this;
  }
  begin(): void {
    this.count = 0;
  }
  push(m: THREE.Matrix4, r: number, g: number, b: number, f0: number, f1: number, f2: number, f3: number): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    const i = this.count++;
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceColor!.setXYZ(i, r, g, b);
    this.fx.setXYZW(i, f0, f1, f2, f3);
  }
  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, this.count) * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.clearUpdateRanges();
    this.mesh.instanceColor!.addUpdateRange(0, Math.max(1, this.count) * 3);
    this.mesh.instanceColor!.needsUpdate = true;
    this.fx.clearUpdateRanges();
    this.fx.addUpdateRange(0, Math.max(1, this.count) * 4);
    this.fx.needsUpdate = true;
    this.edges?.end(this.count);
  }
}

interface VecRing {
  x: number;
  y: number;
  z: number;
  r0: number;
  r1: number;
  t: number;
  dur: number;
  r: number;
  g: number;
  b: number;
}
interface VecSpark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  dur: number;
  len: number;
  r: number;
  g: number;
  b: number;
  drag: number;
}

/** Renders a World into the pipeline scenes. */
export class View {
  readonly world = new THREE.Scene();
  readonly overlay = new THREE.Scene();
  readonly tele = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.3, 2400);
  readonly space: Space;
  readonly particles: Particles;
  readonly streaks: Streaks;
  readonly bullets: Bullets;
  readonly telegraphs: Telegraphs;
  private kinds = new Map<MeshKind, InstancedKind>();
  private debris: InstancedKind;
  private drones: InstancedKind;
  private halos: InstancedKind;
  private ghosts: InstancedKind;
  ship: THREE.Mesh;
  private shipEdges: EdgeBatch;
  private rings: VecRing[] = [];
  private sparks: VecSpark[] = [];
  /** reserved player tone (LDR) for crisp bolt cores */
  private playerTone = new THREE.Vector3(0.75, 0.96, 1);
  private shipMat: THREE.ShaderMaterial;
  private shipHull = '';
  hullMat: THREE.ShaderMaterial;
  /** engine trail history */
  private trail: Float32Array = new Float32Array(48 * 6);
  private trailHead = 0;
  private trailCount = 0;
  private trailTimer = 0;
  trailColor = new THREE.Vector3(1, 0.85, 0.6);
  cockpit = false;
  afterimages: { m: THREE.Matrix4; t: number }[] = [];
  private ghostPool: { m: THREE.Matrix4; t: number }[] = [];
  /** extra visual markers (derelict beacons etc.) drawn as rings */
  markers: { x: number; y: number; z: number; r: number; lit: number }[] = [];
  shipAccent = new THREE.Vector3(1, 0.9, 0.7);

  constructor(public pipe: Pipeline) {
    this.space = new Space(pipe.lights);
    this.world.add(this.space.group);
    this.world.add(this.space.dust);
    this.hullMat = makeHullMaterial(pipe.lights);
    for (const k of KINDS) {
      const ik = new InstancedKind(buildEnemyMesh(k, k.length * 13), this.hullMat, k === 'asteroid' ? 120 : 400);
      this.kinds.set(k, ik);
      this.world.add(ik.mesh);
      // living things get vector edges; dead rock stays a pure silhouette
      if (k !== 'asteroid') ik.withEdges(this, k === 'segment' || k === 'bossCore' ? { haloGain: 0.9, coreGain: 0.5 } : { haloGain: 1.1, coreGain: 0.5 });
    }
    this.debris = new InstancedKind(buildEnemyMesh('debris', 7), this.hullMat, 900);
    this.world.add(this.debris.mesh);
    this.drones = new InstancedKind(buildEnemyMesh('drone', 3), this.hullMat, 16);
    this.world.add(this.drones.mesh);
    this.drones.withEdges(this, { haloGain: 2, coreGain: 0.7 });
    this.halos = new InstancedKind(buildEnemyMesh('halo', 5), this.hullMat, 24);
    this.world.add(this.halos.mesh);
    this.halos.withEdges(this, { haloGain: 2.4, coreGain: 0.8 });
    this.shipMat = makeHullMaterial(pipe.lights, { rim: 1.8, emissive: 2.2 });
    this.ship = new THREE.Mesh(buildPlayerShip('lantern'), this.shipMat);
    this.ship.frustumCulled = false;
    this.ship.layers.enable(1);
    this.world.add(this.ship);
    this.shipEdges = this.makeShipEdges('lantern');
    this.ghosts = new InstancedKind(buildPlayerShip('lantern'), makeHullMaterial(pipe.lights, { rim: 3, emissive: 4 }), 12);
    this.world.add(this.ghosts.mesh);
    this.ghosts.withEdges(this, { haloGain: 0.8, coreGain: 0.45 });

    this.particles = new Particles(65536, pipe.pixelScaleUniform);
    this.world.add(this.particles.points);
    this.streaks = new Streaks(6000, pipe.resUniform);
    this.world.add(this.streaks.mesh);
    this.bullets = new Bullets(8192, pipe.bulletUniforms);
    this.overlay.add(this.bullets.mesh);
    this.telegraphs = new Telegraphs(24000);
    this.tele.add(this.telegraphs.lines);
  }

  private makeShipEdges(id: string): EdgeBatch {
    const e = new EdgeBatch(buildPlayerShip(id), 1, { haloGain: 0.7, coreGain: 0.7 });
    this.world.add(e.halo);
    this.tele.add(e.core);
    return e;
  }

  /** Vector shock ring (style C): crisp native-res circle facing the camera. */
  addRing(x: number, y: number, z: number, r0: number, r1: number, dur: number, r: number, g: number, b: number): void {
    if (this.rings.length > 160) this.rings.shift();
    this.rings.push({ x, y, z, r0, r1, t: 0, dur, r, g, b });
  }

  /** Vector spark: a short crisp line flying along its velocity. */
  addSpark(x: number, y: number, z: number, vx: number, vy: number, vz: number, dur: number, len: number, r: number, g: number, b: number, drag = 3): void {
    if (this.sparks.length > 900) this.sparks.shift();
    this.sparks.push({ x, y, z, vx, vy, vz, t: 0, dur, len, r, g, b, drag });
  }

  setPlayerTone(r: number, g: number, b: number): void {
    this.playerTone.set(r, g, b);
  }

  setHull(id: string, accent: string): void {
    if (this.shipHull === id) return;
    this.shipHull = id;
    this.ship.geometry.dispose();
    this.ship.geometry = buildPlayerShip(id);
    this.world.remove(this.shipEdges.halo);
    this.tele.remove(this.shipEdges.core);
    this.shipEdges = this.makeShipEdges(id);
    const g = this.ghosts.mesh.geometry;
    const fx = g.getAttribute('aFx');
    const ng = buildPlayerShip(id);
    ng.setAttribute('aFx', fx);
    this.ghosts.mesh.geometry = ng;
    g.dispose();
    const [r, gg, b] = hexToRgb(accent);
    this.shipAccent.set(r, gg, b);
    (this.shipMat.uniforms.uTint!.value as THREE.Color).setRGB(r, gg, b);
  }

  resetTrail(): void {
    this.trailCount = 0;
  }

  /** Sync all instance data from the world. alpha = interpolation factor. */
  sync(w: World | null, alpha: number, time: number, frameDt: number): void {
    for (const k of this.kinds.values()) k.begin();
    this.debris.begin();
    this.drones.begin();
    this.halos.begin();
    this.ghosts.begin();
    this.shipEdges.begin();
    this.streaks.begin();
    this.bullets.begin();
    this.telegraphs.begin();

    if (w) {
      this.syncEnemies(w, alpha, time);
      this.syncPlayer(w, alpha, time, frameDt);
      this.syncProjectiles(w, alpha);
      this.syncDebris(w, alpha);
      this.syncDrones(w, alpha, time);
      this.syncFx(w, time);
      this.syncTelegraphs(w, time);
    } else {
      this.ship.visible = false;
    }
    this.syncVectors(frameDt);
    for (const mk of this.markers) {
      const k = mk.lit;
      this.telegraphs.ring(mk.x, mk.y, mk.z, mk.r, 0, 1, 0, 0.5 + k * 0.5, 0.9, 0.5 * (1 - k) + k, 0.6);
      this.telegraphs.ring(mk.x, mk.y, mk.z, mk.r * (0.3 + k * 0.7), 1, 0, 0, 1, 0.95, 0.7, 0.8);
    }

    for (const k of this.kinds.values()) k.end();
    this.debris.end();
    this.drones.end();
    this.halos.end();
    this.ghosts.end();
    this.shipEdges.end();
    this.streaks.end();
    this.bullets.end();
    this.telegraphs.end();
    this.particles.flush();
  }

  private syncEnemies(w: World, a: number, time: number): void {
    for (const e of w.enemies) {
      if (!e.alive && e.dying <= 0) continue;
      const ik = this.kinds.get(e.mesh);
      if (!ik) continue;
      if (!e.revealed) {
        _p.lerpVectors(e.prev, e.pos, a);
        this.bullets.push(_p.x, _p.y, _p.z, 0.7, 0, 0, 0, 3);
        continue;
      }
      _p.lerpVectors(e.prev, e.pos, a);
      _q.slerpQuaternions(e.prevQuat, e.quat, a);
      if (e.def.role === 'inert' || e.def.role === 'turret' || e.def.role === 'bomber') {
        _e.set(e.spin * 0.7, e.spin, 0);
        _q.multiply(_q2.setFromEuler(_e));
      }
      let sc = e.scale;
      if (e.spawnT > 0) sc *= 1 - e.spawnT / 0.6;
      const wob = e.wobble * Math.sin(time * 40) * 0.12;
      _s.set(sc * (1 + wob), sc * (1 - wob), sc * (1 + wob));
      _m.compose(_p, _q, _s);
      let r = e.tint.x;
      let g = e.tint.y;
      let b = e.tint.z;
      let boost = e.emissive * 1.5 + (e.elite ? 0.6 : 0);
      if (e.frozen) {
        r = 0.6;
        g = 0.9;
        b = 1.2;
        boost += 0.8;
      } else if (e.burn > 0 && (Math.floor(time * 20 + e.id) & 1)) {
        r = 1.4;
        g = 0.5;
        b = 0.1;
        boost += 0.5;
      } else if (e.shockT > 0 && (Math.floor(time * 30 + e.id) & 1)) {
        r = 0.7;
        g = 0.8;
        b = 1.4;
        boost += 1;
      }
      if (e.invuln) boost += 0.3;
      const dissolve = e.alive ? 0 : 1 - e.dying / 0.4;
      ik.push(_m, r, g, b, e.flash, dissolve, boost, e.cloak);
      // elite aura ring + shield links
      if (e.alive && e.elite && (Math.floor(time * 8) & 1) === 0) {
        this.telegraphs.ring(_p.x, _p.y, _p.z, e.radius * 1.5, 0, 1, 0, 1, 0.75, 0.3, 0.35, 18);
      }
      if (e.alive && e.shieldedBy > 0 && e.def.role !== 'shielder') {
        this.streaks.push(_p.x, _p.y + e.radius, _p.z, _p.x, _p.y - e.radius, _p.z, 0.4, 0.3, 0.9, 0.08);
      }
    }
  }

  private syncPlayer(w: World, a: number, time: number, frameDt: number): void {
    const pl = w.player;
    this.ship.visible = pl.alive && !this.cockpit;
    _p.lerpVectors(pl.prev, pl.pos, a);
    _q.slerpQuaternions(pl.prevQuat, pl.quat, a);
    // bank + barrel roll + recoil kick
    _e.set(0, 0, pl.bank + pl.roll);
    _q.multiply(_q2.setFromEuler(_e));
    _v.set(0, 0, 1).applyQuaternion(_q).multiplyScalar(pl.recoil * 0.35);
    this.ship.position.copy(_p).add(_v);
    this.ship.quaternion.copy(_q);
    const scale = w.build.hull.id === 'moth' ? 0.8 : w.build.hull.id === 'bastion' ? 1.2 : 1;
    this.ship.scale.setScalar(scale);
    if (this.ship.visible) {
      _m.compose(this.ship.position, this.ship.quaternion, _s.setScalar(scale));
      const flare = pl.flareT > 0 ? 1.2 : 0;
      this.shipEdges.push(_m, 0.45 + flare * 0.4, 0.9, 1, pl.hurtT > 0.2 ? 1 : 0, 0, flare, 0);
    }
    const fx = this.shipMat.uniforms.uFx!.value as THREE.Vector4;
    const heatGlow = w.build.flags.has('emberHull') ? pl.heat : 0;
    const rateGlow = Math.min(1, (w.build.primary.params.rate / Math.max(1, w.build.primary.def.base.rate)) - 1) * 0.6;
    fx.set(pl.hurtT > 0.2 ? 1 : 0, 0, (pl.flareT > 0 ? 0.6 : 0) + heatGlow + Math.max(0, rateGlow) * (pl.firingT < 0.2 ? 1 : 0.3), pl.iframeT > 0 && pl.dodgeT <= 0 ? 0.3 : 0);

    // afterimages during dodge
    this.trailTimer += frameDt;
    if (pl.dodgeT > 0 && Math.floor(time * 30) !== Math.floor((time - frameDt) * 30)) {
      // recycle afterimage matrices instead of allocating one per ghost
      const g = this.ghostPool.pop() ?? { m: new THREE.Matrix4(), t: 0 };
      g.m.compose(this.ship.position, this.ship.quaternion, _s.setScalar(scale));
      g.t = 0.35;
      this.afterimages.push(g);
    }
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const g = this.afterimages[i]!;
      g.t -= frameDt;
      if (g.t <= 0) {
        this.afterimages.splice(i, 1);
        this.ghostPool.push(g);
        continue;
      }
      if (!this.cockpit) this.ghosts.push(g.m, this.shipAccent.x, this.shipAccent.y, this.shipAccent.z, 0.3, 1 - g.t / 0.35, 2, 0);
    }

    // engine trail ribbons (two engines)
    if (pl.alive) {
      const fwd = _v.set(0, 0, 1).applyQuaternion(_q);
      const right = _w.set(1, 0, 0).applyQuaternion(_q);
      const ex = this.ship.position.x + fwd.x * 1.5 * scale;
      const ey = this.ship.position.y + fwd.y * 1.5 * scale;
      const ez = this.ship.position.z + fwd.z * 1.5 * scale;
      // sample by distance travelled (relative to the ship's own motion) so a
      // stationary ship never stacks additive segments on one spot
      const li = ((this.trailHead - 1 + 48) % 48) * 6;
      const moved = this.trailCount === 0 ? 99 : Math.hypot(this.trail[li]! - (ex + right.x * 0.55 * scale), this.trail[li + 1]! - (ey + right.y * 0.55 * scale), this.trail[li + 2]! - (ez + right.z * 0.55 * scale));
      if (this.trailTimer > 1 / 60 && moved > 0.6) {
        this.trailTimer = 0;
        const i = this.trailHead * 6;
        this.trail[i] = ex + right.x * 0.55 * scale;
        this.trail[i + 1] = ey + right.y * 0.55 * scale;
        this.trail[i + 2] = ez + right.z * 0.55 * scale;
        this.trail[i + 3] = ex - right.x * 0.55 * scale;
        this.trail[i + 4] = ey - right.y * 0.55 * scale;
        this.trail[i + 5] = ez - right.z * 0.55 * scale;
        this.trailHead = (this.trailHead + 1) % 48;
        this.trailCount = Math.min(48, this.trailCount + 1);
      }
      if (pl.vel.lengthSq() < 4 && this.trailCount > 2) this.trailCount -= 1;
      const len = Math.min(this.trailCount, Math.round(20 * w.build.ship.speed * (pl.boosting ? 1.5 : 1)));
      const tc = this.trailColor;
      const boost = pl.boosting ? 2.2 : 1;
      for (let e = 0; e < 2; e++) {
        let px = e === 0 ? ex + right.x * 0.55 * scale : ex - right.x * 0.55 * scale;
        let py = e === 0 ? ey + right.y * 0.55 * scale : ey - right.y * 0.55 * scale;
        let pz = e === 0 ? ez + right.z * 0.55 * scale : ez - right.z * 0.55 * scale;
        for (let k = 1; k < len; k++) {
          const idx = ((this.trailHead - k + 48) % 48) * 6 + e * 3;
          const qx = this.trail[idx]!;
          const qy = this.trail[idx + 1]!;
          const qz = this.trail[idx + 2]!;
          const f = 1 - k / len;
          const inten = f * f * 2.2 * (0.3 + pl.thrust) * boost;
          this.streaks.push(px, py, pz, qx, qy, qz, tc.x * inten, tc.y * inten, tc.z * inten, 0.32 * f * scale + 0.05, 0.32 * (f - 1 / len) * scale + 0.05);
          px = qx;
          py = qy;
          pz = qz;
        }
      }
      // shield halo: visible ring sized by max shield, brightness by current
      const sf = pl.maxShield > 0 ? pl.shield / pl.maxShield : 0;
      if (sf > 0.02 && !this.cockpit) {
        const rad = 2.2 + pl.maxShield / 60;
        const n = 20;
        for (let i = 0; i < n; i++) {
          if ((i + Math.floor(time * 6)) % 3 === 0) continue;
          const a0 = (i / n) * Math.PI * 2 + time * 0.5;
          const a1 = ((i + 0.6) / n) * Math.PI * 2 + time * 0.5;
          _v.set(Math.cos(a0) * rad, 0, Math.sin(a0) * rad).applyQuaternion(_q).add(this.ship.position);
          _w.set(Math.cos(a1) * rad, 0, Math.sin(a1) * rad).applyQuaternion(_q).add(this.ship.position);
          const k = sf * 0.12;
          this.streaks.push(_v.x, _v.y, _v.z, _w.x, _w.y, _w.z, 0.3 * k, 0.9 * k, 1 * k, 0.05);
        }
      }
      // magnet aura when upgraded
      if (w.build.ship.magnet > 20 && Math.floor(time * 2) % 2 === 0 && !this.cockpit) {
        this.telegraphs.ring(_p.x, _p.y, _p.z, w.build.ship.magnet, 0, 1, 0, 0.12, 0.1, 0.03, 0.4, 48);
      }
    }
  }

  private syncProjectiles(w: World, a: number): void {
    const P = w.proj;
    const inv = 1 - a;
    // The ship renders interpolated between ticks; shots are born at the current
    // tick's muzzle. Shift brand-new shots by the same interpolation delta so
    // they leave the visible gun, fading the correction out over ~2 ticks.
    const pl = w.player;
    const sx = (pl.pos.x - pl.prev.x) * inv;
    const sy = (pl.pos.y - pl.prev.y) * inv;
    const sz0 = (pl.pos.z - pl.prev.z) * inv;
    for (let i = 0; i < P.n; i++) {
      const vx = P.vx[i]!;
      const vy = P.vy[i]!;
      const vz = P.vz[i]!;
      // interpolate backwards by (1-alpha) of a tick, but never behind the
      // muzzle it left: fresh shots must visibly start at the gun
      const back = Math.min(inv / 60, P.age[i]!);
      const young = Math.max(0, 1 - P.age[i]! * 30);
      const x = P.x[i]! - vx * back - sx * young;
      const y = P.y[i]! - vy * back - sy * young;
      const z = P.z[i]! - vz * back - sz0 * young;
      const sz = P.size[i]! * (P.explode[i]! > 6 ? 1.5 : 1);
      const kind = P.kind[i]!;
      const sp2 = vx * vx + vy * vy + vz * vz;
      if (sp2 < 400) {
        // mines and slow orbs stay solid readable shapes
        this.bullets.push(x, y, z, sz, vx, vy, vz, kind);
        continue;
      }
      // tail length clamped to the distance flown so it never pokes back
      // through the hull at spawn
      const flown = Math.max(0, P.age[i]! - (inv / 60 - back));
      const k = Math.min(kind === 5 ? 0.05 : 0.035, flown);
      const bx = x - vx * k;
      const by = y - vy * k;
      const bz = z - vz * k;
      const t = this.playerTone;
      this.telegraphs.seg(x, y, z, bx, by, bz, t.x, t.y, t.z, 1);
      // halo goes into the HDR scene: bloom + dither make it part of the painting
      const h = kind === 5 ? 1.6 : 1.1;
      if (k > 0.002) this.streaks.push(x, y, z, bx, by, bz, 0.5 * h, 1.6 * h, 2.4 * h, sz * 1.6, sz * 0.6);
      if (kind === 5) this.bullets.push(x, y, z, sz * 0.8, 0, 0, 0, 5);
    }
    const E = w.eproj;
    for (let i = 0; i < E.n; i++) {
      const vx = E.vx[i]!;
      const vy = E.vy[i]!;
      const vz = E.vz[i]!;
      this.bullets.push(E.x[i]! - vx * inv / 60, E.y[i]! - vy * inv / 60, E.z[i]! - vz * inv / 60, E.size[i]!, vx, vy, vz, E.kind[i]!);
    }
    // motes
    const M = w.motes;
    for (let i = 0; i < M.n; i++) this.bullets.push(M.x[i]!, M.y[i]!, M.z[i]!, 0.35 + Math.min(0.5, M.value[i]! * 0.05), 0, 0, 0, 3);
  }

  private syncDebris(w: World, a: number): void {
    const D = w.debris;
    const inv = (1 - a) / 60;
    for (let i = 0; i < D.n; i++) {
      _p.set(D.x[i]! - D.vx[i]! * inv, D.y[i]! - D.vy[i]! * inv, D.z[i]! - D.vz[i]! * inv);
      _v.set(D.ax[i]!, D.ay[i]!, D.az[i]!);
      _q.setFromAxisAngle(_v, D.ang[i]!);
      const life = D.life[i]! / D.maxLife[i]!;
      const sc = D.scale[i]! * Math.min(1, life * 4);
      _s.setScalar(sc);
      _m.compose(_p, _q, _s);
      const h = D.heat[i]!;
      this.debris.push(_m, D.r[i]! * (0.5 + h), D.g[i]! * (0.4 + h * 0.6), D.b[i]! * (0.3 + h * 0.4), 0, 0, h * 2 + (D.dmg[i]! > 0 ? 1 : 0), 0);
    }
  }

  private syncDrones(w: World, a: number, time: number): void {
    for (const d of w.drones) {
      _p.lerpVectors(d.prev, d.pos, a);
      _e.set(0, time * 2, 0);
      _q.setFromEuler(_e);
      _s.setScalar(1.3);
      _m.compose(_p, _q, _s);
      const c = w.weaponsByIndex[d.src] ? rgb(w.weaponsByIndex[d.src]!.color) : WHITE;
      this.drones.push(_m, c[0]!, c[1]!, c[2]!, 0, 0, 0.5, 0);
    }
    for (const sys of w.build.systems) {
      if (sys.def.behavior !== 'halo') continue;
      const n = haloPositions(w, sys, w.time, _halo);
      const c = rgb(sys.color);
      for (let i = 0; i < n; i++) {
        const h = _halo[i]!;
        _v.copy(h).sub(w.player.pos);
        _q.setFromUnitVectors(_w.set(0, 0, 1), _v.normalize());
        _e.set(0, 0, time * 10);
        _q.multiply(_q2.setFromEuler(_e));
        _s.setScalar(sys.params.size * (sys.def.id === 'sentinel' ? 1.8 : 1.6));
        _m.compose(h, _q, _s);
        this.halos.push(_m, c[0], c[1], c[2], 0, 0, 1, 0);
      }
    }
  }

  private syncFx(w: World, time: number): void {
    // beams (player + enemy)
    for (const b of w.beams) {
      const k = b.enemy ? 3 : 2.5;
      this.streaks.push(b.ax, b.ay, b.az, b.bx, b.by, b.bz, b.r * k, b.g * k, b.b * k, b.width, b.width * 0.7);
      this.streaks.push(b.ax, b.ay, b.az, b.bx, b.by, b.bz, 3, 3, 3, b.width * 0.3, b.width * 0.2);
      if (b.enemy) {
        // undithered danger core so lancers stay readable
        this.telegraphs.seg(b.ax, b.ay, b.az, b.bx, b.by, b.bz, 1, 0.3, 0.2, 1);
      }
    }
    for (const r of w.rails) {
      const f = 1 - r.t / 0.25;
      const k = f * f * 6;
      this.streaks.push(r.ax, r.ay, r.az, r.bx, r.by, r.bz, r.r * k, r.g * k, r.b * k, r.width * (0.5 + f), r.width * 0.3);
    }
    // lightning arcs: jagged segments
    for (const arc of w.arcs) {
      const segs = 6;
      let px = arc.ax;
      let py = arc.ay;
      let pz = arc.az;
      const f = 1 - arc.t / 0.18;
      const c = arc.color === 2 ? [0.4, 1.4, 0.7] : [0.7, 0.85, 2.0];
      const jitter = Math.hypot(arc.bx - arc.ax, arc.by - arc.ay, arc.bz - arc.az) * 0.08;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        let qx = arc.ax + (arc.bx - arc.ax) * t;
        let qy = arc.ay + (arc.by - arc.ay) * t;
        let qz = arc.az + (arc.bz - arc.az) * t;
        if (s < segs) {
          qx += (fxRng.next() - 0.5) * jitter;
          qy += (fxRng.next() - 0.5) * jitter;
          qz += (fxRng.next() - 0.5) * jitter;
        }
        this.streaks.push(px, py, pz, qx, qy, qz, c[0]! * 3 * f, c[1]! * 3 * f, c[2]! * 3 * f, 0.18);
        px = qx;
        py = qy;
        pz = qz;
      }
    }
    // wells: swirling rings
    for (const wl of w.wells) {
      const f = Math.min(1, wl.life / 0.4);
      const c = w.colorOf(wl.src);
      for (let i = 0; i < 3; i++) {
        const rr = wl.radius * (0.3 + ((time * 0.8 + i / 3) % 1) * 0.7);
        this.telegraphs.ring(wl.x, wl.y, wl.z, rr, Math.sin(time + i), 1, Math.cos(time * 0.7 + i), c[0] * 0.5 * f, c[1] * 0.5 * f, c[2] * 0.5 * f, 0.5, 32);
      }
      if (fxRng.next() < 0.6) {
        _v.set(fxRng.next() - 0.5, fxRng.next() - 0.5, fxRng.next() - 0.5).normalize().multiplyScalar(wl.radius);
        this.particles.spawn(wl.x + _v.x, wl.y + _v.y, wl.z + _v.z, -_v.x * 2, -_v.y * 2, -_v.z * 2, 0.5, c[0] * 2, c[1] * 2, c[2] * 2, 2, 0.5, 0, 0);
      }
    }
    // decoys
    for (const d of w.decoys) this.telegraphs.ring(d.pos.x, d.pos.y, d.pos.z, 2 + Math.sin(time * 10), 0, 1, 0, 0.3, 1, 0.9, 0.6, 16);
  }

  private syncVectors(dt: number): void {
    const T = this.telegraphs;
    const cam = this.camera;
    _v.set(0, 0, 1).applyQuaternion(cam.quaternion); // ring normal faces the camera
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i]!;
      g.t += dt;
      const k = g.t / g.dur;
      if (k >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const a = (1 - k) * (1 - k);
      T.ring(g.x, g.y, g.z, g.r0 + (g.r1 - g.r0) * e, _v.x, _v.y, _v.z, g.r * a, g.g * a, g.b * a, 1, 48);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.t += dt;
      if (s.t >= s.dur) {
        this.sparks.splice(i, 1);
        continue;
      }
      const f = Math.exp(-s.drag * dt);
      s.vx *= f;
      s.vy *= f;
      s.vz *= f;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const a = 1 - s.t / s.dur;
      T.seg(s.x, s.y, s.z, s.x - s.vx * s.len, s.y - s.vy * s.len, s.z - s.vz * s.len, s.r * a, s.g * a, s.b * a, 1);
    }
  }

  private syncTelegraphs(w: World, time: number): void {
    const T = this.telegraphs;
    for (const t of w.telegraphs) {
      const k = t.t / t.dur;
      const blink = 0.55 + 0.45 * Math.sin(time * (16 + k * 30));
      const a = (0.35 + k * 0.65) * blink;
      if (t.kind === 'line') {
        T.seg(t.ax, t.ay, t.az, t.bx, t.by, t.bz, 1, 0.25, 0.15, a);
        // width rails
        const dx = t.bx - t.ax;
        const dy = t.by - t.ay;
        const dz = t.bz - t.az;
        const len = Math.hypot(dx, dy, dz) || 1;
        _v.set(dx / len, dy / len, dz / len);
        _w.set(0, 1, 0).cross(_v).normalize().multiplyScalar(t.radius * (1 - k * 0.6));
        T.seg(t.ax + _w.x, t.ay + _w.y, t.az + _w.z, t.bx + _w.x, t.by + _w.y, t.bz + _w.z, 1, 0.2, 0.1, a * 0.4);
        T.seg(t.ax - _w.x, t.ay - _w.y, t.az - _w.z, t.bx - _w.x, t.by - _w.y, t.bz - _w.z, 1, 0.2, 0.1, a * 0.4);
      } else if (t.kind === 'ring') {
        T.ring(t.ax, t.ay, t.az, t.radius * (0.4 + k * 0.6), t.bx, t.by, t.bz, 1, 0.3, 0.15, a);
      } else {
        // sphere: three orthogonal rings closing in
        const r = t.radius * (1.6 - k * 0.6);
        T.ring(t.ax, t.ay, t.az, r, 1, 0, 0, 1, 0.3, 0.15, a, 24);
        T.ring(t.ax, t.ay, t.az, r, 0, 1, 0, 1, 0.3, 0.15, a, 24);
        T.ring(t.ax, t.ay, t.az, r, 0, 0, 1, 1, 0.3, 0.15, a, 24);
      }
    }
    // stasis field
    const pl = w.player;
    if (pl.stasisT > 0) {
      const r = 34 * w.build.ship.stasis;
      T.ring(pl.pos.x, pl.pos.y, pl.pos.z, r, 0, 1, 0, 0.3, 0.6, 1, 0.4, 64);
      T.ring(pl.pos.x, pl.pos.y, pl.pos.z, r, 1, 0, 0, 0.3, 0.6, 1, 0.25, 64);
    }
    // arena boundary warning
    const d = pl.pos.length();
    const R = w.arenaRadius;
    if (d > R * 0.82) {
      const k = Math.min(1, (d - R * 0.82) / (R * 0.18));
      // the arena wall materializes as a magenta vector grid (style C)
      _v.copy(pl.pos).normalize();
      const ux = _ux.set(0, 1, 0).cross(_v);
      if (ux.lengthSq() < 0.01) ux.set(1, 0, 0);
      ux.normalize();
      const uy = _uy.crossVectors(_v, ux).normalize();
      const pulse = 0.75 + 0.25 * Math.sin(time * 5);
      const cr = 1 * k * pulse;
      const cg = 0.17 * k * pulse;
      const cb = 0.84 * k * pulse;
      const N = 8;
      const step = 9;
      const onSphere = (a: number, b: number, out: THREE.Vector3) => out.copy(_v).multiplyScalar(R).addScaledVector(ux, a).addScaledVector(uy, b).setLength(R);
      const pa = _pa;
      const pb = _pb;
      for (let i = -N; i <= N; i++) {
        for (let j = -N; j < N; j++) {
          const fade = 1 - Math.max(Math.abs(i), Math.abs(j)) / N;
          onSphere(i * step, j * step, pa);
          onSphere(i * step, (j + 1) * step, pb);
          T.seg(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, cr * fade, cg * fade, cb * fade, 1);
          onSphere(j * step, i * step, pa);
          onSphere((j + 1) * step, i * step, pb);
          T.seg(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, cr * fade, cg * fade, cb * fade, 1);
        }
      }
    }
    void _col;
  }
}
