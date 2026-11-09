/**
 * Dev-only SFX board: live audition of every patch, plus scripted scenes
 * (a sustained firefight, a boss beat) and an offline renderer used by
 * scripts/sfx/render.mjs to measure loudness, peaks, clicks and harshness.
 */
import { AudioEngine, type SfxId } from '../../src/audio/audio';

const GROUPS: Record<string, SfxId[]> = {
  weapons: [
    'kinetic',
    'scatter',
    'heavy',
    'rail',
    'energy',
    'arc',
    'missile',
    'mine',
    'exotic',
    'drone',
    'light',
  ],
  impacts: [
    'hit',
    'crit',
    'block',
    'parry',
    'guard',
    'shieldRam',
    'shieldReflect',
    'kill',
    'killBig',
    'explosion',
    'reaction',
    'status',
  ],
  player: [
    'pickup',
    'graze',
    'hurt',
    'shieldBreak',
    'dodge',
    'boost',
    'flareOn',
    'flareOff',
    'lumenFull',
    'streak',
    'heartbeat',
    'laststand',
    'evolve',
    'dropSpawn',
    'dropPick',
  ],
  threats: [
    'enemyShot',
    'enemyBig',
    'telegraph',
    'spawn',
    'shockwave',
    'stasis',
    'boss',
    'bossPhase',
    'bossDeath',
    'relight',
    'death',
  ],
  warp: ['warpCharge', 'warpGo', 'warpArrive'],
  interface: ['uiMove', 'uiSelect', 'uiBack', 'uiBuy', 'uiDeny', 'cardIn'],
};

type Step = [t: number, fn: (a: AudioEngine, dt: number) => void];

/** Scripted scenes, as timed steps. */
function scene(name: string): { seconds: number; steps: Step[] } {
  const steps: Step[] = [];
  const at = (t: number, fn: (a: AudioEngine, dt: number) => void) => steps.push([t, fn]);
  if (name === 'firefight') {
    // 8 s of rapid kinetic fire with hits, kills, enemy fire and a telegraph
    for (let t = 0.05; t < 8; t += 1 / 12)
      at(t, (a) => a.play('kinetic', 0, 0.55, 1 + Math.min(1, t / 3.3) * 0.05));
    for (let t = 0.1; t < 8; t += 0.09) at(t, (a) => a.play('hit', Math.sin(t * 3) * 0.5, 0.5));
    for (let t = 0.6; t < 8; t += 0.45)
      at(t, (a) => a.play('kill', Math.cos(t) * 0.6, 0.8, 1 + (t % 2) * 0.1));
    for (let t = 0.3; t < 8; t += 0.33)
      at(t, (a) => a.play('enemyShot', Math.sin(t * 1.7) * 0.7, 0.45, 1, 0.4));
    at(2.5, (a) => a.play('telegraph', 0.3, 0.5));
    at(3.1, (a) => a.play('hurt', 0, 1));
    at(4.4, (a) => a.play('killBig', -0.2, 0.8));
    at(5.2, (a) => a.play('dodge', 0, 0.8));
    for (let t = 0; t < 8; t += 1 / 60) at(t, (a, dt) => (a.engineHold(true, 0.6), a.tick(dt)));
    return { seconds: 9, steps };
  }
  if (name === 'beam') {
    for (let t = 0.05; t < 2.5; t += 1 / 30) at(t, (a, dt) => (a.beamHold(true, 1), a.tick(dt)));
    for (let t = 2.5; t < 3.2; t += 1 / 30) at(t, (a, dt) => a.tick(dt));
    return { seconds: 3.5, steps };
  }
  if (name === 'boost') {
    for (let t = 0.05; t < 2; t += 1 / 30)
      at(t, (a, dt) => (a.boostHold(true), a.engineHold(true, 1), a.tick(dt)));
    for (let t = 2; t < 3; t += 1 / 30)
      at(t, (a, dt) => (a.boostHold(false), a.engineHold(true, 0.3), a.tick(dt)));
    return { seconds: 3.5, steps };
  }
  const id = name as SfxId;
  const long = [
    'boss',
    'bossDeath',
    'relight',
    'death',
    'warpCharge',
    'evolve',
    'flareOn',
    'stasis',
    'warpArrive',
    'warpGo',
  ];
  at(0.05, (a) => a.play(id, 0, 1, id === 'pickup' ? 4 : 1));
  return { seconds: long.includes(id) ? 6.5 : 3, steps };
}

// ---------------------------------------------------------------- live board
let live: AudioEngine | null = null;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

