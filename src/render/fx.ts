import * as THREE from 'three';
import {
  BULLET_FRAG,
  BULLET_VERT,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  SHELL_FRAG,
  SHELL_VERT,
  STREAK_FRAG,
  STREAK_VERT,
  TELE_FRAG,
  TELE_VERT,
} from './shaders';

/** Additive into HDR color, never touches the foreground alpha flag. */
export function hdrAdditive(mat: THREE.Material): void {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.transparent = true;
  mat.depthWrite = false;
}

/**
 * GPU particles: stateless analytic motion evaluated in the vertex shader.
 * CPU only writes a ring-buffer slot on spawn, so 60k+ live particles cost
 * almost nothing on the simulation thread.
 */
export class Particles {
  readonly points: THREE.Points;
  readonly capacity: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private time: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private head = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;
  private geo: THREE.BufferGeometry;
  private attrs: THREE.BufferAttribute[];
  readonly uniforms: { uNow: { value: number }; uPixelScale: { value: number } };
  now = 0;
  spawnedThisFrame = 0;
  budgetScale = 1;

  constructor(capacity: number, pixelScale: { value: number }) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.time = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity * 2);
    this.geo = new THREE.BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new THREE.BufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attrs = [mk(this.pos, 3), mk(this.vel, 3), mk(this.time, 4), mk(this.col, 4), mk(this.size, 2)];
    this.geo.setAttribute('position', this.attrs[0]!);
    this.geo.setAttribute('aVel', this.attrs[1]!);
    this.geo.setAttribute('aTime', this.attrs[2]!);
    this.geo.setAttribute('aColor', this.attrs[3]!);
    this.geo.setAttribute('aSize', this.attrs[4]!);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { uNow: { value: 0 }, uPixelScale: pixelScale };
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: this.uniforms,
    });
    hdrAdditive(mat);
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** life in seconds; sizes in px at distance 10; drag k; gravity g; color HDR. */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    r: number,
    g: number,
    b: number,
    s0: number,
    s1: number,
    drag = 0,
    grav = 0,
    lateFade = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.head === 0) this.wrapped = true;
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.time[i4] = this.now;
    this.time[i4 + 1] = life;
    this.time[i4 + 2] = drag;
    this.time[i4 + 3] = grav;
    this.col[i4] = r;
    this.col[i4 + 1] = g;
    this.col[i4 + 2] = b;
    this.col[i4 + 3] = lateFade;
    this.size[i * 2] = s0;
    this.size[i * 2 + 1] = s1;
    if (this.dirtyFrom < 0) {
      this.dirtyFrom = i;
      this.dirtyTo = i;
    } else this.dirtyTo = i;
    this.spawnedThisFrame++;
  }

  clear(): void {
    this.time.fill(0);
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
    this.dirtyFrom = -1;
  }

  /** Upload only the ring-buffer slice touched this frame. */
  flush(): void {
    this.uniforms.uNow.value = this.now;
    if (this.dirtyFrom < 0) return;
    const sizes = [3, 3, 4, 4, 2];
    const from = this.dirtyFrom;
    const to = this.dirtyTo;
    for (let k = 0; k < this.attrs.length; k++) {
      const a = this.attrs[k]!;
      const n = sizes[k]!;
      a.clearUpdateRanges();
      if (this.spawnedThisFrame >= this.capacity) {
        a.addUpdateRange(0, this.capacity * n);
      } else if (to >= from) {
        a.addUpdateRange(from * n, (to - from + 1) * n);
      } else {
        a.addUpdateRange(from * n, (this.capacity - from) * n);
        a.addUpdateRange(0, (to + 1) * n);
      }
      a.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.spawnedThisFrame = 0;
  }

  /** Approximate live count (for perf overlay). */
  liveEstimate(): number {
    let n = 0;
    const lim = this.wrapped ? this.capacity : this.head;
    for (let i = 0; i < lim; i += 16) {
      const t = this.now - this.time[i * 4]!;
      if (t >= 0 && t <= this.time[i * 4 + 1]!) n += 16;
    }
    return n;
  }
}

/** Screen-space streak quads between two world points. Rebuilt every frame. */
export class Streaks {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private a: Float32Array;
  private b: Float32Array;
  private col: Float32Array;
  private wb: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  private attrs: THREE.InstancedBufferAttribute[];
  count = 0;

