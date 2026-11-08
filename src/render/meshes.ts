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

export function prep(geo: THREE.BufferGeometry, color: string, emit: number, m?: THREE.Matrix4): THREE.BufferGeometry {
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

// enemy plating: dark, but light enough that panel lines and speculars read
const HULL = '#25222c';
const HULL2 = '#363140';
const DARK = '#121017';
// player livery: gunmetal plating, lighter armour, smoked glass, black intakes
const PH = '#302c38';
const PH2 = '#433e4d';
const GLASS = '#1d3446';
const PDARK = '#0e0d12';

// --- Player hulls (forward is -Z) -------------------------------------------

export function buildPlayerShip(hull: string): THREE.BufferGeometry {
  const b = new B();
  switch (hull) {
    case 'moth': {
      b.add(new THREE.ConeGeometry(0.35, 2.2, 5), PH, 0, tr(0, 0, -0.3, -Math.PI / 2));
      b.mirrorX(() => new THREE.BoxGeometry(1.8, 0.05, 0.9), PH2, 0, 0.95, 0, 0.3, 0, 0.3, 0.15);
      b.mirrorX(() => new THREE.BoxGeometry(1.5, 0.06, 0.12), '#ffffff', 1, 1.0, 0.03, 0.72, 0, 0.3, 0.15);
      b.add(new THREE.SphereGeometry(0.18, 6, 4), '#ffffff', 1, tr(0, 0, 0.85));
      b.add(new THREE.SphereGeometry(0.2, 8, 5), GLASS, 0.12, tr(0, 0.16, -0.55, 0, 0, 0, 0.8, 0.6, 1.8));
      b.mirrorX(() => new THREE.BoxGeometry(0.04, 0.35, 0.5), PH2, 0, 1.75, 0.12, 0.55, 0, 0.3, 0.15);
      b.mirrorX(() => new THREE.CylinderGeometry(0.1, 0.13, 0.3, 8), PH, 0, 0.3, -0.02, 0.75, Math.PI / 2);
      b.add(new THREE.BoxGeometry(0.08, 0.05, 1.6), PH2, 0, tr(0, 0.18, 0.0));
      break;
    }
    case 'bastion': {
      b.add(new THREE.BoxGeometry(1.4, 0.7, 2.6), PH, 0, tr(0, 0, 0));
      b.add(new THREE.BoxGeometry(0.9, 0.5, 1.0), PH2, 0, tr(0, 0.35, -0.7));
      b.mirrorX(() => new THREE.BoxGeometry(0.6, 0.9, 2.2), PH2, 0, 1.0, 0, 0.2);
      b.mirrorX(() => new THREE.CylinderGeometry(0.28, 0.32, 0.4, 8), '#ffffff', 1, 1.0, 0, 1.35, Math.PI / 2);
      b.add(new THREE.BoxGeometry(0.7, 0.1, 0.1), '#ffffff', 1, tr(0, 0.62, -1.2));
      b.add(new THREE.BoxGeometry(0.6, 0.22, 0.6), GLASS, 0.12, tr(0, 0.68, -0.85));
      b.mirrorX(() => new THREE.BoxGeometry(0.12, 0.12, 1.2), PDARK, 0, 0.45, -0.1, -1.4);
      b.mirrorX(() => new THREE.BoxGeometry(0.62, 0.14, 2.0), PH, 0, 1.0, 0.5, 0.25);
      b.mirrorX(() => new THREE.CylinderGeometry(0.22, 0.22, 0.05, 10), '#ffffff', 1, 1.0, 0, 1.58, Math.PI / 2);
      b.add(new THREE.BoxGeometry(0.08, 0.6, 0.8), PH2, 0, tr(0, 0.8, 0.8));
      break;
    }
    case 'prism': {
      b.add(new THREE.OctahedronGeometry(0.9, 0), PH2, 0, tr(0, 0, 0, 0, 0, 0, 0.8, 0.6, 1.8));
      b.mirrorX(() => new THREE.TetrahedronGeometry(0.6), PH, 0, 1.0, 0, 0.4, 0.2, 0, 0.5, 1, 0.4, 1.6);
      b.add(new THREE.OctahedronGeometry(0.28, 0), '#ffffff', 1, tr(0, 0.2, -0.3));
      b.add(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 6), '#ffffff', 1, tr(0, 0, 1.5, Math.PI / 2));
      b.add(new THREE.OctahedronGeometry(0.22, 0), GLASS, 0.15, tr(0, 0.42, -0.6, 0, 0, 0, 0.8, 0.6, 1.6));
      b.mirrorX(() => new THREE.BoxGeometry(0.04, 0.04, 1.6), '#ffffff', 0.5, 0.55, 0, -0.1, 0, 0.35, 0);
      b.mirrorX(() => new THREE.TetrahedronGeometry(0.22), PH2, 0, 0.35, -0.35, 1.0);
      break;
    }
    case 'ember': {
      b.add(new THREE.ConeGeometry(0.6, 2.8, 6), PH, 0, tr(0, 0, -0.2, -Math.PI / 2));
      b.mirrorX(() => new THREE.BoxGeometry(1.3, 0.12, 1.2), PH2, 0, 0.8, -0.1, 0.5, 0, 0.5, -0.25);
      b.mirrorX(() => new THREE.BoxGeometry(0.12, 0.5, 0.9), '#ffffff', 0.7, 1.35, 0.1, 0.6, 0, 0, 0.2);
      b.add(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 6), '#ffffff', 1, tr(0, 0, 1.25, Math.PI / 2));
      b.add(new THREE.SphereGeometry(0.26, 8, 5), GLASS, 0.12, tr(0, 0.32, -0.4, 0, 0, 0, 0.8, 0.6, 1.9));
      b.mirrorX(() => new THREE.BoxGeometry(0.28, 0.28, 0.7), PDARK, 0, 0.55, -0.1, 0.1);
      b.mirrorX(() => new THREE.ConeGeometry(0.1, 0.8, 4), PH2, 0, 1.0, 0.0, -0.4, -Math.PI / 2);
      b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10), '#ffffff', 1, tr(0, 0, 1.52, Math.PI / 2));
      break;
    }
    case 'wraith': {
      b.add(new THREE.ConeGeometry(0.5, 3.0, 3), PH, 0, tr(0, 0, -0.3, -Math.PI / 2, 0, Math.PI));
      b.mirrorX(() => new THREE.ConeGeometry(0.25, 2.0, 3), PH2, 0, 0.8, 0, 0.6, -Math.PI / 2, 0, 0.3);
      b.mirrorX(() => new THREE.SphereGeometry(0.16, 5, 3), '#ffffff', 1, 0.8, 0, 1.55);
      b.add(new THREE.BoxGeometry(0.05, 0.4, 1.4), '#ffffff', 0.6, tr(0, 0.25, 0.2));
      b.add(new THREE.ConeGeometry(0.18, 0.9, 3), GLASS, 0.18, tr(0, 0.22, -0.4, -Math.PI / 2, 0, Math.PI));
      b.mirrorX(() => new THREE.BoxGeometry(0.03, 0.03, 2.2), '#ffffff', 0.45, 0.45, -0.05, 0.1, 0, 0.12, 0);
      b.mirrorX(() => new THREE.BoxGeometry(0.04, 0.38, 0.5), PH2, 0, 0.62, 0.18, 1.05, 0, 0, -0.4);
      break;
    }
    default: {
      // The Lantern: a lightship carrying its own little sun
      // fuselage: flattened octagonal nose, armoured midsection, dorsal spine
      b.add(new THREE.ConeGeometry(0.55, 2.6, 8), PH, 0, tr(0, 0, -0.5, -Math.PI / 2, 0, 0, 1, 1, 0.72));
      b.add(new THREE.BoxGeometry(0.9, 0.42, 1.5), PH2, 0, tr(0, 0, 0.55));
      b.add(new THREE.BoxGeometry(0.18, 0.12, 2.3), PH2, 0, tr(0, 0.26, 0.15));
      b.add(new THREE.BoxGeometry(0.14, 0.2, 1.4), PH, 0, tr(0, -0.28, 0.45));
      // smoked canopy with a glint of the hull accent
      b.add(new THREE.SphereGeometry(0.3, 10, 6), GLASS, 0.12, tr(0, 0.22, -0.55, 0, 0, 0, 0.75, 0.55, 2.0));
      // swept wings with lighter leading-edge armour
      b.mirrorX(() => new THREE.BoxGeometry(1.6, 0.08, 0.9), PH2, 0, 0.95, 0, 0.6, 0, 0.35, 0);
      b.mirrorX(() => new THREE.BoxGeometry(1.55, 0.1, 0.16), PH, 0, 0.98, 0.01, 0.2, 0, 0.35, 0);
      // wingtip weapon pods with barrels
      b.mirrorX(() => new THREE.BoxGeometry(0.2, 0.25, 1.1), PH, 0, 1.75, 0, 0.75);
      b.mirrorX(() => new THREE.CylinderGeometry(0.045, 0.045, 0.9, 6), PDARK, 0, 1.75, -0.04, -0.2, Math.PI / 2);
      b.mirrorX(() => new THREE.CylinderGeometry(0.07, 0.07, 0.12, 6), PH2, 0, 1.75, -0.04, -0.62, Math.PI / 2);
      // intakes either side of the cockpit
      b.mirrorX(() => new THREE.BoxGeometry(0.22, 0.22, 0.55), PDARK, 0, 0.52, -0.04, 0.0);
      // canted twin tail fins
      b.mirrorX(() => new THREE.BoxGeometry(0.05, 0.5, 0.65), PH2, 0, 0.36, 0.42, 1.05, 0, 0, -0.32);
      // engines: shrouded nozzles with a hot inner disc
      b.mirrorX(() => new THREE.CylinderGeometry(0.22, 0.28, 0.5, 10), PH, 0, 0.55, 0, 1.4, Math.PI / 2);
      b.mirrorX(() => new THREE.CylinderGeometry(0.19, 0.19, 0.06, 10), '#ffffff', 1, 0.55, 0, 1.66, Math.PI / 2);
      // the lantern itself, caged on the spine
      b.add(new THREE.IcosahedronGeometry(0.26, 0), '#ffffff', 1, tr(0, 0.42, 0.25));
      b.add(new THREE.TorusGeometry(0.34, 0.03, 4, 12), PH2, 0, tr(0, 0.42, 0.25, 0, Math.PI / 2, 0));
      b.add(new THREE.TorusGeometry(0.34, 0.03, 4, 12), PH2, 0, tr(0, 0.42, 0.25, Math.PI / 2, 0, 0));
      // accent livery stripe and running lights
      b.add(new THREE.BoxGeometry(0.06, 0.02, 1.2), '#ffffff', 0.35, tr(0, 0.33, 0.6));
      b.mirrorX(() => new THREE.BoxGeometry(0.06, 0.04, 0.8), '#ffffff', 0.6, 1.75, 0.15, 0.75);
      b.mirrorX(() => new THREE.BoxGeometry(0.05, 0.05, 0.05), '#ffffff', 1, 1.75, 0.0, 1.32);
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
  | 'foremanCore'
  | 'drone'
  | 'halo'
  // world props (beacons, map nodes, hearth lanterns, wells)
  | 'beacon'
  | 'beaconCrown'
  | 'wellCore'
  | 'wellDisc'
  | 'navCombat'
  | 'navElite'
  | 'navBoss'
  | 'navShop'
  | 'navWreck'
  | 'navRest'
  | 'navForge'
  | 'navRift'
  | 'navStart'
  | 'pylon'
  | 'dropShard'
  | 'dropPrism'
  | 'dropCache'
  | 'dropRepair'
  | 'dropCell'
  // Act II bosses
  | 'crucible'
  | 'singularity'
  | 'regent'
  | 'shellPlate'
  | 'mask';

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
      // Broken, unequal fins make Hush silhouettes feel torn rather than manufactured.
      b.add(new THREE.ConeGeometry(0.16, 1.1, 3), DARK, 0, tr(0, 0.48, 0.4, -1.0, 0.2, 0.3));
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
      // A single offset tool arm gives the machines an industrial profile.
      b.add(new THREE.BoxGeometry(0.14, 0.18, 1.0), HULL2, 0, tr(0.68, 0.3, -0.5, 0, -0.2, -0.18));
      b.add(new THREE.BoxGeometry(0.27, 0.24, 0.2), HULL, 0, tr(0.77, 0.3, -1.0));
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
      b.mirrorX(() => new THREE.OctahedronGeometry(0.24, 0), '#3a3048', 0.2, 0.47, 0, 0.25, 0, 0, 0.8, 0.45, 1.4, 0.6);
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
    case 'foremanCore': {
      // A mining engine with four armored jaws around its furnace. Its broad,
      // asymmetric gantry reads differently from the Magnetar's round shell.
      b.add(new THREE.CylinderGeometry(1.8, 2.15, 1.8, 8), HULL2, 0, tr(0, 0, 0, Math.PI / 2));
      b.add(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 8), '#ffffff', 0.85, tr(0, 0, -0.96, Math.PI / 2));
      b.add(new THREE.IcosahedronGeometry(0.65, 0), '#ffffff', 1, tr(0, 0, -1.2));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.add(new THREE.BoxGeometry(0.65, 1.7, 1.6), HULL, 0, tr(Math.cos(a) * 2.0, Math.sin(a) * 2.0, -0.1, 0, 0, a - Math.PI / 2));
        b.add(new THREE.BoxGeometry(0.15, 1.0, 0.12), '#ffffff', 0.55, tr(Math.cos(a) * 2.35, Math.sin(a) * 2.35, -0.94, 0, 0, a - Math.PI / 2));
      }
      b.add(new THREE.BoxGeometry(1.1, 0.3, 1.0), HULL2, 0, tr(0.6, 2.25, 0.1));
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
    // --- props: lit parts are white emissive so the instance tint colours them
    case 'beacon': {
      // a lattice lighthouse: hex plinth, three leaning legs, a mast and a lamp house
      b.add(new THREE.CylinderGeometry(2.6, 3.2, 0.8, 6), HULL2, 0, tr(0, -5, 0));
      b.add(new THREE.CylinderGeometry(3.3, 3.3, 0.12, 6), '#ffffff', 0.35, tr(0, -4.55, 0));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(new THREE.BoxGeometry(0.32, 8.6, 0.32), HULL, 0, tr(Math.cos(a) * 1.15, -0.6, Math.sin(a) * 1.15, Math.sin(a) * 0.24, 0, -Math.cos(a) * 0.24));
      }
      b.add(new THREE.CylinderGeometry(0.28, 0.42, 9, 6), HULL2, 0, tr(0, -0.5, 0));
      for (const y of [-3, -0.6, 1.8]) b.add(new THREE.TorusGeometry(1.7 - (y + 3) * 0.2, 0.09, 3, 6), HULL2, 0, tr(0, y, 0, Math.PI / 2));
      b.add(new THREE.CylinderGeometry(0.95, 1.25, 1.1, 6), HULL2, 0, tr(0, 3.9, 0));
      b.add(new THREE.OctahedronGeometry(0.95, 0), '#ffffff', 1, tr(0, 5.25, 0, 0, 0, 0, 1, 1.25, 1));
      b.add(new THREE.ConeGeometry(1.2, 1.3, 6), HULL, 0, tr(0, 6.75, 0));
      b.add(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 3), HULL2, 0, tr(0, 8.4, 0));
      b.add(new THREE.SphereGeometry(0.16, 6, 4), '#ffffff', 1, tr(0, 9.5, 0));
      break;
    }
    case 'beaconCrown': {
      // the turning lens ring around the lamp
      b.add(new THREE.TorusGeometry(2.3, 0.09, 3, 24), '#ffffff', 0.7, tr(0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        b.add(new THREE.BoxGeometry(0.55, 1.2, 0.12), '#ffffff', 1, tr(Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3, 0, -a, 0));
      }
      break;
    }
    case 'wellCore': {
      b.add(new THREE.IcosahedronGeometry(1, 1), DARK, 0);
      b.add(new THREE.IcosahedronGeometry(1.18, 0), '#ffffff', 0.25, tr(0, 0, 0, 0.4, 0.2, 0, 1, 1, 1));
      break;
    }
    case 'wellDisc': {
      b.add(new THREE.TorusGeometry(1.9, 0.07, 3, 36), '#ffffff', 1, tr(0, 0, 0, Math.PI / 2));
      b.add(new THREE.TorusGeometry(2.6, 0.04, 3, 36), '#ffffff', 0.6, tr(0, 0, 0, Math.PI / 2));
      b.add(new THREE.TorusGeometry(3.4, 0.03, 3, 36), '#ffffff', 0.35, tr(0, 0, 0, Math.PI / 2));
      break;
    }
    case 'navCombat': {
      b.add(displaced(new THREE.IcosahedronGeometry(1.4, 0), rng, 0.35), HULL2, 0);
      b.add(new THREE.TorusGeometry(2.2, 0.08, 3, 16), '#ffffff', 0.8, tr(0, 0, 0, 1.2, 0, 0.3));
      b.add(new THREE.SphereGeometry(0.3, 6, 4), '#ffffff', 1, tr(0.9, 0.7, 0.6));
      break;
    }
    case 'navElite': {
      b.add(new THREE.OctahedronGeometry(1.3, 0), HULL2, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(new THREE.ConeGeometry(0.22, 1.6, 4), '#ffffff', 0.9, tr(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0, 0, 0, a - Math.PI / 2));
      }
      break;
    }
    case 'navBoss': {
      // the dying star: a bright core under a cracked dark shell, ringed
      b.add(new THREE.IcosahedronGeometry(2.6, 2), '#ffffff', 1);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.39996;
        const y = 1 - (i / 8) * 2;
        const r = Math.sqrt(1 - y * y);
        b.add(new THREE.BoxGeometry(1.5, 1.5, 0.35), DARK, 0, tr(Math.cos(a) * r * 2.75, y * 2.75, Math.sin(a) * r * 2.75, y * 1.2, -a, 0));
      }
      b.add(new THREE.TorusGeometry(4.3, 0.12, 3, 40), '#ffffff', 0.7, tr(0, 0, 0, 1.25, 0, 0.2));
      break;
    }
    case 'navShop': {
      b.add(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 8), HULL2, 0);
      b.add(new THREE.TorusGeometry(2.2, 0.32, 4, 12), HULL, 0, tr(0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        b.add(new THREE.BoxGeometry(0.15, 0.15, 1.5), HULL2, 0, tr(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4, 0, -a + Math.PI / 2, 0));
        b.add(new THREE.BoxGeometry(0.4, 0.2, 0.1), '#ffffff', 1, tr(Math.cos(a) * 2.25, 0.3, Math.sin(a) * 2.25, 0, -a + Math.PI / 2, 0));
      }
      b.add(new THREE.CylinderGeometry(0.04, 0.04, 2, 3), HULL2, 0, tr(0, 1.9, 0));
      b.add(new THREE.SphereGeometry(0.18, 6, 4), '#ffffff', 1, tr(0, 2.9, 0));
      break;
    }
    case 'navWreck': {
      b.add(new THREE.BoxGeometry(2.6, 0.9, 1.1), HULL2, 0, tr(-0.4, 0, 0, 0.2, 0.3, 0.5));
      b.add(new THREE.BoxGeometry(1.2, 0.7, 1.4), HULL, 0, tr(1.4, 0.5, 0.2, -0.4, 0.8, -0.3));
      b.add(new THREE.BoxGeometry(0.2, 1.8, 0.2), HULL, 0, tr(-1.3, 0.9, 0.2, 0, 0, 0.5));
      b.add(new THREE.SphereGeometry(0.22, 6, 4), '#ffffff', 1, tr(-1.75, 1.7, 0.2));
      break;
    }
    case 'navRest': {
      b.add(new THREE.CylinderGeometry(0.15, 0.2, 2.4, 6), HULL, 0, tr(0, -0.8, 0));
      b.add(new THREE.CylinderGeometry(0.6, 0.6, 1, 6, 1, true), HULL2, 0, tr(0, 0.9, 0));
      b.add(new THREE.SphereGeometry(0.4, 8, 6), '#ffffff', 1, tr(0, 0.9, 0));
      b.add(new THREE.ConeGeometry(0.75, 0.6, 6), HULL, 0, tr(0, 1.7, 0));
      b.add(new THREE.TorusGeometry(1.6, 0.05, 3, 20), '#ffffff', 0.5, tr(0, -2, 0, Math.PI / 2));
      break;
    }
    case 'navForge': {
      b.add(new THREE.BoxGeometry(2.2, 0.6, 1), HULL2, 0, tr(0, 0.4, 0));
      b.add(new THREE.BoxGeometry(1, 1, 0.8), HULL, 0, tr(0, -0.4, 0));
      b.add(new THREE.ConeGeometry(0.5, 0.9, 4), HULL2, 0, tr(1.5, 0.4, 0, 0, 0, -Math.PI / 2));
      b.add(new THREE.BoxGeometry(1.3, 0.12, 0.6), '#ffffff', 1, tr(0, 0.76, 0));
      break;
    }
    case 'navRift': {
      b.add(new THREE.TorusGeometry(2, 0.35, 4, 14), '#ffffff', 1);
      b.add(new THREE.CircleGeometry(1.7, 14), DARK, 0);
      b.add(new THREE.CircleGeometry(1.7, 14), DARK, 0, tr(0, 0, 0, 0, Math.PI, 0));
      break;
    }
    case 'navStart': {
      b.add(new THREE.OctahedronGeometry(0.8, 0), HULL2, 0);
      b.add(new THREE.TorusGeometry(1.4, 0.05, 3, 16), '#ffffff', 0.7, tr(0, 0, 0, Math.PI / 2));
      break;
    }
    case 'crucible': {
      // a molten bowl: dark rim, glowing melt, three pour spouts
      b.add(new THREE.CylinderGeometry(1.5, 1.0, 1.2, 10, 1, true), HULL2, 0);
      b.add(new THREE.CylinderGeometry(1.42, 1.42, 0.1, 10), '#ffffff', 1, tr(0, 0.45, 0));
      b.add(new THREE.TorusGeometry(1.55, 0.14, 4, 10), HULL, 0, tr(0, 0.6, 0, Math.PI / 2));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(new THREE.ConeGeometry(0.22, 0.7, 4), '#ffffff', 0.8, tr(Math.cos(a) * 1.5, 0.3, Math.sin(a) * 1.5, Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2));
      }
      b.add(new THREE.SphereGeometry(0.5, 8, 6), '#ffffff', 1, tr(0, -0.7, 0));
      break;
    }
    case 'singularity': {
      b.add(new THREE.IcosahedronGeometry(1, 2), DARK, 0);
      b.add(new THREE.TorusGeometry(1.25, 0.05, 3, 40), '#ffffff', 1, tr(0, 0, 0, Math.PI / 2));
      b.add(new THREE.TorusGeometry(1.7, 0.03, 3, 40), '#ffffff', 0.6, tr(0, 0, 0, Math.PI / 2 + 0.15));
      b.add(new THREE.TorusGeometry(2.3, 0.02, 3, 40), '#ffffff', 0.35, tr(0, 0, 0, Math.PI / 2 - 0.1));
      break;
    }
    case 'regent': {
      // a crowned engine: tall body, crown points, two pole nozzles
      b.add(new THREE.OctahedronGeometry(1, 0), HULL2, 0, tr(0, 0, 0, 0, 0, 0, 0.9, 1.5, 0.9));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.add(new THREE.ConeGeometry(0.12, 0.7, 4), '#ffffff', 0.9, tr(Math.cos(a) * 0.7, 1.25, Math.sin(a) * 0.7));
      }
      b.add(new THREE.CylinderGeometry(0.35, 0.55, 0.6, 8), HULL, 0, tr(0, -1.6, 0));
      b.add(new THREE.SphereGeometry(0.3, 8, 6), '#ffffff', 1, tr(0, -1.95, 0));
      b.add(new THREE.TorusGeometry(1.1, 0.06, 3, 24), '#ffffff', 0.7);
      break;
    }
    case 'shellPlate': {
      b.add(new THREE.BoxGeometry(2.4, 2.4, 0.45), HULL2, 0);
      b.add(new THREE.BoxGeometry(1.6, 0.18, 0.5), '#ffffff', 0.7, tr(0, 0.6, 0));
      b.add(new THREE.BoxGeometry(1.6, 0.18, 0.5), '#ffffff', 0.7, tr(0, -0.6, 0));
      break;
    }
    case 'mask': {
      // a pale face over the dark: two eye slits, a crack
      b.add(new THREE.SphereGeometry(1.2, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), '#cfc8bc', 0.15, tr(0, 0, 0, -Math.PI / 2));
      b.mirrorX(() => new THREE.BoxGeometry(0.5, 0.12, 0.2), '#ffffff', 1, 0.42, 0.2, -1.05, 0, 0, 0.25);
      b.add(new THREE.BoxGeometry(0.06, 1.1, 0.2), DARK, 0, tr(0.15, -0.2, -1.1, 0, 0, 0.3));
      b.add(new THREE.IcosahedronGeometry(0.9, 1), DARK, 0, tr(0, 0, 0.4));
      break;
    }
    case 'dropShard': {
      b.add(new THREE.OctahedronGeometry(0.55, 0), '#ffffff', 1, tr(0, 0, 0, 0, 0, 0, 0.7, 1.4, 0.7));
      b.add(new THREE.TorusGeometry(0.85, 0.05, 3, 12), '#ffffff', 0.6, tr(0, 0, 0, Math.PI / 2));
      break;
    }
    case 'dropPrism': {
      b.add(new THREE.TetrahedronGeometry(0.75, 0), '#ffffff', 1);
      b.add(new THREE.TetrahedronGeometry(0.75, 0), '#ffffff', 0.7, tr(0, 0, 0, Math.PI, 0.6, 0));
      break;
    }
    case 'dropCache': {
      b.add(new THREE.BoxGeometry(1.2, 0.75, 0.8), HULL2, 0);
      b.add(new THREE.BoxGeometry(1.28, 0.12, 0.88), '#ffffff', 1, tr(0, 0.12, 0));
      b.add(new THREE.BoxGeometry(0.2, 0.8, 0.86), '#ffffff', 0.8, tr(0.35, 0, 0));
      b.add(new THREE.BoxGeometry(0.2, 0.8, 0.86), '#ffffff', 0.8, tr(-0.35, 0, 0));
      break;
    }
    case 'dropRepair': {
      b.add(new THREE.BoxGeometry(1.1, 0.34, 0.34), '#ffffff', 1);
      b.add(new THREE.BoxGeometry(0.34, 1.1, 0.34), '#ffffff', 1);
      break;
    }
    case 'dropCell': {
      b.add(new THREE.CylinderGeometry(0.32, 0.32, 1, 8), HULL2, 0);
      b.add(new THREE.CylinderGeometry(0.26, 0.26, 0.7, 8), '#ffffff', 1);
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 8), '#ffffff', 0.6, tr(0, 0.56, 0));
      break;
    }
    case 'pylon': {
      // Hearth lantern: a post, an open cage and a lamp
      b.add(new THREE.CylinderGeometry(0.12, 0.2, 3.2, 6), HULL, 0, tr(0, -1.4, 0));
      b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 6, 1, true), HULL2, 0, tr(0, 0.6, 0));
      b.add(new THREE.SphereGeometry(0.32, 8, 6), '#ffffff', 1, tr(0, 0.6, 0));
      b.add(new THREE.ConeGeometry(0.62, 0.5, 6), HULL, 0, tr(0, 1.3, 0));
      b.add(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 6), HULL2, 0, tr(0, 0.12, 0));
      break;
    }
  }
  return b.build();
}

export type _UnusedPart = Part;
