import * as THREE from 'three';
import { GameLoop, SIM_DT } from '../core/loop';
import { Input } from '../core/input';
import { Rng, dailySeed, randomSeedString, fxRng, hashString } from '../core/rng';
import { clamp, damp, hexToRgb } from '../core/math';
import { Pipeline, DEFAULT_LOOK } from '../render/pipeline';
import { View } from '../render/view';
import { AudioEngine } from '../audio/audio';
import { UI } from '../ui/ui';
import { SaveSystem, type RunRecord } from '../meta/save';
import { PALETTES, paletteById } from '../data/palettes';
import { SECTORS, HULLS, HULL_BY_ID, EVENTS, CHALLENGES, LORE, HEARTH_UNLOCKS, type EventDef, type EventEffect } from '../data/world';
import { WEAPONS, WEAPON_BY_ID } from '../data/weapons';
import { UPGRADES } from '../data/upgrades';
import { SYNERGIES } from '../data/upgrades';
import { Build, cardRarity, cardTitle, type DraftCard } from './build';
import { World } from './world';
import { emptyControls, type Controls } from './player';
import { Director, generateMap, embersFor, priceFor, type EncounterKind, type MapNode, type SectorMap } from './run';
import { Juice } from './juice';
import { aim } from './weapons';
import * as S from '../ui/screens';
import { Hud } from '../ui/hud';

export type State =
  | 'boot' | 'title' | 'hearth' | 'map' | 'combat' | 'draft' | 'shop' | 'event' | 'forge' | 'rest' | 'pause'
  | 'death' | 'victory' | 'warp' | 'codex' | 'settings' | 'credits';

export interface ShopItem {
  kind: 'weapon' | 'upgrade' | 'repair' | 'fullrepair' | 'level';
  id: string;
  name: string;
  desc: string;
  price: number;
  rarity: string;
  sold: boolean;
}

