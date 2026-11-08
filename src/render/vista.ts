import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { PaletteDef } from '../data/palettes';
import { buildEnemyMesh, prep } from './meshes';
import { makeHullMaterial } from './materials';
import type { LightRig } from './pipeline';
import { hexToLinearVec } from './pipeline';

/**
 * Scale: the things that make the arena feel like a sliver of something vast.
 *
 * - `world` holds colossal, non-interactive objects placed far outside the
 *   arena in world space (an asteroid belt arc of mountain-sized rocks and a
 *   broken megastructure ring). They are real geometry with real parallax: as
 *   the ship crosses the arena they slide against the sky, slowly.
 * - `sky` follows the camera like the nebula: a gas giant (or ice world) that
 *   fills a third of the sky, with rings, a lit terminator and an atmosphere.
 */
export class Vista {
  readonly world = new THREE.Group();
  readonly sky = new THREE.Group();
  private belt: THREE.InstancedMesh;
  private beltFx: THREE.InstancedBufferAttribute;
  private ring: THREE.Mesh;
  private planet: THREE.Mesh;
  private planetMat: THREE.ShaderMaterial;
  private rings: THREE.Mesh;
  private ringMat: THREE.ShaderMaterial;
  private hullMat: THREE.ShaderMaterial;
  static readonly BELT_CAP = 90;

