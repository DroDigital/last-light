import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexToRgb, srgbToLinear } from '../core/math';
import { Rng } from '../core/rng';

/**
 * Procedural hero geometry. Everything is faceted (non-indexed) so silhouettes
 * read strongly under rim light and survive posterization. Each vertex carries
 * an albedo color and an emissive mask (aEmit) that the per-instance tint lights.
 */
type Part = { geo: THREE.BufferGeometry; color: string; emit: number };

function prep(geo: THREE.BufferGeometry, color: string, emit: number, m?: THREE.Matrix4): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (m) g.applyMatrix4(m);
  g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const [r, gg, b] = hexToRgb(color).map(srgbToLinear) as [number, number, number];
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = b;
    em[i] = emit;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  if (g.getAttribute('normal') === undefined) g.computeVertexNormals();
  g = g.clone();
  return g;
}

const M = new THREE.Matrix4();
function tr(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  return M.clone().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

class B {
  parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: string, emit: number, m?: THREE.Matrix4): this {
    this.parts.push(prep(geo, color, emit, m));
    return this;
  }
  mirrorX(geo: () => THREE.BufferGeometry, color: string, emit: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): this {
    this.add(geo(), color, emit, tr(x, y, z, rx, ry, rz, sx, sy, sz));
    this.add(geo(), color, emit, tr(-x, y, z, rx, -ry, -rz, sx, sy, sz));
    return this;
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    g.computeBoundingSphere();
    return g;
  }
}

const HULL = '#1a1820';
const HULL2 = '#2a2630';
const DARK = '#0b0a0e';

// --- Player hulls (forward is -Z) -------------------------------------------

export function buildPlayerShip(hull: string): THREE.BufferGeometry {
  const b = new B();
  switch (hull) {
    case 'moth': {
      b.add(new THREE.ConeGeometry(0.35, 2.2, 5), HULL, 0, tr(0, 0, -0.3, -Math.PI / 2));
      b.mirrorX(() => new THREE.BoxGeometry(1.8, 0.05, 0.9), HULL2, 0, 0.95, 0, 0.3, 0, 0.3, 0.15);
      b.mirrorX(() => new THREE.BoxGeometry(1.5, 0.06, 0.12), '#ffffff', 1, 1.0, 0.03, 0.72, 0, 0.3, 0.15);
      b.add(new THREE.SphereGeometry(0.18, 6, 4), '#ffffff', 1, tr(0, 0, 0.85));
      break;
    }
    case 'bastion': {
      b.add(new THREE.BoxGeometry(1.4, 0.7, 2.6), HULL, 0, tr(0, 0, 0));
      b.add(new THREE.BoxGeometry(0.9, 0.5, 1.0), HULL2, 0, tr(0, 0.35, -0.7));
      b.mirrorX(() => new THREE.BoxGeometry(0.6, 0.9, 2.2), HULL2, 0, 1.0, 0, 0.2);
      b.mirrorX(() => new THREE.CylinderGeometry(0.28, 0.32, 0.4, 8), '#ffffff', 1, 1.0, 0, 1.35, Math.PI / 2);
      b.add(new THREE.BoxGeometry(0.7, 0.1, 0.1), '#ffffff', 1, tr(0, 0.62, -1.2));
      break;
    }
    case 'prism': {
      b.add(new THREE.OctahedronGeometry(0.9, 0), HULL2, 0, tr(0, 0, 0, 0, 0, 0, 0.8, 0.6, 1.8));
      b.mirrorX(() => new THREE.TetrahedronGeometry(0.6), HULL, 0, 1.0, 0, 0.4, 0.2, 0, 0.5, 1, 0.4, 1.6);
      b.add(new THREE.OctahedronGeometry(0.28, 0), '#ffffff', 1, tr(0, 0.2, -0.3));
      b.add(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 6), '#ffffff', 1, tr(0, 0, 1.5, Math.PI / 2));
      break;
    }
    case 'ember': {
      b.add(new THREE.ConeGeometry(0.6, 2.8, 6), HULL, 0, tr(0, 0, -0.2, -Math.PI / 2));
      b.mirrorX(() => new THREE.BoxGeometry(1.3, 0.12, 1.2), HULL2, 0, 0.8, -0.1, 0.5, 0, 0.5, -0.25);
      b.mirrorX(() => new THREE.BoxGeometry(0.12, 0.5, 0.9), '#ffffff', 0.7, 1.35, 0.1, 0.6, 0, 0, 0.2);
      b.add(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 6), '#ffffff', 1, tr(0, 0, 1.25, Math.PI / 2));
      break;
    }
    case 'wraith': {
      b.add(new THREE.ConeGeometry(0.5, 3.0, 3), HULL, 0, tr(0, 0, -0.3, -Math.PI / 2, 0, Math.PI));
      b.mirrorX(() => new THREE.ConeGeometry(0.25, 2.0, 3), HULL2, 0, 0.8, 0, 0.6, -Math.PI / 2, 0, 0.3);
      b.mirrorX(() => new THREE.SphereGeometry(0.16, 5, 3), '#ffffff', 1, 0.8, 0, 1.55);
      b.add(new THREE.BoxGeometry(0.05, 0.4, 1.4), '#ffffff', 0.6, tr(0, 0.25, 0.2));
      break;
    }
    default: {
      // The Lantern: a lightship carrying its own little sun
      b.add(new THREE.ConeGeometry(0.55, 2.6, 6), HULL, 0, tr(0, 0, -0.5, -Math.PI / 2));
      b.add(new THREE.BoxGeometry(0.8, 0.45, 1.4), HULL2, 0, tr(0, 0, 0.6));
      b.mirrorX(() => new THREE.BoxGeometry(1.6, 0.08, 0.9), HULL2, 0, 0.95, 0, 0.6, 0, 0.35, 0);
      b.mirrorX(() => new THREE.BoxGeometry(0.2, 0.25, 1.1), HULL, 0, 1.75, 0, 0.75);
      b.mirrorX(() => new THREE.CylinderGeometry(0.2, 0.26, 0.35, 6), '#ffffff', 1, 0.55, 0, 1.4, Math.PI / 2);
      b.add(new THREE.IcosahedronGeometry(0.26, 0), '#ffffff', 1, tr(0, 0.3, 0.1)); // the lantern
      b.mirrorX(() => new THREE.BoxGeometry(0.06, 0.04, 0.8), '#ffffff', 0.6, 1.75, 0.15, 0.75);
    }
  }
  return b.build();
}

