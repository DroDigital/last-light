import * as THREE from 'three';
import { HULL_FRAG, HULL_VERT, NEBULA_FRAG, NEBULA_VERT, STAR_FRAG, STAR_VERT } from './shaders';
import type { LightRig } from './pipeline';
import { hdrAdditive } from './fx';

export function makeHullMaterial(lights: LightRig, opts: { rim?: number; emissive?: number } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    uniforms: {
      ...lights.uniforms,
      uRim: { value: opts.rim ?? 1.6 },
      uEmissive: { value: opts.emissive ?? 3.0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uFx: { value: new THREE.Vector4(0, 0, 0, 0) },
      // player ship light style (see SHIP_GLOW_CHUNK); 0 = classic for everything else
      uGlowStyle: { value: 0 },
    },
  });
}

export function makeNebulaMaterial(lights: LightRig): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    uniforms: { ...lights.uniforms, uIntensity: { value: 1 } },
    side: THREE.DoubleSide,
    depthTest: true,
  });
  hdrAdditive(m);
  return m;
}

export function makeStarMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 0.8, 0.6) },
      uPower: { value: 1 },
      uTime: { value: 0 },
      uPulse: { value: 0 },
    },
    depthWrite: false,
  });
  hdrAdditive(m);
  return m;
}
