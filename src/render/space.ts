import * as THREE from 'three';
import { Rng } from '../core/rng';
import { makeNebulaMaterial, makeStarMaterial } from './materials';
import type { LightRig } from './pipeline';
import { hexToLinearVec } from './pipeline';
import type { PaletteDef } from '../data/palettes';
import { hdrAdditive } from './fx';

/**
 * Backdrop: painterly brushed-stroke nebula (instanced billboards following a
 * flow field), a field of distant stars, and the sector's dying star which
 * is also the key light for rim lighting.
 */
export class Space {
  readonly group = new THREE.Group();
  private nebula: THREE.Mesh;
  private nebulaGeo: THREE.InstancedBufferGeometry;
  /** Local dust strokes inside the arena: parallax + lit by explosions. */
  readonly dust: THREE.Mesh;
  private dustGeo: THREE.InstancedBufferGeometry;
  private stars: THREE.Points;
  readonly star: THREE.Mesh;
  readonly starMat: THREE.ShaderMaterial;
  readonly nebulaMat: THREE.ShaderMaterial;
  starDir = new THREE.Vector3(0.5, 0.25, -0.8).normalize();
  private strokeCount: number;
  /** 0..1, how relit the star is (boss kill brings it to 1). */
  starPower = 0.5;
  private featureAxis = new THREE.Vector3(0, 0.2, -1);
  /** One batched set of distant architectural contours; no per-landmark draw calls. */
  private landmarkGeo = new THREE.BufferGeometry();
  private landmarkMat: THREE.ShaderMaterial;
  private visualPower = 0.5;
  private lastUpdateTime: number | null = null;
  private waveStart: number | null = null;


  constructor(private lights: LightRig, strokeCount = 1400) {
    this.strokeCount = strokeCount;
    const base = new THREE.PlaneGeometry(1, 1);
    this.nebulaGeo = new THREE.InstancedBufferGeometry();
    this.nebulaGeo.index = base.index;
    this.nebulaGeo.setAttribute('position', base.getAttribute('position'));
    this.nebulaMat = makeNebulaMaterial(lights);
    this.nebula = new THREE.Mesh(this.nebulaGeo, this.nebulaMat);
    this.nebula.frustumCulled = false;
    this.nebula.renderOrder = -5;
    this.group.add(this.nebula);
    this.dustGeo = new THREE.InstancedBufferGeometry();
    this.dustGeo.index = base.index;
    this.dustGeo.setAttribute('position', base.getAttribute('position'));
    this.dust = new THREE.Mesh(this.dustGeo, this.nebulaMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = -3;

    const sg = new THREE.BufferGeometry();
    const sm = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 aCol;
        varying vec3 vCol;
        uniform float uTime;
        void main() {
          vCol = aCol * (0.75 + 0.25 * sin(uTime * (1.0 + aCol.r * 3.0) + position.x));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 1.0;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main() { gl_FragColor = vec4(vCol, 0.0); }`,
      uniforms: { uTime: lights.uniforms.uTime },
    });
    hdrAdditive(sm);
    this.stars = new THREE.Points(sg, sm);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -6;
    this.group.add(this.stars);

    this.starMat = makeStarMaterial();
    this.star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.starMat);
    this.star.frustumCulled = false;
    this.star.renderOrder = -4;
    this.group.add(this.star);

    this.landmarkMat = new THREE.ShaderMaterial({
      uniforms: { uRestore: { value: 0.5 }, uWave: { value: -2 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aDistance;
        varying vec3 vColor;
        varying float vDistance;
        void main() {
          vColor = aColor;
          vDistance = aDistance;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uRestore;
        uniform float uWave;
        varying vec3 vColor;
        varying float vDistance;
        void main() {
          float wave = 1.0 - smoothstep(0.0, 0.10, abs(vDistance - uWave));
          gl_FragColor = vec4(vColor * (0.45 + 0.55 * uRestore + wave * 0.9), 0.0);
        }`,
      depthTest: false,
    });
    hdrAdditive(this.landmarkMat);
    const landmark = new THREE.LineSegments(this.landmarkGeo, this.landmarkMat);
    landmark.frustumCulled = false;
    landmark.renderOrder = -4;
    this.group.add(landmark);
  }

  setStrokeCount(n: number): void {
    this.strokeCount = n;
  }

