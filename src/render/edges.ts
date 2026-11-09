import * as THREE from 'three';
import { hdrAdditive } from './fx';

/**
 * Dither-bloom vector edges (style C). Every hull is drawn twice as line edges:
 *  - HALO: into the low-res HDR world, so bloom + palette dither turn it into a
 *    dithered glow that belongs to the painterly scene;
 *  - CORE: at native resolution after the post pass, a crisp 1px line that is
 *    hidden-line occluded by a native-res depth prepass of the hulls.
 * Instance data (matrix, tint, fx) is shared with the hull InstancedMesh, so the
 * cost is one extra draw per mesh kind per pass and zero extra uploads.
 */
const EDGE_VERT = /* glsl */ `
attribute mat4 iMatrix;
attribute vec3 iColor;
attribute vec4 iFx;     // x flash, y dissolve, z emissive boost, w cloak
uniform float uBias;
varying vec3 vCol;
varying float vA;
varying float vFlash;
void main() {
  vec4 wp = modelMatrix * iMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z -= uBias * gl_Position.w;
  vCol = iColor;
  vFlash = clamp(iFx.x, 0.0, 1.0);
  vA = (1.0 - clamp(iFx.y, 0.0, 1.0)) * (1.0 - clamp(iFx.w, 0.0, 1.0)) * (1.0 + iFx.z * 0.35);
}
`;

const HALO_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vFlash;
uniform float uGain;
void main() {
  gl_FragColor = vec4(vCol * uGain * vA * (1.0 + vFlash * 3.0), 0.0);
}
`;

const CORE_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vFlash;
uniform float uGain;
void main() {
  // pale core: mostly white with a breath of the tint, like a hot neon filament
  vec3 c = mix(vCol, vec3(1.0), 0.62);
  gl_FragColor = vec4(c * (uGain + vFlash * 0.8) * vA, 1.0);
}
`;

export function edgeGeometry(src: THREE.BufferGeometry, angle = 28): THREE.BufferGeometry {
  const e = new THREE.EdgesGeometry(src, angle);
  return e;
}

export interface EdgeSource {
  matrix: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  fx: THREE.InstancedBufferAttribute;
}

export class EdgeBatch {
  readonly halo: THREE.LineSegments;
  readonly core: THREE.LineSegments;
  readonly geo: THREE.InstancedBufferGeometry;
  private own: EdgeSource | null = null;
  count = 0;

  constructor(base: THREE.BufferGeometry, src: EdgeSource | number, opts: { haloGain?: number; coreGain?: number; angle?: number } = {}) {
    const edges = edgeGeometry(base, opts.angle ?? 28);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', edges.getAttribute('position'));
    let s: EdgeSource;
    if (typeof src === 'number') {
      const mk = (n: number) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(src * n), n);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      };
      s = { matrix: mk(16), color: mk(3), fx: mk(4) };
      this.own = s;
    } else s = src;
    this.geo.setAttribute('iMatrix', s.matrix);
    this.geo.setAttribute('iColor', s.color);
    this.geo.setAttribute('iFx', s.fx);
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const haloMat = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { uBias: { value: 0.0004 }, uGain: { value: opts.haloGain ?? 1.6 } },
    });
    hdrAdditive(haloMat);
    haloMat.depthTest = true;
    const coreMat = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERT,
      fragmentShader: CORE_FRAG,
      uniforms: { uBias: { value: 0.0006 }, uGain: { value: opts.coreGain ?? 0.55 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    });
    this.halo = new THREE.LineSegments(this.geo, haloMat);
    this.core = new THREE.LineSegments(this.geo, coreMat);
    for (const o of [this.halo, this.core]) {
      o.frustumCulled = false;
    }
    this.halo.renderOrder = 4;
  }

  /** Retune the halo (dithered bloom) and core (crisp line) strengths. */
  setGains(halo: number, core: number): void {
    (this.halo.material as THREE.ShaderMaterial).uniforms.uGain!.value = halo;
    (this.core.material as THREE.ShaderMaterial).uniforms.uGain!.value = core;
  }

  /** For batches that own their instance data. */
  begin(): void {
    this.count = 0;
  }

  push(m: THREE.Matrix4, r: number, g: number, b: number, flash = 0, dissolve = 0, boost = 0, cloak = 0): void {
    const s = this.own;
    if (!s || this.count >= s.matrix.count) return;
    const i = this.count++;
    s.matrix.set(m.elements, i * 16);
    s.color.setXYZ(i, r, g, b);
    s.fx.setXYZW(i, flash, dissolve, boost, cloak);
  }

  end(count = this.count): void {
    this.geo.instanceCount = count;
    const s = this.own;
    if (s) {
      for (const [a, n] of [[s.matrix, 16], [s.color, 3], [s.fx, 4]] as const) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, count) * n);
        a.needsUpdate = true;
      }
    }
    this.halo.visible = this.core.visible = count > 0;
  }
}