// --- Enemies -----------------------------------------------------------------

export type MeshKind =
  | 'hushSpike'
  | 'hushDart'
  | 'hushBlob'
  | 'hushEye'
  | 'salvBox'
  | 'salvRam'
  | 'salvGun'
  | 'salvHauler'
  | 'salvTurret'
  | 'choirShard'
  | 'choirPrism'
  | 'choirHalo'
  | 'choirSeraph'
  | 'asteroid'
  | 'debris'
  | 'plate'
  | 'segment'
  | 'bossCore'
  | 'drone'
  | 'halo';

function displaced(geo: THREE.BufferGeometry, rng: Rng, amt: number): THREE.BufferGeometry {
  const g = geo.index ? geo : geo;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = 1 + (rng.next() - 0.5) * amt;
      map.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  return g;
}

export function buildEnemyMesh(kind: MeshKind, seed = 1): THREE.BufferGeometry {
  const b = new B();
  const rng = new Rng(seed);
  switch (kind) {
    case 'hushSpike': {
      b.add(displaced(new THREE.IcosahedronGeometry(0.8, 0), rng, 0.5), DARK, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(new THREE.ConeGeometry(0.18, 1.0, 4), DARK, 0, tr(Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0, 0, 0, a - Math.PI / 2));
      }
      b.add(new THREE.SphereGeometry(0.22, 6, 4), '#ffffff', 1, tr(0, 0, -0.65));
      break;
    }
    case 'hushDart': {
      b.add(new THREE.ConeGeometry(0.5, 2.6, 4), DARK, 0, tr(0, 0, 0, -Math.PI / 2));
      b.mirrorX(() => new THREE.ConeGeometry(0.15, 1.4, 3), DARK, 0, 0.6, 0, 0.6, -Math.PI / 2.4, 0, 0.6);
      b.add(new THREE.OctahedronGeometry(0.22, 0), '#ffffff', 1, tr(0, 0.1, -0.6));
      break;
    }
    case 'hushBlob': {
      b.add(displaced(new THREE.IcosahedronGeometry(1.2, 1), rng, 0.45), DARK, 0);
      b.add(displaced(new THREE.IcosahedronGeometry(0.7, 0), rng, 0.4), DARK, 0, tr(0.7, 0.5, 0.3));
      b.add(new THREE.SphereGeometry(0.3, 6, 4), '#ffffff', 1, tr(0, 0.1, -1.05));
      b.add(new THREE.SphereGeometry(0.16, 6, 4), '#ffffff', 1, tr(0.5, 0.4, -0.9));
      break;
    }
    case 'hushEye': {
      b.add(new THREE.TorusGeometry(1.1, 0.25, 4, 10), DARK, 0);
      b.add(new THREE.SphereGeometry(0.55, 8, 6), '#ffffff', 1);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        b.add(new THREE.ConeGeometry(0.16, 1.4, 3), DARK, 0, tr(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0, 0, 0, a - Math.PI / 2));
      }
      break;
    }
    case 'salvBox': {
      b.add(new THREE.BoxGeometry(1.2, 0.8, 1.4), HULL2, 0);
      b.mirrorX(() => new THREE.BoxGeometry(0.4, 0.3, 1.0), HULL, 0, 0.8, 0, 0.1);
      b.add(new THREE.BoxGeometry(0.5, 0.2, 0.1), '#ffffff', 1, tr(0, 0.15, -0.72));
      b.mirrorX(() => new THREE.CylinderGeometry(0.15, 0.15, 0.3, 6), '#ffffff', 0.8, 0.8, 0, 0.65, Math.PI / 2);
      break;
    }
    case 'salvRam': {
      b.add(new THREE.CylinderGeometry(0.2, 0.9, 2.6, 6), HULL2, 0, tr(0, 0, 0, -Math.PI / 2));
      b.add(new THREE.ConeGeometry(0.4, 1.0, 6), '#5a5a60', 0, tr(0, 0, -1.6, -Math.PI / 2));
      b.add(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 6), '#ffffff', 1, tr(0, 0, 1.35, Math.PI / 2));
      break;
    }
    case 'salvGun': {
      b.add(new THREE.OctahedronGeometry(1, 0), HULL2, 0, tr(0, 0, 0, 0, 0, 0, 1.3, 0.6, 1.3));
      b.mirrorX(() => new THREE.BoxGeometry(0.2, 0.2, 1.6), HULL, 0, 0.7, -0.1, -0.6);
      b.mirrorX(() => new THREE.BoxGeometry(0.22, 0.22, 0.2), '#ffffff', 1, 0.7, -0.1, -1.4);
      b.add(new THREE.BoxGeometry(0.6, 0.15, 0.15), '#ffffff', 0.8, tr(0, 0.3, 0.2));
      break;
    }
    case 'salvHauler': {
      b.add(new THREE.BoxGeometry(2.2, 1.4, 3.6), HULL2, 0);
      b.add(new THREE.BoxGeometry(1.4, 0.8, 1.2), HULL, 0, tr(0, 0.9, -1.0));
      b.mirrorX(() => new THREE.BoxGeometry(0.5, 1.8, 2.8), HULL, 0, 1.4, 0, 0.2);
      b.add(new THREE.BoxGeometry(1.6, 0.9, 0.1), '#ffffff', 0.9, tr(0, 0, 1.82));
      b.mirrorX(() => new THREE.BoxGeometry(0.1, 0.1, 2.6), '#ffffff', 0.6, 1.66, 0.6, 0.2);
      break;
    }
    case 'salvTurret': {
      b.add(new THREE.CylinderGeometry(0.9, 1.2, 0.8, 8), HULL2, 0);
      b.add(new THREE.SphereGeometry(0.7, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), HULL, 0, tr(0, 0.4, 0));
      b.mirrorX(() => new THREE.BoxGeometry(0.16, 0.16, 1.6), HULL, 0, 0.3, 0.7, -0.6);
      b.add(new THREE.SphereGeometry(0.2, 6, 4), '#ffffff', 1, tr(0, 0.8, -0.3));
      break;
    }
    case 'choirShard': {
      b.add(new THREE.OctahedronGeometry(0.7, 0), '#3a3048', 0.15, tr(0, 0, 0, 0, 0, 0, 0.6, 0.6, 1.8));
      b.add(new THREE.OctahedronGeometry(0.3, 0), '#ffffff', 1, tr(0, 0, 0, 0, 0, 0, 0.8, 0.8, 1.5));
      break;
    }
    case 'choirPrism': {
      b.add(new THREE.CylinderGeometry(0, 1.0, 2.4, 3), '#3a3048', 0.1, tr(0, 0.6, 0));
      b.add(new THREE.CylinderGeometry(1.0, 0, 1.2, 3), '#3a3048', 0.1, tr(0, -1.2, 0));
      b.add(new THREE.OctahedronGeometry(0.4, 0), '#ffffff', 1, tr(0, -0.1, 0));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(new THREE.OctahedronGeometry(0.25, 0), '#ffffff', 0.7, tr(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4, 0, 0, 0, 0.5, 1.6, 0.5));
      }
      break;
    }
    case 'choirHalo': {
      b.add(new THREE.TorusGeometry(1.2, 0.12, 3, 12), '#3a3048', 0.3);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(new THREE.OctahedronGeometry(0.3, 0), '#ffffff', 0.9, tr(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0, 0, 0, a, 0.5, 1.4, 0.5));
      }
      b.add(new THREE.IcosahedronGeometry(0.5, 0), '#5a4870', 0.3);
      break;
    }
    case 'choirSeraph': {
      b.add(new THREE.OctahedronGeometry(0.6, 0), '#3a3048', 0.2, tr(0, 0, 0, 0, 0, 0, 0.8, 1.6, 0.8));
      b.mirrorX(() => new THREE.ConeGeometry(0.35, 2.4, 3), '#3a3048', 0.15, 1.2, 0.4, 0, 0, 0, -1.1);
      b.mirrorX(() => new THREE.ConeGeometry(0.25, 1.8, 3), '#3a3048', 0.15, 1.0, -0.5, 0, 0, 0, -2.0);
      b.add(new THREE.OctahedronGeometry(0.25, 0), '#ffffff', 1, tr(0, 0.5, -0.3));
      break;
    }
    case 'asteroid': {
      const g = displaced(new THREE.IcosahedronGeometry(1, 1), rng, 0.55);
      g.scale(1 + rng.next() * 0.4, 0.8 + rng.next() * 0.3, 1 + rng.next() * 0.3);
      b.add(g, '#2a2420', 0);
      b.add(displaced(new THREE.IcosahedronGeometry(0.45, 0), rng, 0.4), '#221e1a', 0, tr(0.7, 0.3, 0.2));
      break;
    }
    case 'debris': {
      b.add(displaced(new THREE.TetrahedronGeometry(0.5, 0), rng, 0.6), '#2a2620', 0.5);
      break;
    }
    case 'plate': {
      b.add(new THREE.BoxGeometry(2.2, 0.5, 2.0), '#3a2a26', 0);
      b.add(new THREE.BoxGeometry(1.6, 0.12, 1.4), '#ffffff', 0.4, tr(0, 0.3, 0));
      break;
    }
    case 'segment': {
      b.add(new THREE.CylinderGeometry(1.6, 1.8, 2.6, 8), DARK, 0, tr(0, 0, 0, Math.PI / 2));
      b.mirrorX(() => new THREE.ConeGeometry(0.4, 1.6, 4), DARK, 0, 1.6, 0.6, 0, 0, 0, -1.0);
      b.add(new THREE.BoxGeometry(0.3, 0.3, 2.0), '#ffffff', 0.8, tr(0, 1.7, 0));
      break;
    }
    case 'bossCore': {
      b.add(new THREE.IcosahedronGeometry(2.4, 1), HULL2, 0);
      b.add(new THREE.IcosahedronGeometry(1.2, 0), '#ffffff', 1, tr(0, 0, -1.8));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.add(new THREE.BoxGeometry(0.4, 0.4, 2.0), HULL, 0, tr(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0.5, 0, 0, a));
      }
      break;
    }
    case 'drone': {
      b.add(new THREE.OctahedronGeometry(0.45, 0), HULL2, 0, tr(0, 0, 0, 0, 0, 0, 1, 0.5, 1.4));
      b.add(new THREE.SphereGeometry(0.16, 6, 4), '#ffffff', 1, tr(0, 0.15, 0));
      break;
    }
    case 'halo': {
      b.add(new THREE.OctahedronGeometry(0.5, 0), '#ffffff', 1, tr(0, 0, 0, 0, 0, 0, 0.4, 0.4, 1.6));
      break;
    }
  }
  return b.build();
}

export type _UnusedPart = Part;
