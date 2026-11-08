import * as THREE from 'three';
import {
  BLOOM_DOWN_FRAG,
  BLOOM_UP_FRAG,
  FULLSCREEN_VERT,
  MAX_LIGHTS,
  POST_FRAG,
} from './shaders';
import { PaletteDef, RESERVED_TONES, ColorblindMode, INK, SIGNAL } from '../data/palettes';
import { hexToRgb, rgbToOklab, srgbToLinear } from '../core/math';

export interface LookSettings {
  pixelScale: number; // display pixels per internal pixel (2,3,4)
  matrix: number; // 0 bayer4, 1 bayer8, 2 ign, 3 off
  spread: number;
  bloom: number;
  bloomThreshold: number;
  exposure: number;
  scanlines: number;
  vignette: number;
  skyScale: number;
}

export const DEFAULT_LOOK: LookSettings = {
  pixelScale: 2,
  matrix: 1,
  spread: 1.0,
  bloom: 0.9,
  bloomThreshold: 1.1,
  exposure: 1.05,
  scanlines: 0.06,
  vignette: 0.9,
  skyScale: 220,
};

/** Dynamic point light, e.g. explosions and muzzle flashes. */
export interface DynLight {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  radius: number;
  life: number;
  maxLife: number;
  active: boolean;
  score: number;
}

export class LightRig {
  readonly uniforms = {
    uStarDir: { value: new THREE.Vector3(0.4, 0.3, -0.8).normalize() },
    uStarColor: { value: new THREE.Vector3(1, 0.8, 0.9) },
    uAmbient: { value: new THREE.Vector3(0.04, 0.02, 0.06) },
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
    uTime: { value: 0 },
  };
  private pool: DynLight[] = [];
  private order: number[] = [];
  /** persistent lights (e.g. player engine) with infinite life */
  constructor(size = 96) {
    for (let i = 0; i < size; i++)
      this.pool.push({ x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, radius: 0, life: 0, maxLife: 0, active: false, score: 0 });
  }

  spawn(x: number, y: number, z: number, r: number, g: number, b: number, radius: number, life: number): void {
    let slot: DynLight | undefined;
    let weakest: DynLight | undefined;
    for (const l of this.pool) {
      if (!l.active) {
        slot = l;
        break;
      }
      if (!weakest || l.life < weakest.life) weakest = l;
    }
    slot ??= weakest!;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.r = r;
    slot.g = g;
    slot.b = b;
    slot.radius = radius;
    slot.life = life;
    slot.maxLife = life;
    slot.active = true;
  }

  clear(): void {
    for (const l of this.pool) l.active = false;
  }

  update(dt: number, cam: THREE.Vector3, extra?: (out: (x: number, y: number, z: number, r: number, g: number, b: number, radius: number) => void) => void): void {
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i]!;
      if (!l.active) continue;
      l.life -= dt;
      if (l.life <= 0) {
        l.active = false;
        continue;
      }
      const dx = l.x - cam.x;
      const dy = l.y - cam.y;
      const dz = l.z - cam.z;
      const k = l.life / l.maxLife;
      l.score = ((l.r + l.g + l.b) * k * l.radius) / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 10);
      order.push(i);
    }
    order.sort((a, b) => this.pool[b]!.score - this.pool[a]!.score);
    const pos = this.uniforms.uLightPos.value;
    const col = this.uniforms.uLightCol.value;
    let n = 0;
    if (extra) {
      extra((x, y, z, r, g, b, radius) => {
        if (n >= MAX_LIGHTS) return;
        pos[n]!.set(x, y, z, radius);
        col[n]!.set(r, g, b);
        n++;
      });
    }
    for (let j = 0; j < order.length && n < MAX_LIGHTS; j++) {
      const l = this.pool[order[j]!]!;
      const k = l.life / l.maxLife;
      const f = k * k;
      pos[n]!.set(l.x, l.y, l.z, l.radius * (0.6 + 0.4 * k));
      col[n]!.set(l.r * f, l.g * f, l.b * f);
      n++;
    }
    for (; n < MAX_LIGHTS; n++) pos[n]!.w = 0;
  }
}

function paletteToLab(p: PaletteDef): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const hex = p.colors[i % p.colors.length]!;
    const [r, g, b] = hexToRgb(hex);
    const [L, A, B] = rgbToOklab(r, g, b);
    out.push(new THREE.Vector3(L, A, B));
  }
  return out;
}

