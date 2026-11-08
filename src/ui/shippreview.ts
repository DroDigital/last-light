import * as THREE from 'three';
import { buildPlayerShip } from '../render/meshes';
import { hexToRgb } from '../core/math';

/**
 * Turntable preview of a ship for the class screen. One small WebGL context,
 * shared by every preview: the ship renders at a low internal resolution with
 * the game's 4x4 ordered dither and a crisp accent edge pass, then scales up
 * pixelated, so it reads like the ship in flight.
 */
const VERT = /* glsl */ `
attribute vec3 color;
attribute float aEmit;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying float vEmit;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vCol = color;
  vEmit = aEmit;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying float vEmit;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
  return 0.5;
}
void main() {
  vec3 n = normalize(vN);
  vec3 key = normalize(vec3(-0.5, 0.8, 0.6));
  float diff = max(dot(n, key), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.5);
  vec3 base = vCol * (0.22 + diff * 1.6) + vec3(0.55, 0.62, 0.8) * 0.12;
  base += uTint * rim * 1.4;
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
  vec3 col = mix(base, uTint * 1.6 + vec3(0.35), vEmit * pulse);
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
  edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
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
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
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
