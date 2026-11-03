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

    // The dying star
    this.starDir.set(rng.range(-1, 1), rng.range(0.05, 0.45), rng.range(-1, -0.3)).normalize();
    const sd = opts.starDist ?? 700;
    this.star.position.copy(this.starDir).multiplyScalar(sd);
    this.star.scale.setScalar(sd * 0.32);
    this.starMat.uniforms.uColor!.value.copy(hexToLinearVec(pal.star));
    this.lights.uniforms.uStarDir.value.copy(this.starDir);
    this.lights.uniforms.uAmbient.value.copy(hexToLinearVec(pal.ambient, 1.2));
    this.applyStarPower();
  }

  applyStarPower(): void {
    const p = this.starPower;
    this.starMat.uniforms.uPower!.value = 0.35 + p * 0.9;
    const c = this.starMat.uniforms.uColor!.value as THREE.Vector3;
    this.lights.uniforms.uStarColor.value.copy(c).multiplyScalar(0.5 + p * 1.2);
  }

  update(time: number, camPos: THREE.Vector3): void {
    // Backdrop is effectively at infinity: follow the camera.
    this.group.position.copy(camPos);
    this.starMat.uniforms.uTime!.value = time;
  }
}