export interface RunState {
  seed: string;
  rng: Rng;
  daily: boolean;
  heat: number;
  hull: string;
  sector: number;
  map: SectorMap;
  node: number;
  rerolls: number;
  freeRerolls: number;
  banishes: number;
  startTime: number;
  sectorLight: number;
  endless: boolean;
  endlessWaves: number;
  encounters: number;
  lastEvent?: EventDef;
  eventOutcome?: string;
  shop?: ShopItem[];
  draft?: DraftCard[];
  draftCtx?: { minRarity?: 'rare' | 'legendary'; artifacts?: boolean; curse?: boolean; after: 'map' | 'sector' };
  lore: string[];
  won: boolean;
  /** an event choice queued a fight; the player may not leave the event */
  pendingFight: boolean;
  /** rewards already paid by an earlier finishRun (victory before endless) */
  paid?: { embers: number; record: RunRecord };
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly pipe: Pipeline;
  readonly view: View;
  readonly input: Input;
  readonly audio = new AudioEngine();
  readonly loop: GameLoop;
  readonly ui: UI;
  readonly save = new SaveSystem();
  readonly juice: Juice;
  hud!: Hud;
  state: State = 'boot';
  prevState: State = 'title';
  world: World | null = null;
  run: RunState | null = null;
  director: Director | null = null;
  controls: Controls = emptyControls();
  private pendingYaw = 0;
  private pendingPitch = 0;
  time = 0;
  camMode: 'chase' | 'cockpit' = 'chase';
  private camPos = new THREE.Vector3(0, 5, 80);
  private camQuat = new THREE.Quaternion();
  showPerf = false;
  showDebug = false;
  private warp: { t: number; dur: number; then: () => void; switched: boolean; palette: string } | null = null;
  private autoT = 0;
  private hintStep = 0;
  hints: string | null = null;
  private hintDone = new Set<string>();
  sectorTitle: { name: string; sub: string; t: number } | null = null;
  godMode = false;
  /** test-only: steer toward the nearest enemy */
  autopilot = false;
  private frameCount = 0;
  private fpsAcc = 0;
  fps = 60;
  stressMode = false;
  settingsTab = 'video';
  codexTab = 'enemies';
  hearthTab = 'unlocks';
  selectedHull = 'lantern';
  selectedHeat = 0;
  selectedPrimary = '';
  lastRecord: RunRecord | null = null;
  deathT = 0;
  private relight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.pipe = new Pipeline(canvas);
    this.view = new View(this.pipe);
    this.input = new Input(canvas);
    this.ui = new UI(this.input, this.audio);
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: (a, fdt) => this.render(a, fdt) });
    this.juice = new Juice(this.view, this.audio, this.loop, this.pipe, () => this.save.data.settings);
    this.view.camera.position.copy(this.camPos);
  }

  get settings() {
    return this.save.data.settings;
  }

  async boot(): Promise<void> {
    await this.save.load();
    this.hud = new Hud(this);
    this.applySettings();
    this.selectedHull = this.save.data.hulls.includes(this.selectedHull) ? this.selectedHull : 'lantern';
    S.registerActions(this);
    // first user gesture unlocks audio
    const unlock = () => {
      this.audio.init();
      this.audio.applyVolumes();
      if (this.audio.music && !this.audio.music.playing) {
        this.audio.music.configure(SECTORS[0]!.music);
        this.audio.music.start();
      }
      this.audio.music!.onBeat = (step) => {
        if (step === 0) this.juice.breath = Math.max(this.juice.breath, 0.12);
      };
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.canvas.addEventListener('click', () => {
      if (this.state === 'combat') this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
        this.showDebug = !this.showDebug;
        this.hud.renderDebug();
      }
      if (e.code === 'F3') this.showPerf = !this.showPerf;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'combat') this.pause();
    });
    this.buildBackdrop('hearth', 7);
    this.pipe.setPalette(paletteById('hearth'));
    // shader prewarm: compile everything once so the first explosion never hitches
    this.view.sync(null, 1, 0, 0.016);
    this.pipe.prewarm([this.view.world, this.view.overlay, this.view.tele], this.view.camera);
    this.prewarmFx();
    this.goTitle();
    this.loop.start();
  }

  /** Render one frame with every effect type so GPU programs and buffers are hot. */
  private prewarmFx(): void {
    const b = new Build(HULLS[0]!, this.meta(), undefined);
    const w = new World('prewarm', b);
    w.spawnEnemy('moteeater', 0, 0, 0);
    w.spawnEnemy('asteroid', 10, 0, 0);
    this.juice.explosionFx(0, 0, -20, 3, 1, 0.6, 0.3, 'salvage', 1);
    this.view.sync(w, 1, 0, 0.016);
    this.pipe.render(this.view.world, this.view.overlay, this.view.tele, this.view.camera, 0);
    this.view.particles.clear();
    this.pipe.lights.clear();
  }

  meta() {
    const d = this.save.data;
    return {
      bonusHull: 8 * this.save.unlockLevel('b_hull'),
      bonusShield: 6 * this.save.unlockLevel('b_shield'),
      bonusLight: 0.05 * this.save.unlockLevel('b_light'),
      unlockedWeapons: new Set(d.weapons),
      tier2: this.save.unlockLevel('p_tier2') > 0 || d.runs >= 3,
      heat: this.run?.heat ?? this.selectedHeat,
    };
  }

  applySettings(): void {
    const s = this.settings;
    this.input.bindings = s.bindings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.input.holdToggle.boost = s.boostToggle;
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    this.pipe.setTones(s.colorblind);
    const pt = this.pipe.bulletUniforms.uPlayerTone.value;
    this.view.setPlayerTone(pt.x, pt.y, pt.z);
    this.audio.volumes = { ...s.volumes };
    this.audio.applyVolumes();
    this.audio.setMono(s.mono);
    this.camMode = s.cockpit ? 'cockpit' : 'chase';
    const q = s.quality;
    const look = this.pipe.look;
    const presets = {
      low: { px: 4, budget: 0.4, strokes: 600, bloom: 0.6 },
      medium: { px: 3, budget: 0.7, strokes: 1000, bloom: 0.8 },
      high: { px: 3, budget: 1, strokes: 1400, bloom: 0.9 },
      ultra: { px: 2, budget: 1, strokes: 2000, bloom: 1 },
      auto: { px: 3, budget: 1, strokes: 1400, bloom: 0.9 },
    } as const;
    const p = presets[q];
    look.pixelScale = p.px;
    look.bloom = p.bloom;
    look.scanlines = s.scanlines ? DEFAULT_LOOK.scanlines : 0;
    this.view.particles.budgetScale = p.budget;
    this.view.space.setStrokeCount(p.strokes);
    this.pipe.resScale = 1;
    this.pipe.rebuildTargets();
    this.audio.onCue = s.visualCues ? (id, pan) => this.hud.cue(id, pan) : null;
  }

  buildBackdrop(palette: string, seed: number): void {
    this.view.space.build(paletteById(palette), seed);
  }

  // ------------------------------------------------------------ states

  setState(s: State): void {
    this.prevState = this.state;
    this.state = s;
    if (s !== 'combat') this.input.releaseLock();
    this.hud.setMode(s);
    // menus print ink-on-paper over the paper-negative world (style A)
    document.body.classList.remove('print');
  }

  goTitle(): void {
    this.world = null;
    this.run = null;
    this.director = null;
    this.view.markers.length = 0;
    this.buildBackdrop('hearth', 7);
    this.pipe.setPalette(paletteById('hearth'), 1);
    this.view.space.starPower = 0.3 + Math.min(0.7, this.save.data.hearthLevel * 0.08);
    this.view.space.applyStarPower();
    this.setState('title');
    S.showTitle(this);
    if (this.audio.music) {
      this.audio.music.configure({ root: 45, scale: [0, 2, 4, 7, 9], bpm: 84, voice: 'glass' });
      this.audio.music.targetIntensity = 0.1;
      this.audio.music.boss = false;
    }
  }

  goHearth(): void {
    this.setState('hearth');
    S.showHearth(this);
  }

  pause(): void {
    if (this.state !== 'combat') return;
    this.setState('pause');
    S.showPause(this);
    this.audio.setMusicFilter(900);
  }

  resume(): void {
    if (this.state !== 'pause') return;
    this.setState('combat');
    this.ui.clear();
    this.audio.setMusicFilter(18000);
  }

  // ------------------------------------------------------------ run flow

  startRun(opts: { daily?: boolean; seed?: string; hull?: string; heat?: number; primary?: string } = {}): void {
    const d = this.save.data;
    const daily = !!opts.daily;
    const seed = opts.seed ?? (daily ? dailySeed() : randomSeedString());
    const hull = HULL_BY_ID[opts.hull ?? this.selectedHull] ?? HULLS[0]!;
    const heat = daily ? 0 : (opts.heat ?? this.selectedHeat);
    const rng = new Rng(seed);
    this.run = {
      seed, rng, daily, heat, hull: hull.id, sector: 0, map: generateMap(Math.floor(rng.next() * 1e9), 0, { rifts: this.save.unlockLevel('p_curses') > 0, heat }),
      node: -1, rerolls: 0, freeRerolls: this.save.unlockLevel('b_reroll'), banishes: 1 + this.save.unlockLevel('b_banish'),
      startTime: performance.now(), sectorLight: 0, endless: false, endlessWaves: 0, encounters: 0, lore: [], won: false, pendingFight: false,
    };
    const primary = opts.primary ?? (this.save.unlockLevel('l_pick') > 0 && this.selectedPrimary ? this.selectedPrimary : undefined);
    const build = new Build(hull, { ...this.meta(), heat }, primary);
    this.world = new World(seed, build);
    this.world.heat = heat;
    this.world.player.light = 40 * this.save.unlockLevel('b_start');
    (this.world as unknown as { deathBloom: boolean }).deathBloom = d.equippedCosmetics.death === 'c_death_bloom';
    this.juice.attach(this.world);
    this.hookWorld(this.world);
    this.view.setHull(hull.id, hull.accent);
    const trail = d.equippedCosmetics.trail;
    const tc = trail === 'c_trail_gold' ? '#ffc040' : trail === 'c_trail_violet' ? '#b070ff' : hull.accent;
    const [r, g, b] = hexToRgb(tc);
    this.view.trailColor.set(r * 1.4, g * 1.2, b);
    for (const w of build.weapons) this.save.discover('weapons', w.def.id);
    d.runs++;
    this.save.save();
    this.hintStep = d.tutorialDone ? 99 : 0;
    this.enterSector(0, true);
  }

  private hookWorld(w: World): void {
    w.events.on('playerDeath', () => {
      this.deathT = 2.2;
    });
    w.events.on('spawn', () => void 0);
    w.events.on('bossDeath', () => {
      this.relight = 1;
      if (this.run) this.save.data.bossesKilled.includes(SECTORS[this.run.sector]!.boss) || this.save.data.bossesKilled.push(SECTORS[this.run.sector]!.boss);
    });
    w.events.on('reaction', (r) => {
      if (this.save.discover('synergies', r.id)) this.juice.toast('REACTION DISCOVERED', '#ff9ad0');
    });
  }

  enterSector(idx: number, first = false): void {
    const run = this.run!;
    run.sector = idx;
    run.sectorLight = 0;
    run.freeRerolls = this.save.unlockLevel('b_reroll');
    if (!first) run.map = generateMap(Math.floor(run.rng.next() * 1e9), idx, { rifts: this.save.unlockLevel('p_curses') > 0, heat: run.heat });
    run.node = -1;
    const sec = SECTORS[idx]!;
    const doEnter = () => {
      this.buildBackdrop(sec.palette, hashString(run.seed + idx));
      this.view.space.starPower = 0.25;
      this.view.space.applyStarPower();
      this.audio.music?.configure(sec.music);
      if (this.audio.music) this.audio.music.targetIntensity = 0.15;
      this.world!.stats.sectorGrazes = 0;
      this.sectorTitle = { name: sec.name, sub: sec.intro, t: 4.5 };
      this.discoverLore(['vela', 'antares', 'sirius', 'pulsar', 'laststar'][idx]!);
      this.openMap();
    };
    if (first) {
      this.pipe.setPalette(paletteById(sec.palette), 1.2);
      doEnter();
    } else this.doWarp(sec.palette, doEnter);
  }

  openMap(): void {
    this.world!.clearArena();
    this.world!.motes.n = 0;
    this.world!.debris.n = 0;
    this.view.markers.length = 0;
    this.setState('map');
    this.mapFocus = -1;
    S.showMap(this);
    if (this.audio.music) {
      this.audio.music.targetIntensity = 0.15;
      this.audio.music.boss = false;
    }
  }

  mapFocus = -1;

  reachable(): MapNode[] {
    const run = this.run!;
    const nodes = run.map.nodes;
    if (run.node < 0) return nodes.filter((n) => n.row === 0);
    const cur = nodes[run.node]!;
    return cur.links.map((id) => nodes[id]!);
  }

  chooseNode(id: number): void {
    const run = this.run!;
    const node = run.map.nodes[id];
    if (!node || !this.reachable().includes(node)) {
      this.audio.play('uiDeny');
      return;
    }
    run.node = id;
    node.visited = true;
    const pal = SECTORS[run.sector]!.palette;
    this.doWarp(pal, () => this.resolveNode(node));
  }

  private resolveNode(node: MapNode): void {
    const run = this.run!;
    switch (node.type) {
      case 'combat':
        this.startEncounter(run.encounters === 0 && this.hintStep < 99 ? 'tutorial' : 'combat', node.seed);
        break;
      case 'elite':
        this.startEncounter('elite', node.seed);
        break;
      case 'derelict':
        this.startEncounter('derelict', node.seed);
        break;
      case 'rift':
        this.startEncounter('rift', node.seed);
        break;
      case 'boss':
        this.startEncounter('boss', node.seed);
        break;
      case 'shop':
        this.openShop(node.seed);
        break;
      case 'event':
        this.openEvent(node.seed);
        break;
      case 'forge':
        this.setState('forge');
        S.showForge(this);
        break;
      case 'rest':
        this.setState('rest');
        S.showRest(this);
        break;
    }
  }

  startEncounter(kind: EncounterKind, seed: number): void {
    const w = this.world!;
    const run = this.run!;
    w.clearArena();
    w.motes.n = 0;
    w.debris.n = 0;
    w.proj.clear();
    w.eproj.clear();
    this.pipe.lights.clear();
    const pl = w.player;
    pl.pos.set(0, 0, 70);
    pl.prev.copy(pl.pos);
    pl.vel.set(0, 0, -30);
    pl.quat.identity();
    pl.prevQuat.identity();
    pl.shield = pl.maxShield;
    pl.boostEnergy = 1;
    pl.dodgeCharges = w.build.ship.dodges;
    pl.lumen = Math.min(pl.lumen, 99);
    pl.flareT = 0;
    this.view.resetTrail();
    this.camPos.set(0, 3, 82);
    this.director = new Director(kind, run.sector, seed, w, run.heat);
    run.encounters++;
    run.pendingFight = false;
    this.setState('combat');
    this.ui.clear();
    this.input.requestLock();
    w.fireTriggers('waveStart', pl.pos.x, pl.pos.y, pl.pos.z, 0);
    const m = this.audio.music;
    if (m) {
      m.targetIntensity = kind === 'boss' ? 1 : 0.55;
      m.boss = kind === 'boss';
      if (kind === 'boss') {
        m.silence = this.audio.now + 2.2; // silence right before the boss reveal
        setTimeout(() => this.audio.play('boss', 0, 1), 1500);
        this.sectorTitle = { name: this.director.boss!.name, sub: this.director.boss!.def.title, t: 4 };
      }
    }
    if (kind === 'derelict') this.discoverLore(fxRng.pick(['salvage', 'ash', 'hush', 'lantern']));
    if (kind === 'tutorial') this.hintStep = 0;
  }

  /** Called each sim tick in combat. */
  private updateCombat(dt: number): void {
    const w = this.world!;
    const dir = this.director!;
    const run = this.run!;
    if (this.godMode) {
      w.player.hull = w.player.maxHull;
      w.player.lumen = Math.max(w.player.lumen, 50);
    }
    dir.update(dt);
    w.update(this.controls, dt);
    if (dir.kind === 'derelict') {
      this.view.markers = dir.beacons.map((b) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z, r: 12, lit: b.lit ? 1 : b.progress }));
    }
    run.sectorLight = w.player.lightTotal;
    if (dir.kind === 'endless') run.endlessWaves = dir.endlessWave;
    // codex: enemies seen
    for (const id of w.stats.enemiesSeen) this.save.data.codex.enemies.includes(id) || this.save.data.codex.enemies.push(id);
    if (!w.player.alive) {
      this.deathT -= dt;
      if (this.deathT <= 0) this.onDeath();
      return;
    }
    if (dir.done) this.onEncounterCleared();
  }

  private onEncounterCleared(): void {
    const w = this.world!;
    const run = this.run!;
    const dir = this.director!;
    this.director = null;
    this.view.markers.length = 0;
    // vacuum up remaining motes
    for (let i = 0; i < w.motes.n; i++) {
      w.player.light += w.motes.value[i]! * w.build.ship.lightGain;
      w.player.lightTotal += w.motes.value[i]! * w.build.ship.lightGain;
    }
    w.motes.n = 0;
    this.hintStep = Math.max(this.hintStep, 99);
    if (!this.save.data.tutorialDone) {
      this.save.data.tutorialDone = true;
      this.save.save();
    }
    const kind = dir.kind;
    if (kind === 'boss') {
      this.view.space.starPower = 1;
      this.view.space.applyStarPower();
      this.juice.toast('THE STAR IS RELIT', '#fff6c0');
      if (run.sector === 0) this.challenge('first_boss');
      if (run.sector >= SECTORS.length - 1 && !run.endless) {
        run.won = true;
        this.setState('victory');
        this.finishRun(true);
        S.showVictory(this);
        return;
      }
      this.openDraft({ minRarity: 'rare', after: 'sector' });
      return;
    }
    if (kind === 'endless') return;
    if (kind === 'elite') this.openDraft({ minRarity: 'rare', artifacts: true, after: 'map' });
    else if (kind === 'rift') this.openDraft({ minRarity: 'legendary', artifacts: true, curse: true, after: 'map' });
    else this.openDraft({ after: 'map' });
  }

  openDraft(ctx: NonNullable<RunState['draftCtx']>): void {
    const run = this.run!;
    const w = this.world!;
    run.draftCtx = ctx;
    run.draft = w.build.draft(run.rng.fork('draft' + run.encounters + ':' + run.rerolls), { minRarity: ctx.minRarity, allowArtifacts: ctx.artifacts });
    if (ctx.curse) {
      const curses = UPGRADES.filter((u) => u.rarity === 'curse' && !w.build.upgrades.has(u.id));
      if (curses.length) {
        const c = run.rng.pick(curses);
        w.build.addUpgrade(c);
        this.juice.toast(`CURSED: ${c.name.toUpperCase()}`, '#ff5a5a');
        w.refreshParams();
      }
    }
    this.setState('draft');
    S.showDraft(this);
    this.audio.play('cardIn', 0, 0.8);
    setTimeout(() => this.audio.play('cardIn', 0, 0.6, 1.2), 100);
    setTimeout(() => this.audio.play('cardIn', 0, 0.6, 1.4), 200);
  }

  pickCard(i: number): void {
    const run = this.run!;
    const w = this.world!;
    const card = run.draft?.[i];
    if (!card) return;
    const prevSyn = new Set(w.build.synergies);
    w.build.apply(card);
    w.refreshParams();
    if (card.kind === 'upgrade') this.save.discover('items', card.def.id);
    if (card.kind === 'weapon') this.save.discover('weapons', card.def.id);
    if (card.kind === 'evolve') {
      w.events.emit('evolve', { name: card.weapon.def.evolve.name });
      this.challenge('evolve');
      if (w.build.weapons.filter((x) => x.evolved).length >= 3) this.challenge('evolve3');
    }
    for (const s of w.build.synergies) {
      if (!prevSyn.has(s)) {
        const def = SYNERGIES.find((x) => x.id === s)!;
        this.juice.toast(`SYNERGY: ${def.name.toUpperCase()}`, '#ffe080');
        this.save.discover('synergies', s);
      }
    }
    if (w.build.synergies.size >= 5) this.challenge('synergy5');
    // shield top-up keeps the hull upgrade visible
    w.player.shield = w.player.maxShield;
    this.save.save();
    this.afterDraft();
  }

  skipDraft(): void {
    const w = this.world!;
    w.player.light += 25;
    this.afterDraft();
  }

  rerollDraft(): void {
    const run = this.run!;
    const w = this.world!;
    const cost = run.freeRerolls > 0 ? 0 : 20 + run.rerolls * 15;
    if (w.player.light < cost) {
      this.audio.play('uiDeny');
      return;
    }
    if (run.freeRerolls > 0) run.freeRerolls--;
    else w.player.light -= cost;
    run.rerolls++;
    run.draft = w.build.draft(run.rng.fork('reroll' + run.rerolls), { minRarity: run.draftCtx?.minRarity, allowArtifacts: run.draftCtx?.artifacts });
    S.showDraft(this);
    this.audio.play('cardIn', 0, 0.8);
  }

  banishCard(i: number): void {
    const run = this.run!;
    const card = run.draft?.[i];
    if (!card || card.kind !== 'upgrade' || run.banishes <= 0) return;
    run.banishes--;
    this.world!.build.banished.add(card.def.id);
    run.draft = this.world!.build.draft(run.rng.fork('banish' + run.banishes + run.rerolls), { minRarity: run.draftCtx?.minRarity, allowArtifacts: run.draftCtx?.artifacts });
    S.showDraft(this);
  }

  private afterDraft(): void {
    const run = this.run!;
    if (run.draftCtx?.after === 'sector') this.enterSector(run.sector + 1);
    else this.openMap();
  }

  // ------------------------------------------------------------ shop / event / forge / rest

  openShop(seed: number): void {
    const run = this.run!;
    const w = this.world!;
    const rng = new Rng(seed);
    const disc = w.build.ship.shopDiscount;
    const items: ShopItem[] = [];
    const ws = WEAPONS.filter((x) => this.save.data.weapons.includes(x.id) && !w.build.ownsWeapon(x.id));
    rng.shuffle(ws);
    for (const def of ws.slice(0, 2))
      items.push({ kind: 'weapon', id: def.id, name: def.name, desc: `${def.family} · ${def.slot}. ${def.desc}`, price: priceFor('weapon', run.sector, disc, run.heat), rarity: 'rare', sold: false });
    const cards = w.build.draft(rng, { count: 4 });
    for (const c of cards) {
      if (c.kind === 'upgrade')
        items.push({ kind: 'upgrade', id: c.def.id, name: c.def.name, desc: c.def.desc, price: priceFor(c.def.rarity, run.sector, disc, run.heat), rarity: c.def.rarity, sold: false });
      else if (c.kind === 'level') items.push({ kind: 'level', id: c.weapon.def.id, name: `Train ${c.weapon.name}`, desc: `+1 weapon level (Lv ${c.weapon.level + 1}).`, price: priceFor('uncommon', run.sector, disc, run.heat), rarity: 'uncommon', sold: false });
    }
    items.push({ kind: 'repair', id: 'repair', name: 'Patch Hull', desc: 'Repair 30 hull.', price: Math.round(35 * (1 - disc)), rarity: 'common', sold: false });
    items.push({ kind: 'fullrepair', id: 'full', name: 'Full Overhaul', desc: 'Repair all hull damage.', price: Math.round((60 + run.sector * 25) * (1 - disc)), rarity: 'uncommon', sold: false });
    run.shop = items;
    this.setState('shop');
    S.showShop(this);
  }

  buy(i: number): void {
    const run = this.run!;
    const w = this.world!;
    const it = run.shop?.[i];
    if (!it || it.sold || w.player.light < it.price) {
      this.audio.play('uiDeny');
      return;
    }
    w.player.light -= it.price;
    switch (it.kind) {
      case 'weapon':
        w.build.addWeapon(WEAPON_BY_ID[it.id]!);
        this.save.discover('weapons', it.id);
        break;
      case 'upgrade':
        w.build.addUpgrade(UPGRADES.find((u) => u.id === it.id)!);
        this.save.discover('items', it.id);
        break;
      case 'level': {
        const wi = w.build.ownsWeapon(it.id);
        if (wi) w.build.levelUp(wi);
        break;
      }
      case 'repair':
        w.player.hull = Math.min(w.player.maxHull, w.player.hull + 30);
        break;
      case 'fullrepair':
        w.player.hull = w.player.maxHull;
        break;
    }
    if (it.kind !== 'repair') it.sold = true;
    w.refreshParams();
    this.audio.play('uiBuy');
    S.showShop(this, true);
  }

  openEvent(seed: number): void {
    const run = this.run!;
    const rng = new Rng(seed);
    run.lastEvent = rng.pick(EVENTS);
    run.eventOutcome = undefined;
    this.setState('event');
    S.showEvent(this);
  }

  chooseEvent(i: number): void {
    const run = this.run!;
    const ev = run.lastEvent!;
    const ch = ev.choices[i];
    if (!ch) return;
    let eff: EventEffect = ch.effect;
    let outcome = ch.outcome;
    if (eff.gamble !== undefined && run.rng.next() > eff.gamble) {
      eff = eff.fail ?? {};
      outcome = 'It goes wrong.';
    }
    const res = this.applyEffect(eff);
    run.eventOutcome = outcome + (res ? ' ' + res : '') + (run.pendingFight ? ' Hostiles incoming!' : '');
    S.showEvent(this);
  }

  /** Returns a short summary of what changed. */
  private applyEffect(eff: EventEffect): string {
    const w = this.world!;
    const run = this.run!;
    const parts: string[] = [];
    if (eff.light) {
      w.player.light = Math.max(0, w.player.light + eff.light);
      parts.push(`${eff.light > 0 ? '+' : ''}${eff.light} Light.`);
    }
    if (eff.hull) {
      w.player.hull = clamp(w.player.hull + eff.hull, 1, w.player.maxHull);
      parts.push(`${eff.hull > 0 ? '+' : ''}${eff.hull} hull.`);
    }
    if (eff.maxHull) {
      w.build.ship.hull += eff.maxHull;
      w.build.hull = { ...w.build.hull, stats: { ...w.build.hull.stats, hull: (w.build.hull.stats.hull ?? 0) + eff.maxHull } };
      w.build.recompute();
      w.player.hull = Math.min(w.player.hull, w.player.maxHull);
      parts.push(`${eff.maxHull} max hull.`);
    }
    if (eff.embers) {
      this.save.data.embers += eff.embers;
      this.save.data.totalEmbers += eff.embers;
      parts.push(`+${eff.embers} Embers sent home.`);
    }
    if (eff.lore) {
      this.discoverLore(eff.lore);
      parts.push('Codex updated.');
    }
    if (eff.weapon) {
      const ws = WEAPONS.filter((x) => this.save.data.weapons.includes(x.id) && !w.build.ownsWeapon(x.id));
      if (ws.length) {
        const def = run.rng.pick(ws);
        w.build.addWeapon(def);
        this.save.discover('weapons', def.id);
        parts.push(`Gained ${def.name}.`);
      }
    }
    if (eff.upgrade) {
      const pool = w.build.upgradePool({ allowArtifacts: eff.upgrade === 'artifact', allowCurses: eff.upgrade === 'curse' }).filter((u) =>
        eff.upgrade === 'artifact' ? u.rarity === 'artifact' : eff.upgrade === 'curse' ? u.rarity === 'curse' : eff.upgrade === 'rare' ? ['rare', 'epic'].includes(u.rarity) : u.rarity !== 'artifact' && u.rarity !== 'curse',
      );
      if (pool.length) {
        const u = run.rng.pick(pool);
        w.build.addUpgrade(u);
        this.save.discover('items', u.id);
        parts.push(`Gained ${u.name}.`);
      }
    }
    w.refreshParams();
    if (eff.fight) {
      run.pendingFight = true;
      setTimeout(() => this.doWarp(SECTORS[run.sector]!.palette, () => this.startEncounter(eff.fight === 'elite' ? 'elite' : 'ambush', Math.floor(run.rng.next() * 1e9))), 900);
    }
    this.save.save();
    return parts.join(' ');
  }

  discoverLore(id: string): void {
    if (!LORE.find((l) => l.id === id)) return;
    if (this.save.discover('lore', id)) this.juice.toast('LORE DISCOVERED', '#c0d0ff');
    this.run?.lore.push(id);
  }

  forgeAction(kind: string, arg: string): void {
    const w = this.world!;
    const run = this.run!;
    const cost = 50 + run.sector * 20;
    if (kind === 'level') {
      const wi = w.build.weapons.find((x) => x.def.id === arg);
      if (!wi || wi.level >= 5 || w.player.light < cost) return void this.audio.play('uiDeny');
      w.player.light -= cost;
      w.build.levelUp(wi);
    } else if (kind === 'reroll') {
      const u = UPGRADES.find((x) => x.id === arg);
      if (!u || w.player.light < cost * 0.6) return void this.audio.play('uiDeny');
      w.player.light -= Math.round(cost * 0.6);
      const n = w.build.upgrades.get(arg)!;
      if (n <= 1) w.build.upgrades.delete(arg);
      else w.build.upgrades.set(arg, n - 1);
      const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      const pool = w.build.upgradePool({ allowArtifacts: false, allowCurses: false }).filter((x) => order.indexOf(x.rarity) >= order.indexOf(u.rarity) && x.id !== u.id);
      if (pool.length) w.build.addUpgrade(run.rng.pick(pool));
      else w.build.recompute();
    } else if (kind === 'fuse') {
      const commons = [...w.build.upgrades.keys()].filter((id) => UPGRADES.find((x) => x.id === id)?.rarity === 'common');
      if (commons.length < 2) return void this.audio.play('uiDeny');
      for (const id of commons.slice(0, 2)) {
        const n = w.build.upgrades.get(id)!;
        if (n <= 1) w.build.upgrades.delete(id);
        else w.build.upgrades.set(id, n - 1);
      }
      w.build.recompute();
      w.refreshParams();
      this.openDraft({ minRarity: 'rare', after: 'map' });
      return;
    } else if (kind === 'leave') {
      this.openMap();
      return;
    }
    w.refreshParams();
    this.audio.play('uiBuy');
    S.showForge(this);
  }

  restAction(kind: string, arg: string): void {
    const w = this.world!;
    if (kind === 'repair') w.player.hull = Math.min(w.player.maxHull, w.player.hull + w.player.maxHull * 0.5);
    else if (kind === 'train') {
      const wi = w.build.weapons.find((x) => x.def.id === arg);
      if (wi) w.build.levelUp(wi);
      w.refreshParams();
    }
    this.audio.play('uiBuy');
    this.openMap();
  }

  // ------------------------------------------------------------ death / victory / meta

  private onDeath(): void {
    if (this.state === 'death') return;
    this.setState('death');
    this.finishRun(false);
    S.showDeath(this);
    this.audio.setMusicFilter(600);
    if (this.audio.music) this.audio.music.targetIntensity = 0.05;
  }

  finishRun(won: boolean): void {
    const run = this.run!;
    const w = this.world!;
    const d = this.save.data;
    const paid = run.paid;
    const total = embersFor({ sector: run.sector + 1, kills: w.stats.kills, bosses: w.stats.bossKills, won, heat: run.heat, light: w.player.lightTotal }) + (run.endless ? run.endlessWaves * 10 : 0);
    const embers = Math.max(0, total - (paid?.embers ?? 0));    d.embers += embers;
    d.totalEmbers += embers;
    if (won && !paid) {
      d.wins++;
      d.heatUnlocked = true;
      d.maxHeat = Math.max(d.maxHeat, Math.min(10, run.heat + 1));
      this.challenge('win');
      if (w.player.hullDamageTaken <= 0) this.challenge('nohull');
      if (run.heat >= 5) this.challenge('heat5');
    }
    if (run.daily) {
      this.challenge('daily');
      const key = run.seed;
      const score = this.score();
      d.dailyBest[key] = Math.max(d.dailyBest[key] ?? 0, score);
    }
    if (w.stats.kills >= 1000) this.challenge('kills1000');
    if (w.stats.maxFlareKills >= 200 || w.stats.flareKills >= 200) this.challenge('flare200');
    if (w.stats.maxChain >= 20) this.challenge('chain20');
    if (w.player.lightTotal >= 2000) this.challenge('light2000');
    if (run.endlessWaves >= 10) this.challenge('endless10');
    if (w.stats.sectorGrazes >= 100) this.challenge('graze100');
    const rec: RunRecord = {
      seed: run.seed, date: Date.now(), hull: run.hull, sector: run.sector + 1, won, kills: w.stats.kills, light: Math.round(w.player.lightTotal),
      embers, heat: run.heat, daily: run.daily, cause: w.player.deathCause || (won ? 'Victory' : 'Abandoned'),
      weapons: w.build.weapons.map((x) => x.name), upgrades: [...w.build.upgrades.keys()], score: this.score(),
      timeSec: Math.round((performance.now() - run.startTime) / 1000),
    };
    if (paid) {
      // endless continuation: update the run's existing record instead of adding one
      Object.assign(paid.record, rec, { embers: paid.embers + embers, won: true });
    } else d.history.unshift(rec);
    run.paid = { embers: (paid?.embers ?? 0) + embers, record: paid?.record ?? rec };
    d.history = d.history.slice(0, 30);
    d.hearthLevel = Object.values(d.unlocks).reduce((a, b) => a + b, 0) + d.wins * 2;
    this.lastRecord = rec;
    this.save.save();
  }

  score(): number {
    const w = this.world!;
    const run = this.run!;
    return Math.round(w.stats.kills * 10 + w.player.lightTotal * 2 + run.sector * 2000 + w.stats.bossKills * 3000 + (run.won ? 10000 : 0) + run.endlessWaves * 1500) * (1 + run.heat * 0.1);
  }

  challenge(id: string): void {
    const d = this.save.data;
    if (d.challenges.includes(id)) return;
    const c = CHALLENGES.find((x) => x.id === id);
    if (!c) return;
    d.challenges.push(id);
    d.embers += c.reward;
    d.totalEmbers += c.reward;
    this.juice.toast(`CHALLENGE: ${c.name.toUpperCase()} +${c.reward}`, '#ffd27a');
    this.save.save();
  }

  startEndless(): void {
    const run = this.run!;
    run.endless = true;
    this.doWarp('binary', () => {
      this.buildBackdrop('binary', 99);
      this.startEncounter('endless', Math.floor(run.rng.next() * 1e9));
    });
  }

  abandonRun(): void {
    if (!this.run || !this.world) return this.goTitle();
    this.world.player.deathCause = 'Abandoned';
    this.finishRun(false);
    this.goHearth();
  }

  buyUnlock(id: string): void {
    const d = this.save.data;
    const u = HEARTH_UNLOCKS.find((x) => x.id === id);
    const lvl = this.save.unlockLevel(id);
    if (!u || lvl >= (u.max ?? 1)) return;
    const cost = u.cost * (lvl + 1);
    if (d.embers < cost) return void this.audio.play('uiDeny');
    d.embers -= cost;
    d.unlocks[id] = lvl + 1;
    if (u.kind === 'cosmetic') {
      if (id.startsWith('c_trail')) d.equippedCosmetics.trail = id;
      if (id.startsWith('c_death')) d.equippedCosmetics.death = id;
      if (id.startsWith('c_paint')) d.equippedCosmetics.paint = id;
    }
    d.hearthLevel = Object.values(d.unlocks).reduce((a, b) => a + b, 0) + d.wins * 2;
    this.audio.play('uiBuy');
    this.save.save();
    S.showHearth(this, true);
  }

  buyHull(id: string): void {
    const d = this.save.data;
    const h = HULL_BY_ID[id];
    if (!h) return;
    if (d.hulls.includes(id)) {
      this.selectedHull = id;
      this.audio.play('uiSelect');
    } else {
      if (d.embers < h.cost) return void this.audio.play('uiDeny');
      d.embers -= h.cost;
      d.hulls.push(id);
      this.selectedHull = id;
      this.audio.play('uiBuy');
      if (d.hulls.length >= HULLS.length) this.challenge('allhulls');
      this.save.save();
    }
    S.showHearth(this, true);
  }

  buyWeapon(id: string): void {
    const d = this.save.data;
    const def = WEAPON_BY_ID[id];
    if (!def || d.weapons.includes(id)) return;
    const cost = def.unlock ?? 50;
    if (d.embers < cost) return void this.audio.play('uiDeny');
    d.embers -= cost;
    d.weapons.push(id);
    this.audio.play('uiBuy');
    this.save.save();
    S.showHearth(this, true);
  }

  // ------------------------------------------------------------ warp

  doWarp(palette: string, then: () => void): void {
    const prev = this.state;
    this.warp = { t: 0, dur: 2.4, then, switched: false, palette };
    this.setState('warp');
    this.ui.clear();
    this.audio.play('warpCharge', 0, 0.9);
    this.audio.setMusicFilter(500);
    void prev;
  }

  private updateWarp(dt: number): void {
    const wp = this.warp!;
    wp.t += dt;
    const k = wp.t / wp.dur;
    const st = this.settings;
    const motion = st.reducedMotion ? 0.4 : 1;
    if (k < 0.75) {
      this.pipe.fx.warp = Math.pow(k / 0.75, 2) * motion;
      this.juice.breath = k * 0.6;
      // stretching stars rushing past
      this.spawnSpeedLines(Math.round(30 * k), 2 + k * 6);
    } else if (!wp.switched) {
      wp.switched = true;
      this.juice.flash = 1;
      this.audio.play('warpGo', 0, 1);
      this.pipe.setPalette(paletteById(wp.palette), 1.4);
      this.warp = null;
      wp.then();
      this.warp = wp;
      if (this.state === 'warp') this.state = this.prevState;
    }
    if (wp.switched) {
      const a = (k - 0.75) / 0.25;
      this.pipe.fx.warp = Math.max(0, 1 - a) * 0.8 * motion;
      if (a >= 1) {
        this.pipe.fx.warp = 0;
        this.warp = null;
        this.audio.setMusicFilter(18000);
        this.audio.play('warpArrive', 0, 0.8);
        if (this.world && this.state === 'combat') {
          const p = this.world.player.pos;
          this.juice.explosionFx(p.x, p.y, p.z - 10, 6, 0.8, 0.9, 1, 'none', 1.5);
        }
      }
    }
  }

  private spawnSpeedLines(n: number, len: number): void {
    const cam = this.view.camera;
    _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    for (let i = 0; i < n; i++) {
      _w.set(fxRng.next() - 0.5, fxRng.next() - 0.5, 0).normalize().multiplyScalar(4 + fxRng.next() * 14);
      _w.z = -20 - fxRng.next() * 40;
      _w.applyQuaternion(cam.quaternion).add(cam.position);
      // vector speed lines (style C star streaks), crisp at native res
      this.view.addSpark(_w.x, _w.y, _w.z, -_v.x * 160 * len, -_v.y * 160 * len, -_v.z * 160 * len, 0.22, 0.04, 0.55, 0.9, 1, 0);
    }
  }

  // ------------------------------------------------------------ loop

  private gatherControls(frameDt: number): void {
    const inp = this.input;
    const s = this.settings;
    const c = this.controls;
    const m = { x: 0, y: 0, z: 0 };
    inp.moveAxes(m);
    c.mx = m.x;
    c.my = m.y;
    c.mz = m.z;
    c.fire1 = inp.held('fire1') || inp.padRX * 0 !== 0;
    c.fire2 = inp.held('fire2');
    c.boost = inp.held('boost');
    if (inp.pressed('dodge')) c.dodge = true;
    if (inp.pressed('ability1')) c.ability1 = true;
    if (inp.pressed('ability2')) c.ability2 = true;
    if (inp.pressed('flare')) c.flare = true;
    c.autoLevel = s.autoLevel;
    const sens = s.sensitivity;
    const inv = s.invertY ? -1 : 1;
    let yaw = 0;
    let pitch = 0;
    if (inp.locked) {
      yaw += inp.mouseDX * 0.0024 * sens;
      pitch += inp.mouseDY * 0.0024 * sens * inv;
    } else if (this.state === 'combat' && document.hasFocus()) {
      // virtual joystick when the pointer is not locked
      const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
      yaw += dz(inp.mouseNX) * 2.4 * frameDt * sens;
      pitch += dz(inp.mouseNY) * 1.9 * frameDt * sens * inv;
    }
    yaw += inp.padRX * 2.6 * frameDt * sens;
    pitch += inp.padRY * 2.0 * frameDt * sens * inv;
    if (this.autopilot && this.world && this.state === 'combat') {
      const w = this.world;
      const pl = w.player;
      let t = w.nearestEnemy(pl.pos.x, pl.pos.y, pl.pos.z, 300);
      const beacon = this.director?.beacons.find((b) => !b.lit);
      if (beacon && (!t || t.pos.distanceTo(pl.pos) > 35)) t = { pos: beacon.pos, vel: new THREE.Vector3() } as unknown as typeof t;
      if (t) {
        const lead = t.pos.distanceTo(pl.pos) / Math.max(150, w.build.primary.params.speed);
        _v.copy(t.pos).addScaledVector(t.vel, lead).sub(pl.pos).applyQuaternion(_q.copy(pl.quat).invert()).normalize();
        const dist = t.pos.distanceTo(pl.pos);
        c.mz = beacon && t.pos === beacon.pos ? (dist > 6 ? 1 : 0) : dist > 60 ? 1 : dist < 25 ? -0.6 : 0.2;
        c.mx = Math.sin(this.time * 0.7) * 0.6;
        if (inp.pressed('dodge') || Math.random() < frameDt * 0.5) c.dodge = true;
        yaw += clamp(Math.atan2(_v.x, -_v.z) * 14, -4, 4) * frameDt;
        pitch += clamp(-Math.atan2(_v.y, -_v.z) * 14, -4, 4) * frameDt;
      }
    }
    yaw += inp.syntheticAimX * frameDt;
    pitch += inp.syntheticAimY * frameDt;
    this.pendingYaw += yaw;
    this.pendingPitch += pitch;
    aim.strength = inp.lastDevice === 'pad' ? Math.min(1, s.aimAssist + 0.35) : s.aimAssist;
    aim.cone = inp.lastDevice === 'pad' ? 0.17 : 0.1;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.state === 'combat' && this.world) {
      this.controls.yaw = this.pendingYaw;
      this.controls.pitch = this.pendingPitch;
      this.pendingYaw = 0;
      this.pendingPitch = 0;
      this.updateCombat(dt);
      this.controls.dodge = this.controls.ability1 = this.controls.ability2 = this.controls.flare = false;
      this.updateHints();
    }
  }

  private updateHints(): void {
    if (this.hintStep >= 99 || !this.world) {
      this.hints = null;
      return;
    }
    const w = this.world;
    const c = this.controls;
    const steps: [string, () => boolean][] = [
      ['Move with <span class="kbd">W A S D</span> · steer with the <span class="kbd">mouse</span> (click to lock)', () => Math.abs(c.mx) + Math.abs(c.mz) > 0 && w.time > 1.5],
      ['Fire with <span class="kbd">LMB</span>', () => w.build.primary.shots > 12],
      ['Light motes are your fuel. Fly close to collect them', () => w.player.lightTotal > 6],
      ['<span class="kbd">SPACE</span> boosts · <span class="kbd">SHIFT</span> dodges through bullets', () => this.hintDone.has('dodge') || w.player.dodgeCharges < w.build.ship.dodges],
      ['<span class="kbd">RMB</span> fires your secondary · <span class="kbd">Q</span> shockwave · <span class="kbd">E</span> stasis', () => w.build.secondary.shots > 1 || w.player.shockCd > 0],
      ['Lumen full: press <span class="kbd">F</span> to FLARE', () => w.player.flareT > 0 || w.player.lumen < 100],
    ];
    while (this.hintStep < steps.length && steps[this.hintStep]![1]()) this.hintStep++;
    if (this.hintStep === 5 && w.player.lumen < 100) {
      this.hints = null;
      return;
    }
    this.hints = this.hintStep < steps.length ? steps[this.hintStep]![0] : null;
  }

  render(alpha: number, frameDt: number): void {
    this.input.poll();
    const inMenu = this.state !== 'combat' && this.state !== 'warp';
    this.gatherControls(frameDt);
    if (this.input.pressed('pause') && this.state === 'combat') this.pause();
    else if (inMenu) this.ui.update(frameDt);
    if (this.state === 'combat') {
      if (this.input.pressed('camera')) {
        this.camMode = this.camMode === 'chase' ? 'cockpit' : 'chase';
        this.settings.cockpit = this.camMode === 'cockpit';
      }
      if (this.input.pressed('map')) this.hud.toggleMiniMap();
    }
    if (this.state === 'death' && (this.input.keyPressed('KeyR') || this.input.keyPressed('Enter') || this.input.padButtonPressed(3))) {
      const r = this.run;
      this.startRun({ hull: r?.hull, heat: r?.heat, daily: false });
    }
    if (this.warp) this.updateWarp(frameDt);
    // time scale: assist speed slider, flare/death slow-mo
    const slow = this.juice.slowmo > 0 ? 0.3 : 1;
    this.loop.timeScale = this.settings.gameSpeed * slow * (this.state === 'combat' ? 1 : 1);
    if (this.state !== 'combat' && this.state !== 'warp' && this.world) this.loop.timeScale = 0;

    // During a run the camera only ever exists in 3rd or 1st person on the ship.
    // (Previously every in-run screen except combat/pause/death — draft, shop,
    // event, forge, rest, victory, warps out of them — fell through to the title
    // screen's free-drifting camera parked at a fixed spot in the arena.)
    // The sector map is the one exception: it is a star-chart screen.
    const mapView = this.state === 'map' || (this.state === 'warp' && this.prevState === 'map');
    const w = this.run && this.world && !mapView ? this.world : null;
    // fx state
    this.updatePostFx(frameDt);
    this.juice.frame(frameDt, this.state === 'combat' ? w : null);
    this.view.particles.now += frameDt;
    this.view.cockpit = this.camMode === 'cockpit';
    this.updateCamera(w, alpha, frameDt);
    // ambient visuals for non-combat scenes
    if (!w) this.drawScene(frameDt);
    this.view.sync(w, alpha, this.loop.realTime, frameDt);
    if (w) {
      this.audio.boostHold(w.player.boosting && w.player.alive && this.state === 'combat');
      if (w.player.boosting && this.state === 'combat') this.spawnSpeedLines(4, 1.5);
    } else this.audio.boostHold(false);
    this.audio.tick(frameDt);
    this.pipe.lights.update(frameDt, this.view.camera.position, (push) => {
      if (w && w.player.alive) {
        // engine glow sits behind the ship so it rims the hull instead of blowing it out
        const p = w.player.pos;
        _w.set(0, 0, 4).applyQuaternion(w.player.quat).add(p);
        const f = w.player.flareT > 0 ? 2.5 : 1;
        const t = this.view.trailColor;
        push(_w.x, _w.y, _w.z, t.x * 1.4 * f, t.y * 1.4 * f, t.z * 1.4 * f, 9 + w.player.thrust * 5);
      }
    });
    this.pipe.update(frameDt, this.loop.realTime);
    this.view.space.update(this.loop.realTime, this.view.camera.position);
    this.pipe.render(this.view.world, this.view.overlay, this.view.tele, this.view.camera, this.loop.realTime);
    this.hud.frame(frameDt, w);
    this.autoQuality(frameDt);
    this.input.endFrame();
    this.fpsAcc += frameDt;
    this.frameCount++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.frameCount / this.fpsAcc;
      this.fpsAcc = 0;
      this.frameCount = 0;
    }
    if (this.sectorTitle) {
      this.sectorTitle.t -= frameDt;
      if (this.sectorTitle.t <= 0) this.sectorTitle = null;
    }
  }

  private updatePostFx(dt: number): void {
    const fx = this.pipe.fx;
    const run = this.run;
    const w = this.world;
    let hush = 0;
    if (run) {
      const base = [0.12, 0.22, 0.32, 0.42, 0.62][run.sector] ?? 0.3;
      const relightK = clamp(run.sectorLight / 600, 0, 0.5) + (this.relight > 0 ? 1 : 0);
      hush = base * (1 - Math.min(1, relightK));
      if (w?.build.flags.has('hushedEyes')) hush += 0.2;
      if (w?.boss) hush = Math.max(hush, w.boss.hush * (w.boss.dead ? 0 : 1));
      if (this.state === 'map') hush *= 0.6;
    }
    if (this.relight > 0) this.relight = Math.max(0, this.relight - dt * 0.1);
    fx.hush = damp(fx.hush, hush, 2, dt);
    // Ink print (style A) wherever light is absent: menus print on paper, the
    // dead fade to ink, and the Hush drowns the palette.
    const menu = !run && this.state !== 'warp';
    let ink = 0;
    let paper = 0;
    // (no paper-white negative: the user wants style A's accents, not its paper background)
    if (menu) {
      ink = 0;
      paper = 0;
    } else if (this.state === 'death' || (w && !w.player.alive)) ink = 1;
    else ink = clamp((hush - 0.4) / 0.4, 0, 1);
    fx.ink = damp(fx.ink, ink, this.state === 'death' ? 1.4 : 3, dt);
    fx.paper = damp(fx.paper, paper, 3, dt);
    const flare = w && w.player.flareT > 0 ? 1 : 0;
    fx.flare = damp(fx.flare, flare, 6, dt);
    if (this.audio.ctx && this.state === 'combat') {
      const low = this.juice.lowHpMix;
      this.audio.setMusicFilter(flare ? 20000 : low > 0 ? 18000 - low * 16500 : 16000);
    }
    if (this.audio.music && w && this.state === 'combat' && this.director) {
      const live = w.liveEnemyCount();
      this.audio.music.targetIntensity = this.director.kind === 'boss' ? 1 : clamp(0.35 + live / 30 + (flare ? 0.3 : 0), 0.3, 1);
    }
  }

  private updateCamera(w: World | null, alpha: number, dt: number): void {
    const cam = this.view.camera;
    const st = this.settings;
    cam.aspect = this.pipe.outW / this.pipe.outH;
    let fov = st.fov;
    if (w) {
      const pl = w.player;
      _v.lerpVectors(pl.prev, pl.pos, alpha);
      _q.copy(pl.quat); // rotation uses the latest tick: minimal aim latency
      if (pl.boosting) fov += 9;
      fov += this.juice.fovKick;
      if (this.camMode === 'cockpit') {
        _w.set(0, 0.35, -0.6).applyQuaternion(_q).add(_v);
        cam.position.copy(_w);
        cam.quaternion.copy(_q);
        _q.setFromEuler(new THREE.Euler(0, 0, (pl.bank + pl.roll) * 0.3));
        cam.quaternion.multiply(_q);
      } else {
        const back = 12 + (pl.boosting ? 3 : 0);
        _w.set(0, 3.3, back).applyQuaternion(_q).add(_v);
        const k = 1 - Math.exp(-dt * 16);
        this.camPos.lerp(_w, k);
        // never lag more than a few units: keeps aim and ship tightly coupled
        if (this.camPos.distanceTo(_w) > 6) this.camPos.copy(_w).addScaledVector(this.camPos.sub(_w).normalize(), 6);
        cam.position.copy(this.camPos);
        const fwd = _w.set(0, 0, -1).applyQuaternion(_q);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
        const look = _v.clone().addScaledVector(fwd, 40).addScaledVector(up, 2.2);
        _m.lookAt(cam.position, look, up);
        this.camQuat.setFromRotationMatrix(_m);
        cam.quaternion.copy(this.camQuat);
      }
    } else {
      // menus / map: slow cinematic drift
      const t = this.loop.realTime;
      if (this.run) {
        cam.position.set(Math.sin(t * 0.07) * 18, 52 + Math.sin(t * 0.11) * 4, 92);
        cam.lookAt(0, 0, -12);
      } else {
        cam.position.set(Math.sin(t * 0.05) * 20 + 30, 8 + Math.sin(t * 0.08) * 3, 60);
        cam.lookAt(-6, 2, 0);
      }
    }
    cam.fov = damp(cam.fov, fov, 10, dt);
    cam.updateProjectionMatrix();
    this.juice.applyShake(cam, this.loop.realTime);
    cam.updateMatrixWorld();
  }

  /** Map star chart and hearth scenes drawn with particles/streaks (dithered). */
  private drawScene(dt: number): void {
    const P = this.view.particles;
    const t = this.loop.realTime;
    if ((this.state === 'map' || this.state === 'warp' || this.state === 'draft' || this.state === 'shop' || this.state === 'event' || this.state === 'forge' || this.state === 'rest') && this.run) {
      const nodes = this.run.map.nodes;
      const reach = new Set(this.reachable().map((n) => n.id));
      for (const n of nodes) {
        const cur = n.id === this.run.node;
        const k = cur ? 3 : reach.has(n.id) ? 2 + Math.sin(t * 4) * 0.6 : n.visited ? 0.5 : 1;
        const col = n.type === 'boss' ? [3, 1.6, 0.8] : n.type === 'elite' || n.type === 'rift' ? [2.6, 0.9, 0.8] : n.type === 'shop' ? [2.2, 2, 0.8] : [1.4, 1.6, 2.2];
        if (fxRng.next() < 0.6) P.spawn(n.x + (fxRng.next() - 0.5) * 2, n.y + (fxRng.next() - 0.5) * 2, n.z, 0, 0.5, 0, 0.5, col[0]! * k, col[1]! * k, col[2]! * k, n.type === 'boss' ? 14 : 7, 2, 0);
        for (const l of n.links) {
          const m = nodes[l]!;
          const on = (cur && reach.has(m.id)) || (this.run.node < 0 && n.row === 0);
          const kk = on ? 0.9 : n.visited && m.visited ? 0.6 : 0.18;
          this.view.streaks.push(n.x, n.y, n.z, m.x, m.y, m.z, 1.2 * kk, 1.1 * kk, 0.9 * kk, 0.15);
        }
      }
      // the Lantern drifting at the current node
      const cur = this.run.node >= 0 ? nodes[this.run.node]! : null;
      const px = cur ? cur.x : 0;
      const pz = cur ? cur.z + 10 : 56;
      P.spawn(px, 2 + Math.sin(t * 2), pz, 0, 0, 0, 0.3, 3, 3, 2.2, 5, 3, 0);
      void dt;
      return;
    }
    // Hearth: a flickering fire at the heart of the dark, ringed by lanterns that relight with progress
    const lvl = this.save.data.hearthLevel;
    for (let i = 0; i < 8; i++) {
      const a = fxRng.next() * Math.PI * 2;
      const r = fxRng.next() * 3;
      P.spawn(Math.cos(a) * r, Math.sin(a) * r, 0, (fxRng.next() - 0.5) * 3, 2 + fxRng.next() * 4, (fxRng.next() - 0.5) * 3, 0.8 + fxRng.next() * 0.8, 4, 2.2, 0.8, 8, 2, 0.5, -2);
    }
    const lanterns = Math.min(24, 4 + lvl);
    for (let i = 0; i < lanterns; i++) {
      const a = (i / lanterns) * Math.PI * 2 + t * 0.05;
      const lit = i < 3 + lvl;
      if (fxRng.next() < 0.3) P.spawn(Math.cos(a) * 18, Math.sin(a * 3) * 1.5, Math.sin(a) * 18, 0, 0, 0, 0.6, lit ? 3 : 0.4, lit ? 2.2 : 0.4, lit ? 1 : 0.6, 4, 2, 0);
    }
    this.pipe.lights.spawn(0, 0, 0, 30, 18, 8, 40, 0.1);
  }

  private autoQuality(dt: number): void {
    if (this.settings.quality !== 'auto') return;
    this.autoT += dt;
    if (this.autoT < 2) return;
    const ms = this.loop.frameMs;
    if (ms > 19 && this.pipe.resScale > 0.6) {
      this.pipe.resScale = Math.max(0.6, this.pipe.resScale - 0.1);
      this.pipe.rebuildTargets();
      this.autoT = 0;
    } else if (ms < 12 && this.pipe.resScale < 1.4) {
      this.autoT = -3;
      this.pipe.resScale = Math.min(1.4, this.pipe.resScale + 0.1);
      this.pipe.rebuildTargets();
    } else this.autoT = 0;
  }

  /** Test hook: advance the simulation quickly without rendering. */
  simulate(seconds: number): void {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n; i++) {
      this.gatherControls(SIM_DT);
      this.update(SIM_DT);
    }
  }

  /** Scripted stress test: 300 enemies, 3000 enemy bullets, particles. */
  stress(): void {
    if (!this.world) this.startRun({ seed: 'STRESS' });
    const go = () => {
      const w = this.world!;
      if (this.state !== 'combat') this.startEncounter('combat', 1);
      this.stressMode = true;
      this.godMode = true;
      for (let i = 0; i < 300; i++) {
        _v.set(fxRng.next() - 0.5, (fxRng.next() - 0.5) * 0.6, fxRng.next() - 0.5).normalize().multiplyScalar(40 + fxRng.next() * 120);
        const ids = ['moteeater', 'scrapper', 'shardling', 'gunship', 'cantor', 'eclipse'];
        w.spawnEnemy(ids[i % ids.length]!, _v.x, _v.y, _v.z);
      }
      for (let i = 0; i < 3000; i++) {
        _v.set(fxRng.next() - 0.5, fxRng.next() - 0.5, fxRng.next() - 0.5).normalize();
        w.spawnEnemyShot(_v.x * 100, _v.y * 100, _v.z * 100, -_v.x * 8, -_v.y * 8, -_v.z * 8, 0, 1 + (i % 2), 0.6, 30);
      }
    };
    if (this.state === 'map') this.startEncounter('combat', 1);
    setTimeout(go, 100);
  }
}

export function rarityColor(r: string): string {
  return `var(--c-${r})`;
}
export { cardRarity, cardTitle, PALETTES, SIM_DT };