  constructor(capacity: number, res: { value: THREE.Vector2 }, blendAdd = true) {
    this.capacity = capacity;
    const base = new THREE.BufferGeometry();
    base.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3),
    );
    base.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.a = new Float32Array(capacity * 3);
    this.b = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.wb = new Float32Array(capacity);
    const mk = (arr: Float32Array, n: number) => {
      const at = new THREE.InstancedBufferAttribute(arr, n);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.attrs = [mk(this.a, 3), mk(this.b, 3), mk(this.col, 4), mk(this.wb, 1)];
    this.geo.setAttribute('aA', this.attrs[0]!);
    this.geo.setAttribute('aB', this.attrs[1]!);
    this.geo.setAttribute('aCol', this.attrs[2]!);
    this.geo.setAttribute('aWidthB', this.attrs[3]!);
    const mat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: { uRes: res },
      side: THREE.DoubleSide,
    });
    if (blendAdd) hdrAdditive(mat);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  begin(): void {
    this.count = 0;
  }

  push(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    g: number,
    b: number,
    widthA: number,
    widthB = widthA,
  ): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const i3 = i * 3;
    this.a[i3] = ax;
    this.a[i3 + 1] = ay;
    this.a[i3 + 2] = az;
    this.b[i3] = bx;
    this.b[i3 + 1] = by;
    this.b[i3 + 2] = bz;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = widthA;
    this.wb[i] = widthB;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    const sizes = [3, 3, 4, 1];
    for (let k = 0; k < this.attrs.length; k++) {
      const at = this.attrs[k]!;
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, this.count) * sizes[k]!);
      at.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }
}

/** Bullets & pickups rendered into the readability overlay with reserved tones. */
export class Bullets {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  private p: Float32Array;
  private v: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  private attrs: THREE.InstancedBufferAttribute[];
  count = 0;

  constructor(capacity: number, uniforms: Record<string, THREE.IUniform>) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.p = new Float32Array(capacity * 4);
    this.v = new Float32Array(capacity * 4);
    const mk = (arr: Float32Array) => {
      const at = new THREE.InstancedBufferAttribute(arr, 4);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.attrs = [mk(this.p), mk(this.v)];
    this.geo.setAttribute('aPos', this.attrs[0]!);
    this.geo.setAttribute('aVel', this.attrs[1]!);
    const mat = new THREE.ShaderMaterial({
      vertexShader: BULLET_VERT,
      fragmentShader: BULLET_FRAG,
      uniforms,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, z: number, size: number, vx: number, vy: number, vz: number, kind: number): void {
    if (this.count >= this.capacity) return;
    const i4 = this.count++ * 4;
    this.p[i4] = x;
    this.p[i4 + 1] = y;
    this.p[i4 + 2] = z;
    this.p[i4 + 3] = size;
    this.v[i4] = vx;
    this.v[i4 + 1] = vy;
    this.v[i4 + 2] = vz;
    this.v[i4 + 3] = kind;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, this.count) * 4);
      at.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }
}

/** Full-resolution telegraph lines (LineSegments with per-vertex RGBA). */
export class Telegraphs {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private n = 0;
  private readonly cap: number;

  constructor(capVerts = 16384) {
    this.cap = capVerts;
    this.pos = new Float32Array(capVerts * 3);
    this.col = new Float32Array(capVerts * 4);
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.col, 4);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('aCol', ca);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TELE_VERT,
      fragmentShader: TELE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
  }

  begin(): void {
    this.n = 0;
  }

  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, a: number): void {
    if (this.n + 2 > this.cap) return;
    let i = this.n * 3;
    this.pos[i] = ax;
    this.pos[i + 1] = ay;
    this.pos[i + 2] = az;
    this.pos[i + 3] = bx;
    this.pos[i + 4] = by;
    this.pos[i + 5] = bz;
    i = this.n * 4;
    this.col[i] = r;
    this.col[i + 1] = g;
    this.col[i + 2] = b;
    this.col[i + 3] = a;
    this.col[i + 4] = r;
    this.col[i + 5] = g;
    this.col[i + 6] = b;
    this.col[i + 7] = a;
    this.n += 2;
  }

  /** Circle in the plane defined by normal (nx,ny,nz). */
  ring(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
    a: number,
    segs = 40,
  ): void {
    // build orthonormal basis
    let ux = 0;
    let uy = 1;
    const uz = 0;
    if (Math.abs(ny) > 0.9) {
      ux = 1;
      uy = 0;
    }
    // u = normalize(cross(n, up))
    let tx = ny * uz - nz * uy;
    let ty = nz * ux - nx * uz;
    let tz = nx * uy - ny * ux;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const sx = ny * tz - nz * ty;
    const sy = nz * tx - nx * tz;
    const sz = nx * ty - ny * tx;
    let px = cx + tx * radius;
    let py = cy + ty * radius;
    let pz = cz + tz * radius;
    for (let i = 1; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const c = Math.cos(ang) * radius;
      const s = Math.sin(ang) * radius;
      const qx = cx + tx * c + sx * s;
      const qy = cy + ty * c + sy * s;
      const qz = cz + tz * c + sz * s;
      this.seg(px, py, pz, qx, qy, qz, r, g, b, a);
      px = qx;
      py = qy;
      pz = qz;
    }
  }

  end(): void {
    this.geo.setDrawRange(0, this.n);
    const p = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const c = this.geo.getAttribute('aCol') as THREE.BufferAttribute;
    p.clearUpdateRanges();
    p.addUpdateRange(0, Math.max(1, this.n) * 3);
    p.needsUpdate = true;
    c.clearUpdateRanges();
    c.addUpdateRange(0, Math.max(1, this.n) * 4);
    c.needsUpdate = true;
  }
}