  constructor(lights: LightRig) {
    // far geometry gets only a whisper of rim light so it reads as massive and distant
    this.hullMat = makeHullMaterial(lights, { rim: 0.7, emissive: 2.4 });
    const rock = buildEnemyMesh('asteroid', 911);
    this.beltFx = new THREE.InstancedBufferAttribute(new Float32Array(Vista.BELT_CAP * 4), 4);
    rock.setAttribute('aFx', this.beltFx);
    this.belt = new THREE.InstancedMesh(rock, this.hullMat, Vista.BELT_CAP);
    this.belt.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Vista.BELT_CAP * 3).fill(1), 3);
    this.belt.frustumCulled = false;
    this.belt.count = 0;
    this.world.add(this.belt);

    this.ring = new THREE.Mesh(buildMegaRing(7), this.hullMat);
    this.ring.frustumCulled = false;
    this.world.add(this.ring);

    this.planetMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        uStarDir: lights.uniforms.uStarDir,
        uStarColor: lights.uniforms.uStarColor,
        uA: { value: new THREE.Vector3() },
        uB: { value: new THREE.Vector3() },
        uC: { value: new THREE.Vector3() },
        uAtmo: { value: new THREE.Vector3() },
        uSeed: { value: 0 },
        uTime: lights.uniforms.uTime,
      },
      depthWrite: false,
      depthTest: false,
    });
    // opaque in colour, but never marks the pixel as foreground (sky dither anchoring)
    this.planetMat.blending = THREE.CustomBlending;
    this.planetMat.blendEquation = THREE.AddEquation;
    this.planetMat.blendSrc = THREE.OneFactor;
    this.planetMat.blendDst = THREE.ZeroFactor;
    this.planetMat.blendSrcAlpha = THREE.ZeroFactor;
    this.planetMat.blendDstAlpha = THREE.OneFactor;
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.planetMat);
    this.planet.frustumCulled = false;
    this.planet.renderOrder = -5.5;
    this.sky.add(this.planet);

    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uStarDir: lights.uniforms.uStarDir,
        uStarColor: lights.uniforms.uStarColor,
        uCol: { value: new THREE.Vector3() },
        uPlanet: { value: new THREE.Vector4() },
        uSeed: { value: 0 },
      },
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.ringMat.blending = THREE.CustomBlending;
    this.ringMat.blendEquation = THREE.AddEquation;
    this.ringMat.blendSrc = THREE.SrcAlphaFactor;
    this.ringMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.ringMat.blendSrcAlpha = THREE.ZeroFactor;
    this.ringMat.blendDstAlpha = THREE.OneFactor;
    this.rings = new THREE.Mesh(new THREE.RingGeometry(1.35, 2.5, 192, 1), this.ringMat);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = -5.4;
    this.sky.add(this.rings);
  }

  /** Seeded per sector; keeps the planet out of the star's glare. */
  build(pal: PaletteDef, seed: number, starDir: THREE.Vector3, opts: { planet?: boolean } = {}): void {
    const rng = new Rng(seed ^ 0x5ca1e);
    const neb = pal.nebula.map((h) => hexToLinearVec(h));
    // --- gas giant, well away from the star
    const dir = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      dir.set(rng.range(-1, 1), rng.range(-0.15, 0.55), rng.range(-1, 1)).normalize();
      if (dir.dot(starDir) < 0.2) break;
    }
    const dist = 3200;
    const radius = rng.range(1050, 1500);
    this.planet.position.copy(dir).multiplyScalar(dist);
    this.planet.scale.setScalar(radius);
    this.planet.rotation.set(rng.range(-0.4, 0.4), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3));
    this.planet.visible = opts.planet !== false;
    const a = neb[0]!.clone().multiplyScalar(0.55);
    const b = neb[1]!.clone().multiplyScalar(0.4);
    const c = neb[2]!.clone().multiplyScalar(0.5).addScalar(0.02);
    (this.planetMat.uniforms.uA!.value as THREE.Vector3).copy(a);
    (this.planetMat.uniforms.uB!.value as THREE.Vector3).copy(b);
    (this.planetMat.uniforms.uC!.value as THREE.Vector3).copy(c);
    (this.planetMat.uniforms.uAtmo!.value as THREE.Vector3).copy(neb[1]!).multiplyScalar(0.9).add(hexToLinearVec(pal.star, 0.3));
    this.planetMat.uniforms.uSeed!.value = rng.next() * 100;
    // rings tilted through the planet
    const hasRings = rng.chance(0.75);
    this.rings.visible = this.planet.visible && hasRings;
    this.rings.position.copy(this.planet.position);
    this.rings.scale.setScalar(radius);
    this.rings.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2 + rng.range(-0.55, 0.55), rng.range(0, Math.PI), rng.range(-0.35, 0.35)));
    (this.ringMat.uniforms.uCol!.value as THREE.Vector3).copy(neb[0]!).lerp(new THREE.Vector3(0.8, 0.75, 0.7), 0.7).multiplyScalar(0.32);
    this.ringMat.uniforms.uSeed!.value = rng.next() * 50;

    // --- the belt: an arc of mountain-sized rocks sweeping round the arena
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.35, 0.35), rng.range(0, Math.PI * 2), rng.range(-0.25, 0.25)));
    const beltR = rng.range(1500, 1900);
    const arc0 = rng.range(0, Math.PI * 2);
    const n = Vista.BELT_CAP;
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = arc0 + (i / n) * Math.PI * 1.35 + rng.range(-0.03, 0.03);
      const rr = beltR + rng.range(-260, 260) * (rng.chance(0.2) ? 1.8 : 1);
      p.set(Math.cos(t) * rr, rng.range(-70, 70), Math.sin(t) * rr).applyQuaternion(tilt);
      // a few true giants among a crowd of large rocks
      const k = rng.chance(0.12) ? rng.range(28, 60) : rng.range(5, 20);
      s.set(k * rng.range(0.8, 1.3), k * rng.range(0.7, 1.1), k * rng.range(0.8, 1.3));
      q.setFromEuler(new THREE.Euler(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)));
      m.compose(p, q, s);
      this.belt.setMatrixAt(i, m);
      // the tint only lights emissive seams: keep those as faint embers
      const ember = rng.range(0.02, 0.08);
      this.belt.instanceColor!.setXYZ(i, ember * 2, ember, ember * 0.5);
    }
    this.belt.count = n;
    this.belt.instanceMatrix.needsUpdate = true;
    this.belt.instanceColor!.needsUpdate = true;

    // --- the megastructure: a broken ring, light-years of scaffolding
    this.ring.visible = rng.chance(0.85);
    this.ring.scale.setScalar(rng.range(3300, 3900));
    // steeply tilted so it sweeps across the sky as an arch, never a horizon bar
    this.ring.quaternion.setFromEuler(new THREE.Euler(rng.range(0.75, 1.15) * (rng.chance(0.5) ? 1 : -1), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3)));
    this.ring.position.set(rng.range(-500, 500), rng.range(-200, 200), rng.range(-500, 500));
    const lights = neb[1]!;
    (this.hullMat.uniforms.uTint!.value as THREE.Color).setRGB(lights.x * 2.5 + 0.4, lights.y * 2.5 + 0.35, lights.z * 2.5 + 0.3);
  }

  update(camPos: THREE.Vector3): void {
    // the planet is so far away it barely parallaxes; a hint of it still sells depth
    this.sky.position.copy(camPos).multiplyScalar(0.985);
    const pp = this.planet.position;
    (this.ringMat.uniforms.uPlanet!.value as THREE.Vector4).set(pp.x + this.sky.position.x, pp.y + this.sky.position.y, pp.z + this.sky.position.z, this.planet.scale.x);
  }
}

