import * as THREE from 'three';
import { buildPlayerShip } from '../render/meshes';
import { hexToRgb } from '../core/math';

/**
 * Turntable preview of a ship for the class screen. One small WebGL context,
 * shared by every preview: the ship renders at a low internal resolution with
 * the game's 4x4 ordered dither and a crisp accent edge pass, then scales up
 * pixelated, so it reads like the ship in flight.
 */
// Same look as the in-flight hull shader (render/shaders.ts HULL_FRAG): an
// object-space plating grid, wrapped key light with hemispheric ambient, a
// glossy star highlight and a back-lit rim, then the 4x4 ordered dither.
const VERT = /* glsl */ `
attribute vec3 color;
attribute float aEmit;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying vec3 vLocal;
varying float vEmit;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vCol = color;
  vLocal = position;
  vEmit = aEmit;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying vec3 vLocal;
varying float vEmit;
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
// 4x4 ordered-dither threshold (recursive 2x2 Bayer)
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer(vec2 p) { return bayer2(0.5 * p) * 0.25 + bayer2(p); }
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  vec3 key = normalize(vec3(-0.5, 0.8, 0.6));
  vec3 albedo = vCol;
  if (vEmit < 0.5) {
    vec3 g = vLocal * vec3(2.2, 2.2, 1.4);
    vec3 fw = fwidth(g) + 1e-4;
    vec3 ln = 1.0 - smoothstep(vec3(0.0), fw * 1.2, abs(fract(g - 0.5) - 0.5));
    vec3 an = abs(n);
    float line = max(max(ln.y * an.x, ln.z * an.x), max(max(ln.x * an.y, ln.z * an.y), max(ln.x * an.z, ln.y * an.z)));
    albedo *= 1.0 - line * 0.45 * (1.0 - smoothstep(0.18, 0.45, max(fw.x, max(fw.y, fw.z))));
    albedo *= 0.88 + 0.24 * hash13(floor(g));
  }
  float ndl = dot(n, key);
  float wrapL = max((ndl + 0.25) / 1.25, 0.0);
  vec3 hemi = vec3(0.16, 0.18, 0.26) * mix(0.55, 1.6, n.y * 0.5 + 0.5);
  vec3 col = albedo * (vec3(1.0, 0.95, 0.88) * wrapL * 2.2 + hemi * 3.0);
  float spec = pow(max(dot(n, normalize(key + v)), 0.0), 48.0) * step(0.0, ndl);
  col += vec3(1.0, 0.95, 0.88) * spec * 0.9 * (1.0 - vEmit);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uTint * fres * 1.1;
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
  col = mix(col, uTint * 1.6 + vec3(0.35), clamp(vEmit, 0.0, 1.0) * pulse);
  // posterize through the ordered dither, like the game's palette pass
  float levels = 6.0;
  col = floor(col * levels + bayer(gl_FragCoord.xy)) / levels;
  gl_FragColor = vec4(col, 1.0);
}`;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let mesh: THREE.Mesh | null = null;
let edges: THREE.LineSegments | null = null;
let mat: THREE.ShaderMaterial;
let edgeMat: THREE.LineBasicMaterial;
let current = '';
let host: HTMLElement | null = null;
let raf = 0;
let t0 = 0;

const W = 220;
const H = 140;

function init(): boolean {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  } catch {
    return false;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'ship-preview-canvas';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  camera.position.set(0, 2.1, 6.4);
  camera.lookAt(0, 0, 0);
  mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTint: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 } } });
  edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 });
  return true;
}

function setShip(hull: string, accent: string): void {
  if (current === hull) return;
  current = hull;
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  if (edges) {
    scene.remove(edges);
    edges.geometry.dispose();
  }
  const geo = buildPlayerShip(hull);
  mesh = new THREE.Mesh(geo, mat);
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), edgeMat);
  scene.add(mesh, edges);
  const [r, g, b] = hexToRgb(accent);
  (mat.uniforms.uTint!.value as THREE.Color).setRGB(r, g, b);
  edgeMat.color.setRGB(r * 0.8 + 0.2, g * 0.8 + 0.2, b * 0.8 + 0.2);
}

function frame(now: number): void {
  if (!renderer || !host || !renderer.domElement.isConnected) {
    raf = 0;
    host = null;
    return;
  }
  const t = (now - t0) / 1000;
  mat.uniforms.uTime!.value = t;
  const yaw = Math.PI * 0.85 + t * 0.55;
  for (const o of [mesh, edges]) {
    if (!o) continue;
    o.rotation.set(Math.sin(t * 0.7) * 0.08, yaw, Math.sin(t * 0.9) * 0.12);
    o.position.y = Math.sin(t * 1.3) * 0.08;
  }
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}

/** Mount a turntable of `hull` into the element; it stops by itself once the element leaves the DOM. */
export function mountShipPreview(el: HTMLElement | null, hull: string, accent: string): void {
  if (!el || !init() || !renderer) return;
  setShip(hull, accent);
  host = el;
  el.appendChild(renderer.domElement);
  if (!raf) {
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }
}