interface Shell {
  x: number;
  y: number;
  z: number;
  r0: number;
  r1: number;
  t: number;
  dur: number;
  mode: number;
  seed: number;
  inten: number;
  r: number;
  g: number;
  b: number;
  follow?: { x: number; y: number; z: number };
}

/** Expanding volumetric spheres: fireballs, shield bubbles, energy bursts. */
export class Shells {
  readonly mesh: THREE.Mesh;
  private list: Shell[] = [];
  private sphere: Float32Array;
  private shell: Float32Array;
  private tint: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  private attrs: THREE.InstancedBufferAttribute[];
  constructor(readonly capacity = 96) {
    const base = new THREE.IcosahedronGeometry(1, 3);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.sphere = new Float32Array(capacity * 4);
    this.shell = new Float32Array(capacity * 4);
    this.tint = new Float32Array(capacity * 3);
    const mk = (arr: Float32Array, n: number) => {
      const at = new THREE.InstancedBufferAttribute(arr, n);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.attrs = [mk(this.sphere, 4), mk(this.shell, 4), mk(this.tint, 3)];
    this.geo.setAttribute('aSphere', this.attrs[0]!);
    this.geo.setAttribute('aShell', this.attrs[1]!);
    this.geo.setAttribute('aTint', this.attrs[2]!);
    const mat = new THREE.ShaderMaterial({ vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, side: THREE.FrontSide });
    hdrAdditive(mat);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** one-frame shells driven from the sim (boss hazards), drawn after the timed list */
  private frame: number[] = [];

  /**
   * A sphere for this frame only, at an exact radius (so it matches a hitbox).
   * Modes 3 shockfront, 4 event horizon, 5 umbra, 6 crystal. `age` 0..1 drives the animation.
   */
  put(x: number, y: number, z: number, radius: number, mode: number, r: number, g: number, b: number, inten: number, age: number): void {
    this.frame.push(x, y, z, radius, mode, r, g, b, inten, age);
  }

  /** mode 0 fireball, 1 shield bubble, 2 energy burst. `follow` keeps it on a moving point. */
  add(x: number, y: number, z: number, r0: number, r1: number, dur: number, mode: number, r: number, g: number, b: number, inten = 1, follow?: { x: number; y: number; z: number }): void {
    if (this.list.length >= this.capacity) this.list.shift();
    this.list.push({ x, y, z, r0, r1, t: 0, dur, mode, seed: Math.random(), inten, r, g, b, follow });
  }

  clear(): void {
    this.list.length = 0;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]!;
      s.t += dt;
      if (s.t >= s.dur) {
        this.list.splice(i, 1);
        continue;
      }
      const k = s.t / s.dur;
      const e = 1 - Math.pow(1 - k, 2.4);
      const c = s.follow ?? s;
      this.sphere.set([c.x, c.y, c.z, s.r0 + (s.r1 - s.r0) * e], n * 4);
      this.shell.set([k, s.mode, s.seed, s.inten], n * 4);
      this.tint.set([s.r, s.g, s.b], n * 3);
      n++;
    }
    const F = this.frame;
    for (let i = 0; i + 9 < F.length && n < this.capacity; i += 10) {
      this.sphere.set([F[i]!, F[i + 1]!, F[i + 2]!, F[i + 3]!], n * 4);
      this.shell.set([F[i + 9]!, F[i + 4]!, (i * 0.137) % 1, F[i + 8]!], n * 4);
      this.tint.set([F[i + 5]!, F[i + 6]!, F[i + 7]!], n * 3);
      n++;
    }
    F.length = 0;
    this.geo.instanceCount = n;
    const sizes = [4, 4, 3];
    for (let k = 0; k < this.attrs.length; k++) {
      const at = this.attrs[k]!;
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, n) * sizes[k]!);
      at.needsUpdate = true;
    }
    this.mesh.visible = n > 0;
  }
}