  /** Rebuild the backdrop for a sector. Visual only; seeded for consistency. */
  build(pal: PaletteDef, seed: number, opts: { density?: number; starDist?: number } = {}): void {
    const rng = new Rng(seed);
    const n = Math.floor(this.strokeCount * (opts.density ?? 1));
    const stroke = new Float32Array(n * 4);
    const dir = new Float32Array(n * 4);
    const col = new Float32Array(n * 4);
    const tints = pal.nebula.map((h) => hexToLinearVec(h));
    // a few "clouds" of strokes with a swirling flow field
    const clouds = 5 + rng.int(0, 3);
    const centers: THREE.Vector3[] = [];
    for (let c = 0; c < clouds; c++) {
      const v = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.5, 0.5), rng.range(-1, 1)).normalize();
      centers.push(v.multiplyScalar(rng.range(500, 800)));
    }
    const tmp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const c = centers[i % clouds]!;
      const spreadR = rng.range(60, 260);
      tmp.set(rng.range(-1, 1), rng.range(-0.6, 0.6), rng.range(-1, 1)).multiplyScalar(spreadR).add(c);
      // push out to a shell so strokes read as a distant painted backdrop
      const dist = tmp.length();
      tmp.multiplyScalar(Math.max(dist, 380) / dist);
      stroke[i * 4] = tmp.x;
      stroke[i * 4 + 1] = tmp.y;
      stroke[i * 4 + 2] = tmp.z;
      stroke[i * 4 + 3] = rng.range(14, 60);
      // flow: tangential swirl around cloud center + noise
      const fx = Math.sin(tmp.y * 0.01 + c.x * 0.003) + rng.range(-0.3, 0.3);
      const fy = Math.cos(tmp.x * 0.008) * 0.4 + rng.range(-0.2, 0.2);
      const fz = Math.sin(tmp.x * 0.006 + tmp.z * 0.004);
      const fl = Math.hypot(fx, fy, fz) || 1;
      dir[i * 4] = fx / fl;
      dir[i * 4 + 1] = fy / fl;
      dir[i * 4 + 2] = fz / fl;
      dir[i * 4 + 3] = rng.range(2.5, 6.5);
      const t = tints[rng.weighted([5, 3, 2])]!;
      const k = rng.range(0.04, 0.16) * (i % 7 === 0 ? 2.2 : 1);
      col[i * 4] = t.x * k;
      col[i * 4 + 1] = t.y * k;
      col[i * 4 + 2] = t.z * k;
      col[i * 4 + 3] = rng.next();
    }
    // environment features re-arrange part of the painting around the star
    if (pal.feature) this.applyFeature(pal.feature, rng, stroke, dir, col, n, tints);
    this.nebulaGeo.setAttribute('aStroke', new THREE.InstancedBufferAttribute(stroke, 4));
    this.nebulaGeo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 4));
    this.nebulaGeo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 4));
    this.nebulaGeo.instanceCount = n;

    // Local dust in world space
    const dn = Math.floor(n * 0.35);
    const ds = new Float32Array(dn * 4);
    const dd = new Float32Array(dn * 4);
    const dc = new Float32Array(dn * 4);
    for (let i = 0; i < dn; i++) {
      tmp.set(rng.range(-1, 1), rng.range(-0.5, 0.5), rng.range(-1, 1)).multiplyScalar(rng.range(40, 330));
      ds[i * 4] = tmp.x;
      ds[i * 4 + 1] = tmp.y;
      ds[i * 4 + 2] = tmp.z;
      ds[i * 4 + 3] = rng.range(6, 26);
      const fx = Math.sin(tmp.z * 0.02) + rng.range(-0.3, 0.3);
      const fy = rng.range(-0.2, 0.2);
      const fz = Math.cos(tmp.x * 0.02);
      const fl = Math.hypot(fx, fy, fz) || 1;
      dd[i * 4] = fx / fl;
      dd[i * 4 + 1] = fy / fl;
      dd[i * 4 + 2] = fz / fl;
      dd[i * 4 + 3] = rng.range(2, 5);
      const t = tints[rng.weighted([4, 4, 2])]!;
      const k = rng.range(0.015, 0.05);
      dc[i * 4] = t.x * k;
      dc[i * 4 + 1] = t.y * k;
      dc[i * 4 + 2] = t.z * k;
      dc[i * 4 + 3] = rng.next();
    }
    this.dustGeo.setAttribute('aStroke', new THREE.InstancedBufferAttribute(ds, 4));
    this.dustGeo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dd, 4));
    this.dustGeo.setAttribute('aCol', new THREE.InstancedBufferAttribute(dc, 4));
    this.dustGeo.instanceCount = dn;

    // Distant stars
    const sn = 2400;
    const sp = new Float32Array(sn * 3);
    const sc = new Float32Array(sn * 3);
    for (let i = 0; i < sn; i++) {
      tmp.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize().multiplyScalar(900);
      sp[i * 3] = tmp.x;
      sp[i * 3 + 1] = tmp.y;
      sp[i * 3 + 2] = tmp.z;
      const b = Math.pow(rng.next(), 6) * 3 + 0.15;
      const t = rng.chance(0.3) ? tints[rng.int(0, 2)]! : new THREE.Vector3(1, 1, 1);
      sc[i * 3] = b * (0.5 + t.x);
      sc[i * 3 + 1] = b * (0.5 + t.y);
      sc[i * 3 + 2] = b * (0.5 + t.z);
    }
    const sg = this.stars.geometry;
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aCol', new THREE.BufferAttribute(sc, 3));

    // The dying star (features are built around their own axis; the star sits on it)
    if (pal.feature) this.starDir.copy(this.featureAxis);
    else this.starDir.set(rng.range(-1, 1), rng.range(0.05, 0.45), rng.range(-1, -0.3)).normalize();
    const sd = opts.starDist ?? 700;
    this.star.position.copy(this.starDir).multiplyScalar(sd);
    this.star.scale.setScalar(sd * 0.32);
    this.starMat.uniforms.uColor!.value.copy(hexToLinearVec(pal.star));
    this.buildLandmark(pal, rng);
    this.lights.uniforms.uStarDir.value.copy(this.starDir);
    this.lights.uniforms.uAmbient.value.copy(hexToLinearVec(pal.ambient, 1.2));
    this.applyStarPower();
  }

  /**
   * Feature layouts (Act II environments). Positions are on the backdrop shell;
   * `starDir` is chosen below, so features are built around a provisional axis
   * that build() then copies to the star.
   */
  private applyFeature(f: NonNullable<PaletteDef['feature']>, rng: Rng, stroke: Float32Array, dir: Float32Array, col: Float32Array, n: number, tints: THREE.Vector3[]): void {
    const axis = new THREE.Vector3(rng.range(-1, 1), rng.range(0.1, 0.4), rng.range(-1, -0.4)).normalize();
    this.featureAxis.copy(axis);
    const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(u, axis).normalize();
    const c = axis.clone().multiplyScalar(640);
    const p = new THREE.Vector3();
    const d = new THREE.Vector3();
    const share = f === 'rift' ? 0.85 : 0.6;
    for (let i = 0; i < n; i++) {
      if (rng.next() > share) continue;
      let k = 1;
      switch (f) {
        case 'forge': {
          // tall pillars of gas rising from below the star
          const pillar = i % 4;
          const px = (pillar - 1.5) * 90 + rng.range(-20, 20);
          const h = rng.range(-260, 120);
          p.copy(c).addScaledVector(u, px + Math.sin(h * 0.02 + pillar) * 25).addScaledVector(v, h);
          d.copy(v).addScaledVector(u, rng.range(-0.3, 0.3)).normalize();
          k = 1.3;
          break;
        }
        case 'blackhole': {
          // a flattened accretion disc around a dark centre, plus a thin photon ring
          const a = rng.next() * Math.PI * 2;
          const ring = rng.chance(0.18);
          const r = ring ? rng.range(70, 80) : rng.range(90, 330) * (1 + rng.next() * 0.3);
          p.copy(c).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r * (ring ? 1 : 0.22));
          d.copy(u).multiplyScalar(-Math.sin(a)).addScaledVector(v, Math.cos(a) * 0.22).normalize();
          k = ring ? 3 : 1.6 * (90 / r) + 0.4;
          break;
        }
        case 'jets': {
          // two opposed jets along v, flaring as they leave the core
          const s = rng.chance(0.5) ? 1 : -1;
          const t = Math.pow(rng.next(), 0.7) * 520;
          const w = 8 + t * 0.12;
          p.copy(c).addScaledVector(v, s * t).addScaledVector(u, rng.range(-w, w));
          d.copy(v).multiplyScalar(s);
          k = 2.2 - t / 400;
          break;
        }
        case 'fieldlines': {
          // dipole field lines looping out of the poles
          const line = i % 9;
          const L = 120 + line * 34;
          const th = rng.range(0.15, Math.PI - 0.15);
          const r = L * Math.sin(th) ** 2;
          const side = line % 2 ? 1 : -1;
          p.copy(c).addScaledVector(u, side * r * Math.sin(th)).addScaledVector(v, r * Math.cos(th));
          d.copy(u).multiplyScalar(side * Math.cos(th)).addScaledVector(v, -Math.sin(th)).normalize();
          k = 1.4;
          break;
        }
        case 'rift': {
          // sparse, broken slivers: the painting is coming apart
          p.set(rng.range(-1, 1), rng.range(-0.6, 0.6), rng.range(-1, 1)).normalize().multiplyScalar(rng.range(420, 820));
          d.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
          k = rng.chance(0.1) ? 2.5 : 0.35;
          break;
        }
      }
      stroke[i * 4] = p.x;
      stroke[i * 4 + 1] = p.y;
      stroke[i * 4 + 2] = p.z;
      dir[i * 4] = d.x;
      dir[i * 4 + 1] = d.y;
      dir[i * 4 + 2] = d.z;
      const t = tints[f === 'blackhole' && k > 2 ? 0 : rng.weighted([5, 3, 2])]!;
      const kk = rng.range(0.05, 0.14) * k;
      col[i * 4] = t.x * kk;
      col[i * 4 + 1] = t.y * kk;
      col[i * 4 + 2] = t.z * kk;
    }
  }

  /**
   * A sector-scale illustration made of sparse broken contours, drawn in one
   * batch on the sky shell. It uses the same seeded art RNG as the nebula.
   */
  private buildLandmark(pal: PaletteDef, rng: Rng): void {
    const axis = this.starDir;
    const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(u, axis).normalize();
    const center = axis.clone().multiplyScalar(620);
    const positions: number[] = [];
    const colors: number[] = [];
    const distances: number[] = [];
    const tint = hexToLinearVec(pal.nebula[0]);
    const add = (x1: number, y1: number, x2: number, y2: number, intensity: number) => {
      const a = center.clone().addScaledVector(u, x1).addScaledVector(v, y1);
      const b = center.clone().addScaledVector(u, x2).addScaledVector(v, y2);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (let k = 0; k < 2; k++) colors.push(tint.x * intensity, tint.y * intensity, tint.z * intensity);
      distances.push(Math.min(1, Math.hypot(x1, y1) / 520), Math.min(1, Math.hypot(x2, y2) / 520));
    };
    const arc = (rx: number, ry: number, start: number, end: number, segments: number, brightness: number, broken = 0) => {
      for (let i = 0; i < segments; i++) {
        if (broken && rng.next() < broken) continue;
        const a = start + (end - start) * i / segments;
        const b = start + (end - start) * (i + 1) / segments;
        add(Math.cos(a) * rx, Math.sin(a) * ry, Math.cos(b) * rx, Math.sin(b) * ry, brightness);
      }
    };
    // These large, low-contrast forms are landmarks, never a combat overlay.
    switch (pal.feature ?? pal.id) {
      case 'forge':
        arc(265, 220, 0.2, Math.PI * 1.85, 90, 0.40, 0.12);
        arc(280, 235, 0.3, Math.PI * 1.7, 80, 0.22, 0.22);
        for (let i = -2; i <= 2; i++) add(i * 102, -310, i * 102 + 35, -115 + Math.abs(i) * 17, 0.18);
        break;
      case 'blackhole':
        arc(92, 92, 0, Math.PI * 2, 88, 0.65);
        arc(320, 65, 0.12, Math.PI * 0.92, 75, 0.32, 0.08);
        arc(340, 82, Math.PI * 1.08, Math.PI * 1.92, 75, 0.26, 0.10);
        break;
      case 'jets':
        for (let i = -2; i <= 2; i++) {
          add(i * 12, 70, i * 48, 440, 0.20);
          add(i * 12, -70, i * 48, -440, 0.20);
        }
        arc(90, 45, 0, Math.PI * 2, 55, 0.35, 0.08);
        break;
      case 'fieldlines':
        for (let i = 0; i < 4; i++) {
          arc(150 + i * 58, 240 + i * 42, -1.3, 1.3, 55, 0.21, 0.10);
          arc(150 + i * 58, 240 + i * 42, 1.84, 4.44, 55, 0.21, 0.10);
        }
        break;
      case 'rift':
        for (let i = 0; i < 18; i++) {
          const x = rng.range(-480, 480), y = rng.range(-300, 300);
          add(x, y, x + rng.range(30, 110), y + rng.range(12, 50), 0.20 + rng.next() * 0.25);
        }
        break;
      case 'ember':
        arc(310, 210, 0.3, Math.PI * 1.85, 90, 0.26, 0.20);
        for (let i = -2; i <= 2; i++) add(i * 86, -235, i * 86 + 35, -360, 0.20);
        break;
      case 'ice':
        for (let i = 0; i < 9; i++) {
          const a = i * Math.PI * 2 / 9;
          add(Math.cos(a) * 135, Math.sin(a) * 100, Math.cos(a + 0.06) * 340, Math.sin(a + 0.06) * 240, 0.20);
        }
        break;
      case 'pulsar':
        arc(280, 92, 0, Math.PI * 2, 90, 0.28, 0.10);
        arc(180, 300, 0, Math.PI * 2, 90, 0.20, 0.16);
        break;
      case 'hush':
        arc(280, 210, 0.25, Math.PI * 1.85, 85, 0.14, 0.43);
        break;
      case 'binary':
        // Two interlocking orbital arcs suggest the paired stars.
        arc(330, 105, 0.2, Math.PI * 1.8, 80, 0.23, 0.14);
        arc(190, 245, 1.1, Math.PI * 2.1, 80, 0.18, 0.16);
        break;
      case 'hearth':
        // A broken lantern halo frames the home star without filling the menu.
        arc(255, 205, 0.35, Math.PI * 0.85, 40, 0.20, 0.10);
        arc(255, 205, Math.PI * 1.15, Math.PI * 1.65, 40, 0.20, 0.10);
        add(-265, -130, -265, -195, 0.16);
        add(265, -130, 265, -195, 0.16);
        break;
      case 'cradle':
        arc(300, 170, 0.15, Math.PI * 1.65, 100, 0.23, 0.22);
        arc(370, 205, Math.PI * 0.9, Math.PI * 2.15, 90, 0.17, 0.18);
        break;
      default:
        arc(250, 190, 0.3, Math.PI * 1.8, 84, 0.22, 0.22);
        arc(310, 225, 1.1, Math.PI * 2.1, 80, 0.16, 0.25);
        break;
    }
    // Sector changes replace the buffer; release the old GPU allocation first.
    this.landmarkGeo.dispose();
    this.landmarkGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.landmarkGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    this.landmarkGeo.setAttribute('aDistance', new THREE.Float32BufferAttribute(distances, 1));
  }

  /** Change the target gradually; crossing full restoration starts a sky wave. */
  setRestoration(power: number, animate = true): void {
    const next = THREE.MathUtils.clamp(power, 0, 1);
    if (next >= 1 && this.starPower < 1 && animate) this.waveStart = this.lastUpdateTime;
    this.starPower = next;
  }

  applyStarPower(): void {
    this.waveStart = null;
    this.landmarkMat.uniforms.uWave!.value = -2;
    this.visualPower = this.starPower;
    this.writeStarPower();
  }

  private writeStarPower(): void {
    const p = this.visualPower;
    this.starMat.uniforms.uPower!.value = 0.35 + p * 0.9;
    const c = this.starMat.uniforms.uColor!.value as THREE.Vector3;
    this.lights.uniforms.uStarColor.value.copy(c).multiplyScalar(0.5 + p * 1.2);
    this.landmarkMat.uniforms.uRestore!.value = p;
  }

  update(time: number, camPos: THREE.Vector3): void {
    // Backdrop is effectively at infinity: follow the camera.
    this.group.position.copy(camPos);
    const dt = this.lastUpdateTime === null ? 0 : Math.max(0, time - this.lastUpdateTime);
    this.lastUpdateTime = time;
    this.visualPower += (this.starPower - this.visualPower) * (1 - Math.exp(-dt * 0.8));
    this.writeStarPower();
    if (this.waveStart !== null) {
      const progress = (time - this.waveStart) / 3.5;
      this.landmarkMat.uniforms.uWave!.value = progress <= 1.2 ? progress : -2;
      if (progress > 1.2) this.waveStart = null;
    }
    this.starMat.uniforms.uTime!.value = time;
  }
}