/** A colossal ring station, deliberately broken into arcs with gaps. */
function buildMegaRing(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  let a = rng.range(0, 1);
  while (a < Math.PI * 2 - 0.3) {
    const len = rng.range(0.5, 1.4);
    const end = Math.min(a + len, Math.PI * 2 - 0.05);
    // the hull band: a flattened box-section torus arc
    const band = new THREE.TorusGeometry(1, 0.018, 4, Math.max(8, Math.round((end - a) * 60)), end - a);
    band.rotateZ(a);
    band.scale(1, 1, 3.2);
    parts.push(prep(band, '#5a5468', 0));
    // a lit window strip along the inner face
    const strip = new THREE.TorusGeometry(0.985, 0.0016, 3, Math.max(8, Math.round((end - a) * 60)), end - a);
    strip.rotateZ(a);
    parts.push(prep(strip, '#ffffff', 1));
    // structural ribs every few degrees, alternating tone: reads as engineered at any distance
    const ribs = Math.floor((end - a) / 0.03);
    for (let i = 0; i < ribs; i++) {
      const t = a + (i + 0.5) * 0.03;
      const rib = new THREE.BoxGeometry(0.05, 0.006, 0.075);
      rib.rotateZ(t);
      rib.translate(Math.cos(t), Math.sin(t), 0);
      parts.push(prep(rib, i % 4 === 0 ? '#8a8098' : '#3c3648', i % 9 === 0 ? 0.6 : 0));
    }
    // outer habitat face: a lighter strip so the band has a lit edge and a shadowed one
    const face = new THREE.TorusGeometry(1.012, 0.004, 3, Math.max(8, Math.round((end - a) * 60)), end - a);
    face.rotateZ(a);
    face.scale(1, 1, 5.5);
    parts.push(prep(face, '#9a92a8', 0));
    // spokes / docking pylons
    const spokes = Math.floor((end - a) * 3);
    for (let i = 0; i < spokes; i++) {
      const t = a + ((i + 0.5) / spokes) * (end - a);
      const pylon = new THREE.BoxGeometry(0.11, 0.008, 0.02);
      pylon.translate(-0.06, 0, 0);
      pylon.rotateZ(t);
      pylon.translate(Math.cos(t), Math.sin(t), 0);
      parts.push(prep(pylon, '#46405a', 0));
    }
    a = end + rng.range(0.12, 0.45);
  }
  const g = mergeGeometries(parts, false)!;
  g.rotateX(Math.PI / 2);
  return g;
}