function engine(): AudioEngine {
  if (!live) {
    live = new AudioEngine();
    live.volumes = { ...live.volumes, ambience: 0.5 };
    live.init();
    const st = document.getElementById('status')!;
    const poll = () => {
      st.textContent = live!.bank.ready
        ? 'sprite loaded'
        : live!.bank.failed
          ? 'sprite failed: synth fallback'
          : 'loading sprite…';
      if (!live!.bank.ready && !live!.bank.failed) setTimeout(poll, 100);
    };
    poll();
    const tick = () => {
      live!.tick(1 / 60);
      requestAnimationFrame(tick);
    };
    tick();
  }
  live.init();
  return live;
}

function withFallback<T>(a: AudioEngine, fn: () => T): T {
  const bank = a.bank as unknown as { ready: boolean };
  const was = bank.ready;
  if ($('synth').checked) bank.ready = false;
  try {
    return fn();
  } finally {
    bank.ready = was;
  }
}

function playLive(name: string): void {
  const a = engine();
  const sc = scene(name);
  const t0 = performance.now();
  let last = t0;
  const pending = [...sc.steps].sort((x, y) => x[0] - y[0]);
  const pan = +$('pan').value;
  const far = +$('far').value;
  const pitch = +$('pitch').value;
  if (pending.length === 1)
    return void withFallback(a, () => a.play(name as SfxId, pan, 1, name === 'pickup' ? 4 : pitch, far));
  const run = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    while (pending.length && pending[0]![0] * 1000 <= now - t0)
      withFallback(a, () => pending.shift()![1](a, dt));
    if (pending.length) requestAnimationFrame(run);
  };
  run();
}

const root = document.getElementById('groups')!;
for (const [g, ids] of Object.entries({ ...GROUPS, scenes: ['firefight', 'beam', 'boost'] })) {
  const h = document.createElement('h2');
  h.textContent = g;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const id of ids) {
    const b = document.createElement('button');
    b.textContent = id;
    b.onclick = () => playLive(id);
    grid.append(b);
  }
  root.append(h, grid);
}

// ---------------------------------------------------------------- offline render (automation)
async function render(
  name: string,
  synth = false,
): Promise<{ sr: number; l: Float32Array; r: Float32Array }> {
  const sc = scene(name);
  const W = window as unknown as { AudioContext: typeof AudioContext };
  const Real = W.AudioContext;
  const frames = Math.ceil(48000 * sc.seconds);
  class Offline extends OfflineAudioContext {
    constructor() {
      super(2, frames, 48000);
    }
    override get state(): AudioContextState {
      return 'running';
    }
  }
  W.AudioContext = Offline as unknown as typeof AudioContext;
  const a = new AudioEngine();
  a.volumes = { ...a.volumes, ambience: 0 };
  try {
    a.init();
  } finally {
    W.AudioContext = Real;
  }
  if (!synth) while (!a.bank.ready && !a.bank.failed) await new Promise((r) => setTimeout(r, 20));
  else (a.bank as unknown as { ready: boolean }).ready = false;
  const ctx = a.ctx as unknown as OfflineAudioContext;
  const q = 128 / 48000;
  let prev = 0;
  const byT = new Map<number, ((a: AudioEngine, dt: number) => void)[]>();
  for (const [t, fn] of sc.steps) {
    const k = Math.max(q, Math.round(t / q) * q);
    if (!byT.has(k)) byT.set(k, []);
    byT.get(k)!.push(fn);
  }
  for (const k of [...byT.keys()].sort((x, y) => x - y)) {
    void ctx.suspend(k).then(() => {
      const dt = k - prev;
      prev = k;
      for (const fn of byT.get(k)!) fn(a, dt);
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  return { sr: buf.sampleRate, l: buf.getChannelData(0), r: buf.getChannelData(1) };
}

function wav(l: Float32Array, r: Float32Array, sr: number): string {
  // 32-bit float stereo WAV
  const n = l.length;
  const v = new DataView(new ArrayBuffer(44 + n * 8));
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 8, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 8, true);
  v.setUint16(32, 8, true);
  v.setUint16(34, 32, true);
  w(36, 'data');
  v.setUint32(40, n * 8, true);
  for (let i = 0; i < n; i++) {
    v.setFloat32(44 + i * 8, l[i]!, true);
    v.setFloat32(48 + i * 8, r[i]!, true);
  }
  const bytes = new Uint8Array(v.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as unknown as Record<string, unknown>).__sfx = {
  names: [...Object.values(GROUPS).flat(), 'firefight', 'beam', 'boost'],
  async renderWav(name: string, synth = false) {
    const r = await render(name, synth);
    return wav(r.l, r.r, r.sr);
  },
};