export function hexToLinearVec(hex: string, mul = 1): THREE.Vector3 {
  const [r, g, b] = hexToRgb(hex);
  return new THREE.Vector3(srgbToLinear(r) * mul, srgbToLinear(g) * mul, srgbToLinear(b) * mul);
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  look: LookSettings = { ...DEFAULT_LOOK };
  lowW = 640;
  lowH = 360;
  outW = 1920;
  outH = 1080;
  sceneRT!: THREE.WebGLRenderTarget;
  overlayRT!: THREE.WebGLRenderTarget;
  private bloomRTs: THREE.WebGLRenderTarget[] = [];
  private bloomUpRTs: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  readonly postMat: THREE.ShaderMaterial;
  readonly lights = new LightRig();
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  readonly bulletUniforms = {
    uPlayerTone: { value: new THREE.Vector3() },
    uEnemyTone: { value: new THREE.Vector3() },
    uPickupTone: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(640, 360) },
  };
  /** Shared resolution uniform for streak shaders (low-res target size). */
  readonly resUniform = { value: new THREE.Vector2(640, 360) };
  readonly pixelScaleUniform = { value: 1 };
  private palFrom: THREE.Vector3[] = [];
  private palTo: THREE.Vector3[] = [];
  private palT = 1;
  private palDur = 1;
  /** juice state written by game each frame */
  fx = { hush: 0, flare: 0, lowHp: 0, damage: 0, warp: 0, flash: 0, breath: 0, ink: 0, paper: 0 };
  reduceFlash = 1;
  drawCalls = 0;
  triangles = 0;
  private dpr = 1;
  resScale = 1; // Auto quality multiplier on internal res

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLOOM_DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLOOM_UP_FRAG,
      uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tOverlay: { value: null },
        uLowRes: { value: new THREE.Vector2() },
        uOutRes: { value: new THREE.Vector2() },
        uPalA: { value: [] as THREE.Vector3[] },
        uPalB: { value: [] as THREE.Vector3[] },
        uPalMix: { value: 0 },
        uExposure: { value: 1 },
        uBloom: { value: 1 },
        uSpread: { value: 1 },
        uMatrix: { value: 1 },
        uHush: { value: 0 },
        uFlare: { value: 0 },
        uLowHp: { value: 0 },
        uDamage: { value: 0 },
        uWarp: { value: 0 },
        uFlash: { value: 0 },
        uBreath: { value: 0 },
        uScan: { value: 0 },
        uVignette: { value: 1 },
        uTime: { value: 0 },
        uReduceFlash: { value: 1 },
        uCamRot: { value: new THREE.Matrix3() },
        uTanHalf: { value: new THREE.Vector2(1, 1) },
        uSkyScale: { value: 200 },
        uInkPal: { value: INK.map((h) => { const [r, g, b] = hexToRgb(h); const [L, A, B] = rgbToOklab(r, g, b); return new THREE.Vector3(L, A, B); }) },
        uInk: { value: 0 },
        uPaper: { value: 0 },
        uSignal: { value: new THREE.Vector3(...hexToRgb(SIGNAL)) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(geo, this.postMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.setTones('default');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setTones(mode: ColorblindMode): void {
    const t = RESERVED_TONES[mode];
    const toVec = (hex: string) => {
      const [r, g, b] = hexToRgb(hex);
      return new THREE.Vector3(r, g, b);
    };
    this.bulletUniforms.uPlayerTone.value.copy(toVec(t.player));
    this.bulletUniforms.uEnemyTone.value.copy(toVec(t.enemy));
    this.bulletUniforms.uPickupTone.value.copy(toVec(t.pickup));
  }

  setPalette(p: PaletteDef, transition = 0): void {
    const lab = paletteToLab(p);
    if (transition <= 0 || this.palTo.length === 0) {
      this.palFrom = lab;
      this.palTo = lab;
      this.palT = 1;
      this.palDur = 1;
    } else {
      // capture the current mixed palette as the new 'from'
      const k = Math.min(this.palT / this.palDur, 1);
      this.palFrom = this.palFrom.map((v, i) => v.clone().lerp(this.palTo[i]!, k));
      this.palTo = lab;
      this.palT = 0;
      this.palDur = transition;
    }
    this.postMat.uniforms.uPalA!.value = this.palFrom;
    this.postMat.uniforms.uPalB!.value = this.palTo;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, Math.floor(window.innerWidth * this.dpr));
    const h = Math.max(180, Math.floor(window.innerHeight * this.dpr));
    this.outW = w;
    this.outH = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.rebuildTargets();
  }

  rebuildTargets(): void {
    const scale = Math.max(1, this.look.pixelScale * this.dpr) / this.resScale;
    const lw = Math.max(160, Math.round(this.outW / scale));
    const lh = Math.max(90, Math.round(this.outH / scale));
    if (this.sceneRT && lw === this.lowW && lh === this.lowH) return;
    this.lowW = lw;
    this.lowH = lh;
    this.sceneRT?.dispose();
    this.overlayRT?.dispose();
    for (const t of this.bloomRTs) t.dispose();
    for (const t of this.bloomUpRTs) t.dispose();
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      generateMipmaps: false,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(lw, lh, opts);
    this.sceneRT.texture.minFilter = THREE.NearestFilter;
    this.sceneRT.texture.magFilter = THREE.NearestFilter;
    this.overlayRT = new THREE.WebGLRenderTarget(lw, lh, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.bloomRTs = [];
    this.bloomUpRTs = [];
    let bw = lw;
    let bh = lh;
    for (let i = 0; i < 4; i++) {
      bw = Math.max(4, Math.ceil(bw / 2));
      bh = Math.max(4, Math.ceil(bh / 2));
      this.bloomRTs.push(new THREE.WebGLRenderTarget(bw, bh, { ...opts, depthBuffer: false }));
      this.bloomUpRTs.push(new THREE.WebGLRenderTarget(bw, bh, { ...opts, depthBuffer: false }));
    }
    this.resUniform.value.set(lw, lh);
    this.bulletUniforms.uRes.value.set(lw, lh);
    this.pixelScaleUniform.value = lh / 360;
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  update(dt: number, time: number): void {
    if (this.palT < this.palDur) this.palT += dt;
    this.postMat.uniforms.uPalMix!.value = Math.min(this.palT / this.palDur, 1);
    this.lights.uniforms.uTime.value = time;
    this.bulletUniforms.uTime.value = time;
  }

  render(
    world: THREE.Scene,
    overlay: THREE.Scene,
    tele: THREE.Scene | null,
    camera: THREE.PerspectiveCamera,
    time: number,
  ): void {
    const r = this.renderer;
    r.info.reset();
    // 1) HDR world at low res
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(world, camera);
    // 2) Readability layer
    r.setRenderTarget(this.overlayRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(overlay, camera);
    // 3) Bloom chain (dual-filter)
    let src = this.sceneRT.texture;
    let sw = this.lowW;
    let sh = this.lowH;
    for (let i = 0; i < this.bloomRTs.length; i++) {
      this.downMat.uniforms.tSrc!.value = src;
      this.downMat.uniforms.uTexel!.value.set(1 / sw, 1 / sh);
      this.downMat.uniforms.uThreshold!.value = i === 0 ? this.look.bloomThreshold : 0;
      this.blit(this.downMat, this.bloomRTs[i]!);
      src = this.bloomRTs[i]!.texture;
      sw = this.bloomRTs[i]!.width;
      sh = this.bloomRTs[i]!.height;
    }
    let up = this.bloomRTs[this.bloomRTs.length - 1]!.texture;
    for (let i = this.bloomRTs.length - 2; i >= 0; i--) {
      const t = this.bloomUpRTs[i]!;
      this.upMat.uniforms.tSrc!.value = up;
      this.upMat.uniforms.tBase!.value = this.bloomRTs[i]!.texture;
      this.upMat.uniforms.uTexel!.value.set(1 / t.width, 1 / t.height);
      this.blit(this.upMat, t);
      up = t.texture;
    }
    // 4) Post: palette + dither + composite, native res
    const u = this.postMat.uniforms;
    u.tScene!.value = this.sceneRT.texture;
    u.tBloom!.value = up;
    u.tOverlay!.value = this.overlayRT.texture;
    u.uLowRes!.value.set(this.lowW, this.lowH);
    u.uOutRes!.value.set(this.outW, this.outH);
    u.uExposure!.value = this.look.exposure;
    u.uBloom!.value = this.look.bloom;
    u.uSpread!.value = this.look.spread;
    u.uMatrix!.value = this.look.matrix;
    u.uScan!.value = this.look.scanlines;
    u.uVignette!.value = this.look.vignette;
    u.uHush!.value = this.fx.hush;
    u.uFlare!.value = this.fx.flare;
    u.uLowHp!.value = this.fx.lowHp;
    u.uDamage!.value = this.fx.damage;
    u.uWarp!.value = this.fx.warp;
    u.uFlash!.value = this.fx.flash;
    u.uBreath!.value = this.fx.breath;
    u.uInk!.value = this.fx.ink;
    u.uPaper!.value = this.fx.paper;
    u.uTime!.value = time;
    u.uReduceFlash!.value = this.reduceFlash;
    u.uCamRot!.value.setFromMatrix4(camera.matrixWorld);
    const th = Math.tan((camera.fov * Math.PI) / 360);
    u.uTanHalf!.value.set(th * camera.aspect, th);
    u.uSkyScale!.value = (this.lowH / (2 * th)) * (this.look.skyScale / 220);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    this.blit(this.postMat, null);
    // 5) Native-res depth prepass of hulls (layer 1) so vector edge cores are
    //    hidden-line occluded, then crisp vector cores + telegraphs on top.
    if (tele) {
      r.clear(false, true, false);
      const mask = camera.layers.mask;
      camera.layers.set(1);
      world.overrideMaterial = this.depthMat;
      r.render(world, camera);
      world.overrideMaterial = null;
      camera.layers.mask = mask;
      r.render(tele, camera);
    }
    this.drawCalls = r.info.render.calls;
    this.triangles = r.info.render.triangles;
  }

  /** Compile all materials up front so the first explosion never hitches. */
  prewarm(scenes: THREE.Scene[], camera: THREE.Camera): void {
    for (const s of scenes) this.renderer.compile(s, camera);
  }
}