const PLANET_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vView;
void main() {
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vView = normalize(cameraPosition - wp.xyz);
  vec4 cp = projectionMatrix * viewMatrix * wp;
  cp.z = cp.w * 0.999999; // always at the far plane
  gl_Position = cp;
}
`;

const PLANET_FRAG = /* glsl */ `
uniform vec3 uStarDir;
uniform vec3 uStarColor;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uAtmo;
uniform float uSeed;
uniform float uTime;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vView;
float hh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float nn(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1, 0, 0)), f.x), mix(hh(i + vec3(0, 1, 0)), hh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hh(i + vec3(0, 0, 1)), hh(i + vec3(1, 0, 1)), f.x), mix(hh(i + vec3(0, 1, 1)), hh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += nn(p) * a; p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 n = normalize(vN);
  // latitude bands, warped by turbulence, with a great storm
  float lat = vLocal.y;
  float warp = fbm(vLocal * 3.0 + uSeed) * 0.35 + fbm(vLocal * 9.0 + uSeed * 2.0 + vec3(uTime * 0.004, 0.0, 0.0)) * 0.08;
  float band = sin((lat + warp) * 22.0 + uSeed) * 0.5 + 0.5;
  float band2 = sin((lat + warp * 1.6) * 57.0) * 0.5 + 0.5;
  vec3 albedo = mix(uA, uB, band);
  albedo = mix(albedo, uC, band2 * 0.35);
  vec3 sp = normalize(vec3(0.6, -0.25, 0.75));
  float storm = smoothstep(0.22, 0.0, distance(normalize(vLocal), sp) + (fbm(vLocal * 14.0) - 0.5) * 0.08);
  albedo = mix(albedo, uC * 1.6 + 0.05, storm * 0.8);
  // terminator: soft, a touch of wrap, a night side that is not quite black
  float ndl = dot(n, uStarDir);
  float day = smoothstep(-0.12, 0.35, ndl);
  vec3 col = albedo * uStarColor * day * 1.15 + albedo * 0.025;
  // atmosphere: rim scattering, brightest on the day-side limb
  float rim = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
  col += uAtmo * rim * (0.25 + 1.4 * smoothstep(-0.3, 0.6, ndl));
  gl_FragColor = vec4(col, 0.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vWorld;
varying float vR;
void main() {
  vR = length(position.xy);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 cp = projectionMatrix * viewMatrix * wp;
  cp.z = cp.w * 0.999999;
  gl_Position = cp;
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uStarDir;
uniform vec3 uStarColor;
uniform vec3 uCol;
uniform vec4 uPlanet;
uniform float uSeed;
varying vec3 vWorld;
varying float vR;
float h1(float x) { return fract(sin(x * 91.7 + uSeed) * 43758.5453); }
void main() {
  // fine ringlets with a few clean gaps (Cassini-style divisions)
  float r = vR;
  float ringlet = h1(floor(r * 140.0)) * 0.6 + h1(floor(r * 37.0)) * 0.4;
  float gap = smoothstep(0.0, 0.015, abs(r - 1.93)) * smoothstep(0.0, 0.008, abs(r - 2.21));
  float edge = smoothstep(1.45, 1.55, r) * smoothstep(2.4, 2.25, r);
  float alpha = ringlet * gap * edge * 0.42;
  // the far half of the ring hides behind the planet
  vec3 rd = vWorld - cameraPosition;
  float fl = length(rd);
  rd /= fl;
  vec3 oc = cameraPosition - uPlanet.xyz;
  float bq = dot(oc, rd);
  float cq = dot(oc, oc) - uPlanet.w * uPlanet.w;
  float disc = bq * bq - cq;
  if (disc > 0.0 && -bq - sqrt(disc) < fl) discard;
  // the planet's shadow falls across the ring
  vec3 toP = uPlanet.xyz - vWorld;
  float along = dot(toP, uStarDir);
  vec3 perp = toP - uStarDir * along;
  float shadow = (along > 0.0 && length(perp) < uPlanet.w) ? 0.1 : 1.0;
  vec3 col = uCol * uStarColor * (0.35 + ringlet * 0.5) * shadow;
  gl_FragColor = vec4(col, alpha);
}
`;
