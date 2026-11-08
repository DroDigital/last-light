import * as THREE from 'three';
import { AFFIX_BY_ID, RARITY, rankLabel } from '../data/affixes';
import { DROP_INFO } from '../data/drops';
import { subtypeName } from '../data/subtypes';
import { HAZARD_INFO } from '../game/hazards';
import { NODE_INFO, ROOM_TIER, isThreatRoom } from '../game/run';
import type { Game, State } from '../game/game';
import { World } from '../game/world';
import { PILOT_HEX } from '../game/player';
import { PALETTES } from '../data/palettes';
import { fmtInt, clamp } from '../core/math';
import { esc } from './ui';
import type { SfxId } from '../audio/audio';
import { SECTORS } from '../data/world';
import { hudBindingLabel, visibleMapLabels, type MapLabelPosition } from './hud-layout';
import './hud-polish.css';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** In-run HUD: native-resolution DOM + a 2D canvas for world-anchored marks. */
export class Hud {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private el: HTMLElement;
  private refs: Record<string, HTMLElement> = {};
  private perfEl: HTMLElement;
  private debugEl: HTMLElement;
  private lastBank = -1;
  private lastLight = 0;
  private miniMap = false;
  private t = 0;
  private bracketPool: { e: import('../game/entities').Enemy; d: number }[] = [];
  private bracketList: { e: import('../game/entities').Enemy; d: number }[] = [];

  constructor(private g: Game) {
    this.canvas = document.getElementById('hud2d') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.el = g.ui.hudEl;
    this.perfEl = document.createElement('div');
    this.perfEl.className = 'perf';
    this.perfEl.style.display = 'none';
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    this.debugEl.style.display = 'none';
    g.ui.overlayEl.append(this.perfEl, this.debugEl);
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.canvas.style.width = window.innerWidth + 'px';
      this.canvas.style.height = window.innerHeight + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    this.debugEl.addEventListener('input', (e) => this.onDebug(e));
    this.debugEl.addEventListener('change', (e) => this.onDebug(e));
    this.debugEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-dbg]') as HTMLElement | null;
      if (b) this.debugAction(b.dataset.dbg!);
    });
  }

  setMode(s: State): void {
    // the 2D HUD only belongs to flight; menus never show a stale frame of it
    const flight = s === 'combat' || s === 'pause' || s === 'warp';
    this.canvas.style.visibility = flight || s === 'map' ? 'visible' : 'hidden';
    if (!flight) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (s === 'combat' || s === 'pause') this.buildCombatHud();
    else if (s !== 'warp') {
      this.el.innerHTML = '';
      this.refs = {};
    }
  }

  toggleMiniMap(): void {
    this.miniMap = !this.miniMap;
  }

  private buildCombatHud(): void {
    if (this.refs.hull) return;
    const scan = this.g.settings.scanlines ? '<div class="scanlines"></div>' : '';
    this.el.innerHTML = `${scan}<div class="brackets"><i></i><i></i><i></i><i></i></div>
      <div class="tl"><div class="display" data-r="sector" style="font-size:var(--s3)"></div><span class="sigbar" style="width:48px"></span><div class="readout" data-r="enc"></div><div class="readout" data-r="coords" style="margin-top:4px;opacity:.6"></div></div>
      <div class="tc"><div data-r="boss" class="bossbar" style="display:none"><div class="name" data-r="bossname"></div><div class="bar"><b data-r="bossghost"></b><i data-r="bosshp"></i></div><div class="dim" data-r="bossphase"></div></div></div>
      <div class="tr"><div class="lightcount" data-r="light">0</div><div class="readout">LIGHT · KILLS <span data-r="kills">000</span></div><div class="bank" data-r="bank"></div><div class="weapons" data-r="weapons" style="margin-top:10px"></div></div>
      <div class="bl">
        <div class="label"><span>Hull</span><b data-r="hullt"></b></div><div class="bar hull"><b data-r="hullghost"></b><i data-r="hull"></i></div>
        <div class="label"><span>Shield</span><b data-r="shieldt"></b></div><div class="bar shield"><i data-r="shield"></i></div>
        <div class="label"><span>Lumen</span><b data-r="lument"></b></div><div class="lumen" data-r="lumen"><div class="liquid" data-r="lumenl"></div></div>
      </div>
      <div class="br"><div class="label"><span>Boost</span><b></b></div><div class="bar" style="color:#9fd8ff;height:5px"><i data-r="boost"></i></div>
        <div class="abilities">
          <div class="ab" data-r="abdodge"><span class="k" data-r="kdodge">⇧</span><div class="cd" data-r="cddodge"></div><span class="n" data-r="ndodge">DODGE</span></div>
          <div class="ab" data-r="abq"><span class="k" data-r="kq">Q</span><div class="cd" data-r="cdq"></div><span class="n">SHOCK</span></div>
          <div class="ab" data-r="abe"><span class="k" data-r="ke">E</span><div class="cd" data-r="cde"></div><span class="n">STASIS</span></div>
          <div class="ab" data-r="abs"><span class="k" data-r="ks">RMB</span><div class="cd" data-r="cds"></div><span class="n">2ND</span></div>
        </div></div>
      <div class="toasts" data-r="toasts"></div>
      <div data-r="hint"></div>
      <div data-r="engage"></div>
      <div data-r="stitle"></div>`;
    this.refs = {};
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-r]')) this.refs[el.dataset.r!] = el;
  }

  cue(id: SfxId, pan: number): void {
    const important: SfxId[] = ['telegraph', 'enemyBig', 'hurt', 'shieldBreak', 'boss', 'lumenFull'];
    if (!important.includes(id)) return;
    const d = document.createElement('div');
    d.className = 'cue';
    d.textContent = id === 'telegraph' ? '⚠' : id === 'lumenFull' ? '☼' : '◉';
    d.style.left = `${50 + pan * 40}%`;
    this.g.ui.overlayEl.append(d);
    setTimeout(() => d.remove(), 650);
  }

  frame(dt: number, w: World | null): void {
    this.t += dt;
    const g = this.g;
    const c = this.ctx;
    // clear the whole backing store regardless of any transform a draw left behind
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (g.showPerf) this.renderPerf(w);
    this.perfEl.style.display = g.showPerf ? 'block' : 'none';
    this.debugEl.style.display = g.showDebug ? 'block' : 'none';
    // sector title (also on map)
    if (g.state === 'map') this.positionNodeLabels();
    const stEl = document.getElementById('sectortitle');
    if (stEl && g.state !== 'map' && g.state !== 'combat') stEl.remove();
    if (g.sectorTitle && g.sectorTitle.t > 0.5 && (g.state === 'map' || g.state === 'combat')) {
      if (!document.getElementById('sectortitle')) {
        const d = document.createElement('div');
        d.id = 'sectortitle';
        d.className = 'sector-title';
        d.innerHTML = `<div class="n">${esc(g.sectorTitle.name)}</div><div class="s">${esc(g.sectorTitle.sub)}</div>`;
        g.ui.overlayEl.append(d);
        setTimeout(() => d.remove(), 4500);
      }
    }
    if (!w || (g.state !== 'combat' && g.state !== 'pause' && g.state !== 'warp')) return;
    if (!this.refs.hull) this.buildCombatHud();
    this.updateDom(w);
    if (g.state === 'combat') this.draw2d(w);
  }

  private updateDom(w: World): void {
    const r = this.refs;
    const pl = w.player;
    const g = this.g;
    const hf = clamp(pl.hull / pl.maxHull, 0, 1);
    r.hull!.style.width = `${hf * 100}%`;
    r.hullghost!.style.width = `${hf * 100}%`;
    r.hullt!.textContent = `${Math.ceil(pl.hull)} / ${pl.maxHull}`;
    r.shield!.style.width = `${pl.maxShield > 0 ? (pl.shield / pl.maxShield) * 100 : 0}%`;
    r.shieldt!.textContent = `${Math.ceil(pl.shield)} / ${pl.maxShield}`;
    const lum = pl.flareT > 0 ? (pl.flareT / w.build.ship.flareDur) * 100 : pl.lumen;
    r.lumenl!.style.width = `${lum}%`;
    r.lumen!.className = `lumen ${pl.lumen >= 100 ? 'full' : ''} ${pl.flareT > 0 ? 'flare' : ''}`;
    r.lument!.textContent = pl.flareT > 0 ? `FLARE ${pl.flareT.toFixed(1)}s` : pl.lumen >= 100 ? `READY · ${hudBindingLabel(g.input.bindings, 'flare', g.input.lastDevice)}` : `${Math.floor(pl.lumen)}%`;
    const light = Math.floor(pl.light);
    if (light !== this.lastLight) {
      r.light!.textContent = fmtInt(light);
      if (light > this.lastLight) {
        r.light!.classList.remove('bump');
        void r.light!.offsetWidth;
        r.light!.classList.add('bump');
      }
      this.lastLight = light;
    }
    r.boost!.style.width = `${pl.boostEnergy * 100}%`;
    r.kills!.textContent = String(w.stats.kills).padStart(3, '0');
    // banked drafts from drops
    const bk = w.bank;
    const bankKey = bk.shard * 10000 + bk.prism * 100 + bk.cache;
    if (bankKey !== this.lastBank && r.bank) {
      this.lastBank = bankKey;
      r.bank.innerHTML = bankKey
        ? (['shard', 'prism', 'cache'] as const).filter((k) => bk[k] > 0).map((k) => `<span style="--dc:${DROP_INFO[k].color}">${DROP_INFO[k].name} ×${bk[k]}</span>`).join('')
        : '';
    }
    r.coords!.textContent = `[ x ${pl.pos.x.toFixed(1).padStart(6)}  y ${pl.pos.y.toFixed(1).padStart(6)}  z ${pl.pos.z.toFixed(1).padStart(6)} ]  T+${String(Math.floor(w.time / 60)).padStart(2, '0')}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`;
    const s = w.build.ship;
    r.cddodge!.style.height = pl.dodgeCharges >= s.dodges ? '0%' : `${(1 - pl.dodgeRecharge / s.dodgeCd) * 100}%`;
    r.ndodge!.textContent = `DODGE ×${pl.dodgeCharges}`;
    r.kdodge!.textContent = hudBindingLabel(g.input.bindings, 'dodge', g.input.lastDevice);
    r.kq!.textContent = hudBindingLabel(g.input.bindings, 'ability1', g.input.lastDevice);
    r.ke!.textContent = hudBindingLabel(g.input.bindings, 'ability2', g.input.lastDevice);
    r.ks!.textContent = hudBindingLabel(g.input.bindings, 'fire2', g.input.lastDevice);
    r.abdodge!.classList.toggle('ready', pl.dodgeCharges > 0);
    const qcd = 9 * s.abilityCd;
    const ecd = 14 * s.abilityCd;
    r.cdq!.style.height = `${Math.max(0, pl.shockCd / qcd) * 100}%`;
    r.abq!.classList.toggle('ready', pl.shockCd <= 0);
    r.cde!.style.height = `${Math.max(0, pl.stasisCd / ecd) * 100}%`;
    r.abe!.classList.toggle('ready', pl.stasisCd <= 0);
    r.abq!.title = pl.shockCd > 0 ? `Shockwave: ${pl.shockCd.toFixed(1)}s` : 'Shockwave ready';
    r.abe!.title = pl.stasisCd > 0 ? `Stasis: ${pl.stasisCd.toFixed(1)}s` : 'Stasis ready';
    const sw = w.build.secondary;
    const scd = 1 / Math.max(0.01, sw.params.rate);
    r.cds!.style.height = `${Math.max(0, sw.cd / scd) * 100}%`;
    r.abs!.classList.toggle('ready', sw.cd <= 0);
    this.el.classList.toggle('critical', hf < 0.3);
    if (this.t % 0.25 < 0.02 || !r.weapons!.innerHTML) {
      r.weapons!.innerHTML = w.build.weapons.map((x, i) => `${i === 0 ? esc(hudBindingLabel(g.input.bindings, 'fire1', g.input.lastDevice)) : i === 1 ? esc(hudBindingLabel(g.input.bindings, 'fire2', g.input.lastDevice)) : 'SYS'} <b>${esc(x.name)}</b> ${'▮'.repeat(x.level)}${x.evolved ? ' ❂' : ''}`).join('<br>');
      const run = g.run;
      if (run) {
        r.sector!.textContent = run.endless ? 'SECTOR ∞ — BEYOND' : `SECTOR ${String(run.sector + 1).padStart(2, '0')} — ${SECTORS[run.sector]!.name.replace(/^[IVX]+ · /, '')}`;
        const dir = g.director;
        r.enc!.textContent = dir ? (dir.kind === 'derelict' ? `Relight the beacons · ${dir.beacons.filter((b) => b.lit).length}/3` : dir.kind === 'endless' ? `Wave ${dir.endlessWave + 1}` : `${dir.kind.toUpperCase()} · ${w.liveEnemyCount()} hostiles${dir.hazard ? ' · ' + HAZARD_INFO[dir.hazard.kind].name.toUpperCase() : ''}`) : '';
      }
    }
    // boss
    const boss = w.boss;
    if (boss && !boss.dead) {
      r.boss!.style.display = 'block';
      r.bossname!.textContent = boss.name;
      const f = boss.hpFrac();
      r.bosshp!.style.width = `${f * 100}%`;
      r.bossghost!.style.width = `${f * 100}%`;
      r.bossphase!.textContent = boss.dying > 0 ? 'COLLAPSING' : `${boss.def.phases[boss.phase]}${boss.core.invuln ? ' · SHIELDED — destroy its parts' : boss.core.dmgTaken < 0.6 ? ' · ARMORED — break its parts' : ''}`;
    } else r.boss!.style.display = 'none';
    // toasts
    const j = g.juice;
    const key = j.toasts.map((t) => t.text).join('|');
    if (r.toasts!.dataset.k !== key) {
      r.toasts!.dataset.k = key;
      r.toasts!.innerHTML = j.toasts.slice(-3).map((t) => `<div class="toast" style="color:${t.color}">${esc(t.text)}</div>`).join('');
    }
    // the mouse only steers while locked: say so plainly instead of drifting
    const needLock = g.state === 'combat' && !g.input.locked && g.input.lastDevice === 'kbm' && pl.alive;
    const eng = needLock ? 'Click to take control' : '';
    if (r.engage!.dataset.k !== eng) {
      r.engage!.dataset.k = eng;
      r.engage!.innerHTML = eng ? `<div class="engage">${eng}</div>` : '';
    }
    const hint = g.hints ?? '';
    if (r.hint!.dataset.k !== hint) {
      r.hint!.dataset.k = hint;
      r.hint!.innerHTML = hint ? `<div class="hint">${hint}</div>` : '';
    }
    this.el.classList.toggle('glitch', j.damageGlitch > 0.5 && !g.settings.reducedMotion);
    this.el.classList.toggle('cockpit', g.camMode === 'cockpit');
  }

  /** Local co-op overlay: each wingman's plate, an edge arrow when off-screen, the downed banner, the join hint. */
  private drawCoop(w: World, W: number, H: number): void {
    const c = this.ctx;
    const inp = this.g.input;
    c.textAlign = 'center';
    // join hint whenever a spare controller could take a seat
    if (inp.canJoin()) {
      const seat = inp.freeSeat()!;
      c.font = '400 10px "JetBrains Mono"';
      c.fillStyle = PILOT_HEX[seat] + 'b3';
      c.fillText(`P${seat + 1} · PRESS START ON A CONTROLLER TO JOIN`, W / 2, H - 16);
    }
    if (!w.wingmen.length) return;
    for (const p2 of w.wingmen) {
      const col = PILOT_HEX[p2.slot] ?? PILOT_HEX[1];
      const tag = `P${p2.slot + 1}`;
      const p = this.project(p2.pos.x, p2.pos.y, p2.pos.z);
      if (p.on) {
        const bw = 40;
        c.fillStyle = 'rgba(0,0,0,0.6)';
        c.fillRect(p.x - bw / 2, p.y - 30, bw, 4);
        c.fillRect(p.x - bw / 2, p.y - 25, bw, 2);
        c.fillStyle = col;
        c.fillRect(p.x - bw / 2, p.y - 30, bw * clamp(p2.hull / p2.maxHull, 0, 1), 4);
        c.fillStyle = '#9adcf0';
        c.fillRect(p.x - bw / 2, p.y - 25, bw * clamp(p2.shield / Math.max(1, p2.maxShield), 0, 1), 2);
        c.font = '800 10px Archivo';
        c.fillStyle = col;
        c.fillText(p2.alive ? tag : `${tag} · DOWN`, p.x, p.y - 34);
      } else {
        // edge arrow toward the wingman
        let dx = p.x - W / 2;
        let dy = p.y - H / 2;
        if (p.behind) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const r = Math.min(W, H) / 2 - 40;
        const ax = W / 2 + Math.cos(ang) * r;
        const ay = H / 2 + Math.sin(ang) * r;
        c.save();
        c.translate(ax, ay);
        c.rotate(ang);
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(10, 0);
        c.lineTo(-6, -7);
        c.lineTo(-6, 7);
        c.closePath();
        c.fill();
        c.restore();
        c.font = '800 10px Archivo';
        c.fillText(tag, ax, ay - 12);
      }
    }
    // a party roster under the sector readout: everyone's hull (or revive progress) at a glance
    c.textAlign = 'left';
    let y = 122;
    for (const pl of w.players) {
      const col = pl.slot === 0 ? '#f3eee2' : PILOT_HEX[pl.slot] ?? PILOT_HEX[1];
      c.font = '800 10px Archivo';
      c.fillStyle = col;
      c.fillText(`P${pl.slot + 1}`, 26, y + 4);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(48, y - 2, 60, 5);
      c.fillStyle = pl.alive ? col : '#ff6a5a';
      c.fillRect(48, y - 2, 60 * (pl.alive ? clamp(pl.hull / pl.maxHull, 0, 1) : clamp(pl.reviveT / World.REVIVE_TIME, 0, 1)), 5);
      if (!pl.alive) {
        c.font = '400 9px "JetBrains Mono"';
        c.fillText('DOWN', 114, y + 4);
      }
      y += 14;
    }
    c.textAlign = 'center';
    const downed = w.players.filter((p) => !p.alive);
    if (downed.length && w.anyAlive()) {
      const top = downed.reduce((a, b) => (b.reviveT > a.reviveT ? b : a));
      const k = Math.round((top.reviveT / World.REVIVE_TIME) * 100);
      const names = downed.map((p) => `P${p.slot + 1}`).join(' + ');
      c.font = '900 13px Archivo';
      c.fillStyle = Math.floor(this.t * 3) % 2 ? PILOT_HEX[1] : '#f3eee2';
      c.fillText(`${names} DOWN · HOVER CLOSE TO REVIVE${k > 0 ? ` · ${k}%` : ''}`, W / 2, H * 0.3);
    }
  }

  private project(x: number, y: number, z: number): { x: number; y: number; on: boolean; behind: boolean } {
    const cam = this.g.view.camera;
    _v.set(x, y, z).project(cam);
    const behind = _v.z > 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    return { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H, on: !behind && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1, behind };
  }

  private draw2d(w: World): void {
    const c = this.ctx;
    const g = this.g;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const pl = w.player;
    this.drawCoop(w, W, H);
    if (!pl.alive) return;
    // reticle at aim point
    const aimP = _w.copy(pl.pos).addScaledVector(pl.aimDir, pl.aimDist);
    const a = this.project(aimP.x, aimP.y, aimP.z);
    pl.forward(_v);
    const fwdP = this.project(pl.pos.x + _v.x * 90, pl.pos.y + _v.y * 90, pl.pos.z + _v.z * 90);
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(200,255,244,0.9)';
    c.beginPath();
    const rr = 9 + (pl.firingT < 0.1 ? 3 : 0);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      c.moveTo(fwdP.x + Math.cos(ang) * rr, fwdP.y + Math.sin(ang) * rr);
      c.lineTo(fwdP.x + Math.cos(ang) * (rr + 6), fwdP.y + Math.sin(ang) * (rr + 6));
    }
    c.stroke();
    c.fillStyle = 'rgba(200,255,244,0.95)';
    c.fillRect(a.x - 1.5, a.y - 1.5, 3, 3);
    // Swiss target brackets: the aim target plus the nearest few on-screen threats
    // pooled candidate records (this runs every frame over every enemy)
    const brackets = this.bracketList;
    brackets.length = 0;
    for (const e of w.enemies) {
      if (!e.alive || !e.revealed || e.def.role === 'inert' || (e.def.role === 'part' && e.id !== pl.aimTarget)) continue;
      const d = e.id === pl.aimTarget ? -1 : e.pos.distanceToSquared(pl.pos);
      if (d >= 110 * 110) continue;
      const rec = this.bracketPool[brackets.length] ?? (this.bracketPool[brackets.length] = { e, d });
      rec.e = e;
      rec.d = d;
      brackets.push(rec);
    }
    brackets.sort((x, y) => x.d - y.d);
    c.font = '800 11px Archivo';
    c.textAlign = 'left';
    const cockpit = g.camMode === 'cockpit';
    for (let i = 0; i < Math.min(5, brackets.length); i++) {
      const { e } = brackets[i]!;
      const p = this.project(e.pos.x, e.pos.y, e.pos.z);
      if (!p.on) continue;
      const aimed = e.id === pl.aimTarget;
      if (cockpit) {
        // 1st person stays minimal: a lock diamond on the aimed target only
        if (!aimed) continue;
        c.strokeStyle = '#ff4f00';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(p.x, p.y - 11);
        c.lineTo(p.x + 11, p.y);
        c.lineTo(p.x, p.y + 11);
        c.lineTo(p.x - 11, p.y);
        c.closePath();
        c.stroke();
        continue;
      }
      const dist = Math.sqrt(Math.max(1, e.pos.distanceToSquared(pl.pos)));
      const m = clamp((e.radius * e.scale * 260) / dist, 9, 60);
      c.strokeStyle = aimed ? '#ff4f00' : 'rgba(235,232,225,0.75)';
      c.lineWidth = aimed ? 2 : 1.25;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        c.moveTo(p.x + sx * m, p.y + sy * m - sy * 7);
        c.lineTo(p.x + sx * m, p.y + sy * m);
        c.lineTo(p.x + sx * m - sx * 7, p.y + sy * m);
      }
      c.stroke();
      c.fillStyle = aimed ? '#ff4f00' : 'rgba(235,232,225,0.85)';
      if (aimed) {
        const label = `${e.def.name.toUpperCase()} · ${Math.round(dist)}M`;
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(5,4,9,.9)';
        c.strokeText(label, p.x + m + 5, p.y - m + 9);
        c.fillText(label, p.x + m + 5, p.y - m + 9);
      }
    }
    // kill confirmations: DESTROYED / 042 with a signal rule
    for (const k of g.juice.killTags) {
      const p = this.project(k.x, k.y, k.z);
      if (!p.on) continue;
      const a = Math.max(0, 1 - k.t / 1.4);
      const y = p.y - 26 - k.t * 16;
      c.globalAlpha = a;
      c.fillStyle = '#ebe8e1';
      c.font = '900 13px Archivo';
      c.fillText(`DESTROYED / ${String(k.n).padStart(3, '0')}`, p.x + 26, y);
      c.fillStyle = '#ff4f00';
      c.fillRect(p.x + 26, y + 4, 110 * Math.min(1, k.t * 6), 3);
      c.font = '400 10px "JetBrains Mono"';
      c.fillStyle = '#ebe8e1';
      c.fillText(k.label.toUpperCase(), p.x + 26, y + 18);
      c.globalAlpha = 1;
    }
    // threat indicators: off-screen enemies at the screen edge
    const cx = W / 2;
    const cy = H / 2;
    const margin = 36;
    let drawn = 0;
    for (const e of w.enemies) {
      if (!e.alive || !e.revealed || e.def.role === 'inert' || e.def.role === 'part') continue;
      const d2 = e.pos.distanceToSquared(pl.pos);
      const boss = e.def.role === 'boss';
      if (d2 > 160 * 160 && !boss && !e.elite) continue;
      const p = this.project(e.pos.x, e.pos.y, e.pos.z);
      // elite / boss health bar
      if (p.on && (e.elite || (e.hp < e.maxHp && e.maxHp > 80 && !boss))) {
        const bw = 36;
        c.fillStyle = 'rgba(0,0,0,0.6)';
        c.fillRect(p.x - bw / 2, p.y - 26, bw, 4);
        const rc = e.rarity > 0 ? RARITY[e.rarity].color : '#ff8a6a';
        c.fillStyle = rc;
        c.fillRect(p.x - bw / 2, p.y - 26, bw * clamp(e.hp / e.maxHp, 0, 1), 4);
        if (e.rarity > 0) {
          c.textAlign = 'center';
          c.font = '800 10px Archivo';
          c.fillStyle = rc;
          c.fillText(e.rarity === 3 ? e.rankName.toUpperCase() : `${RARITY[e.rarity].name.toUpperCase()} ${e.def.name.toUpperCase()}${e.subtype >= 0 ? ' · ' + subtypeName(e.def.id, e.subtype).toUpperCase() : ''}`, p.x, p.y - 42);
          if (e.rarity < 3 || e.affixes.length) {
            c.font = '400 9px "JetBrains Mono"';
            c.fillStyle = 'rgba(243,238,226,0.8)';
            c.fillText(e.affixes.map((a) => AFFIX_BY_ID[a].name).join(' · '), p.x, p.y - 30);
          }
        }
      }
      if (p.on || drawn > 24) continue;
      let dx = p.x - cx;
      let dy = p.y - cy;
      if (p.behind) {
        dx = -dx;
        dy = -dy;
      }
      const ang = Math.atan2(dy, dx);
      const sx = (W / 2 - margin) / Math.max(0.001, Math.abs(Math.cos(ang)));
      const sy = (H / 2 - margin) / Math.max(0.001, Math.abs(Math.sin(ang)));
      const s = Math.min(sx, sy);
      const ex = cx + Math.cos(ang) * s;
      const ey = cy + Math.sin(ang) * s;
      const near = clamp(1 - Math.sqrt(d2) / 160, 0.25, 1);
      const charging = e.state === 1 || e.emissive > 0.6;
      c.fillStyle = boss ? 'rgba(255,120,80,0.95)' : charging ? `rgba(255,74,46,${0.6 + near * 0.4})` : `rgba(255,190,150,${near * 0.7})`;
      c.save();
      c.translate(ex, ey);
      c.rotate(ang);
      const sz = boss ? 14 : 6 + near * 5;
      c.beginPath();
      c.moveTo(sz, 0);
      c.lineTo(-sz * 0.6, sz * 0.7);
      c.lineTo(-sz * 0.6, -sz * 0.7);
      c.closePath();
      c.fill();
      c.restore();
      drawn++;
    }
    // incoming shots from behind: red edge flicker
    let behindShots = 0;
    const ep = w.eproj;
    pl.forward(_v);
    for (let i = 0; i < ep.n; i += 2) {
      const dx = ep.x[i]! - pl.pos.x;
      const dy = ep.y[i]! - pl.pos.y;
      const dz = ep.z[i]! - pl.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 900 && dx * _v.x + dy * _v.y + dz * _v.z < 0) behindShots++;
    }
    if (behindShots > 0) {
      const grd = c.createLinearGradient(0, H, 0, H - 80);
      grd.addColorStop(0, `rgba(255,60,30,${Math.min(0.35, behindShots * 0.05)})`);
      grd.addColorStop(1, 'rgba(255,60,30,0)');
      c.fillStyle = grd;
      c.fillRect(0, H - 80, W, 80);
    }
    // damage numbers with pop and drift
    if (g.settings.damageNumbers) {
      c.textAlign = 'center';
      for (const n of g.juice.numbers) {
        const p = this.project(n.x, n.y, n.z);
        if (!p.on) continue;
        const k = n.t / 0.8;
        const pop = n.t < 0.08 ? 1 + (0.08 - n.t) * 8 : 1;
        const label = (n as unknown as { label?: string }).label;
        const size = (label ? 15 : n.crit ? 17 : 12) * pop;
        c.font = `600 ${size}px Archivo`;
        c.fillStyle = label ? `rgba(255,154,208,${1 - k})` : n.crit ? `rgba(255,236,150,${1 - k})` : `rgba(255,255,255,${0.85 - k * 0.85})`;
        c.fillText(label ?? String(n.v), p.x + n.vx * n.t, p.y + n.vy * n.t + 40 * n.t * n.t);
      }
    }
    // derelict beacon labels + off-screen guides
    const dir = g.director;
    if (dir?.beacons.length) {
      for (const b of dir.beacons) {
        const p = this.project(b.pos.x, b.pos.y, b.pos.z);
        if (!p.on) {
          if (b.lit) continue;
          let dx = p.x - cx;
          let dy = p.y - cy;
          if (p.behind) {
            dx = -dx;
            dy = -dy;
          }
          const ang = Math.atan2(dy, dx);
          const s = Math.min((W / 2 - margin) / Math.max(0.001, Math.abs(Math.cos(ang))), (H / 2 - margin) / Math.max(0.001, Math.abs(Math.sin(ang))));
          c.save();
          c.translate(cx + Math.cos(ang) * s, cy + Math.sin(ang) * s);
          c.rotate(ang);
          c.fillStyle = 'rgba(166,200,255,0.95)';
          c.beginPath();
          c.moveTo(12, 0);
          c.lineTo(-6, 8);
          c.lineTo(-2, 0);
          c.lineTo(-6, -8);
          c.closePath();
          c.fill();
          c.restore();
          continue;
        }
        c.font = '600 11px Archivo';
        c.fillStyle = b.lit ? '#fff2b8' : '#a6c8ff';
        c.fillText(b.lit ? 'RELIT' : `BEACON ${Math.round(b.progress * 100)}%`, p.x, p.y - 22);
      }
    }
    if (g.camMode === 'cockpit') this.drawCockpit(w, W, H, fwdP.x, fwdP.y);
    // mini map (Tab): top-down radar
    if (this.miniMap) {
      const R = 90;
      const ox = W - R - 30;
      const oy = H / 2;
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.beginPath();
      c.arc(ox, oy, R, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,240,200,0.3)';
      c.stroke();
      pl.forward(_v);
      const yaw = Math.atan2(_v.x, -_v.z);
      for (const e of w.enemies) {
        if (!e.alive) continue;
        const dx = e.pos.x - pl.pos.x;
        const dz = e.pos.z - pl.pos.z;
        const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
        const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
        const sx = ox + (rx / 200) * R;
        const sy = oy + (rz / 200) * R;
        if (Math.hypot(sx - ox, sy - oy) > R) continue;
        c.fillStyle = e.def.role === 'inert' ? 'rgba(160,140,120,0.5)' : e.def.role === 'boss' ? '#ff7050' : '#ffb080';
        c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
      c.fillStyle = '#c8fff4';
      c.fillRect(ox - 2, oy - 2, 4, 4);
    }
  }

  /**
   * 1st-person instrument cluster: minimal, technical, centered on the reticle.
   * Left arcs = hull (outer) + shield (inner); right arcs = Lumen (outer) + boost
   * (inner); heading tape above; roll/pitch horizon bars; flight-path marker;
   * systems readout below; target readout beside the right arcs.
   */
  private drawCockpit(w: World, W: number, H: number, cx: number, cy: number): void {
    const c = this.ctx;
    const pl = w.player;
    const s = w.build.ship;
    const t = this.t;
    const PAPER = 'rgba(235,232,225,0.88)';
    const DIM = 'rgba(235,232,225,0.22)';
    const SIG = '#ff4f00';
    const R = Math.min(W, H) * 0.19;
    const deg = Math.PI / 180;
    c.save();
    c.lineCap = 'butt';
    c.textBaseline = 'middle';

    // --- arc gauges: each spans 70 degrees, filling from the bottom up
    const arc = (side: -1 | 1, r: number, frac: number, color: string, width: number) => {
      const mid = side < 0 ? Math.PI : 0;
      const a0 = mid + side * -35 * deg; // bottom end
      const a1 = mid + side * 35 * deg; // top end
      // track
      c.strokeStyle = DIM;
      c.lineWidth = width;
      c.beginPath();
      c.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1));
      c.stroke();
      // ticks every 10%
      c.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const a = a0 + (a1 - a0) * (i / 10);
        const k = i % 5 === 0 ? 7 : 4;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * (r + width / 2 + 2), cy + Math.sin(a) * (r + width / 2 + 2));
        c.lineTo(cx + Math.cos(a) * (r + width / 2 + 2 + k), cy + Math.sin(a) * (r + width / 2 + 2 + k));
        c.stroke();
      }
      // value
      const f = clamp(frac, 0, 1);
      if (f > 0.001) {
        c.strokeStyle = color;
        c.lineWidth = width;
        c.beginPath();
        const end = a0 + (a1 - a0) * f;
        c.arc(cx, cy, r, Math.min(a0, end), Math.max(a0, end));
        c.stroke();
      }
    };
    const hullF = pl.hull / pl.maxHull;
    const critical = hullF < 0.3;
    const blink = Math.floor(t * 4) % 2 === 0;
    arc(-1, R, hullF, critical && blink ? SIG : PAPER, 3);
    arc(-1, R - 9, pl.maxShield > 0 ? pl.shield / pl.maxShield : 0, '#8fe3ff', 2);
    const flare = pl.flareT > 0;
    const lum = flare ? pl.flareT / s.flareDur : pl.lumen / 100;
    arc(1, R, lum, flare ? '#ffffff' : pl.lumen >= 100 ? (blink ? SIG : '#ffd27a') : '#ffd27a', 3);
    arc(1, R - 9, pl.boostEnergy, '#9fd8ff', 2);

    // arc labels (mono, tabular)
    c.font = '700 10px "JetBrains Mono"';
    const lx = cx - R * Math.cos(35 * deg);
    const ly = cy + R * Math.sin(35 * deg) + 16;
    const rx = cx + R * Math.cos(35 * deg);
    c.textAlign = 'right';
    c.fillStyle = critical ? SIG : PAPER;
    c.fillText(`HULL ${String(Math.ceil(pl.hull)).padStart(3, '0')}`, lx, ly);
    c.fillStyle = '#8fe3ff';
    c.fillText(`SHD ${String(Math.ceil(pl.shield)).padStart(3, '0')}`, lx, ly + 13);
    c.textAlign = 'left';
    c.fillStyle = pl.lumen >= 100 && !flare ? SIG : '#ffd27a';
    c.fillText(flare ? `FLARE ${pl.flareT.toFixed(1)}S` : pl.lumen >= 100 ? 'LUM RDY · F' : `LUM ${String(Math.floor(pl.lumen)).padStart(3, '0')}%`, rx, ly);
    c.fillStyle = '#9fd8ff';
    c.fillText(`BST ${String(Math.round(pl.boostEnergy * 100)).padStart(3, '0')}%`, rx, ly + 13);

    // --- roll / pitch horizon bars outside the arcs
    pl.forward(_v);
    pl.right(_w);
    const roll = Math.asin(clamp(_w.y, -1, 1));
    const pitch = Math.asin(clamp(_v.y, -1, 1));
    const off = clamp(pitch / (40 * deg), -1, 1) * R * 0.6;
    c.strokeStyle = PAPER;
    c.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      const r0 = R + 26;
      const r1 = R + 62;
      const ca = Math.cos(roll);
      const sa = Math.sin(roll);
      const ox = side * r0;
      const ox2 = side * r1;
      const y0 = off;
      c.beginPath();
      c.moveTo(cx + ox * ca - y0 * sa, cy + ox * sa + y0 * ca);
      c.lineTo(cx + ox2 * ca - y0 * sa, cy + ox2 * sa + y0 * ca);
      // end tick pointing toward the sky
      c.lineTo(cx + ox2 * ca - (y0 + 6) * sa, cy + ox2 * sa + (y0 + 6) * ca);
      c.stroke();
    }
    c.font = '400 10px "JetBrains Mono"';
    c.fillStyle = PAPER;
    c.textAlign = 'left';
    c.fillText(`PIT ${pitch >= 0 ? '+' : '-'}${String(Math.abs(Math.round(pitch / deg))).padStart(2, '0')}°`, cx + R + 26, cy + off - 12);
    c.textAlign = 'right';
    c.fillText(`ROL ${roll >= 0 ? '+' : '-'}${String(Math.abs(Math.round(roll / deg))).padStart(2, '0')}°`, cx - R - 26, cy + off - 12);

    // --- heading tape
    const hdg = ((Math.atan2(_v.x, -_v.z) / deg) % 360 + 360) % 360;
    const tapeY = cy - R - 46;
    const tapeW = R * 1.6;
    const span = 60;
    c.strokeStyle = PAPER;
    c.fillStyle = PAPER;
    c.lineWidth = 1;
    c.textAlign = 'center';
    c.font = '400 9px "JetBrains Mono"';
    for (let d = Math.ceil((hdg - span / 2) / 5) * 5; d <= hdg + span / 2; d += 5) {
      const x = cx + ((d - hdg) / span) * tapeW;
      const major = ((d % 30) + 30) % 30 === 0;
      c.globalAlpha = 1 - Math.abs(d - hdg) / (span / 2) * 0.8;
      c.beginPath();
      c.moveTo(x, tapeY);
      c.lineTo(x, tapeY + (major ? 8 : 4));
      c.stroke();
      if (major) c.fillText(String(((d % 360) + 360) % 360).padStart(3, '0'), x, tapeY - 7);
    }
    c.globalAlpha = 1;
    c.fillStyle = SIG;
    c.beginPath();
    c.moveTo(cx, tapeY + 10);
    c.lineTo(cx - 5, tapeY + 17);
    c.lineTo(cx + 5, tapeY + 17);
    c.closePath();
    c.fill();
    c.font = '700 11px "JetBrains Mono"';
    c.fillStyle = PAPER;
    c.fillText(`HDG ${String(Math.round(hdg) % 360).padStart(3, '0')}`, cx, tapeY + 29);

    // --- flight-path marker (where the ship is actually going)
    const spd = pl.vel.length();
    if (spd > 4) {
      const p = this.project(pl.pos.x + pl.vel.x * 2, pl.pos.y + pl.vel.y * 2, pl.pos.z + pl.vel.z * 2);
      if (p.on) {
        c.strokeStyle = '#8fe3ff';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(p.x, p.y, 5, 0, Math.PI * 2);
        c.moveTo(p.x - 5, p.y);
        c.lineTo(p.x - 13, p.y);
        c.moveTo(p.x + 5, p.y);
        c.lineTo(p.x + 13, p.y);
        c.moveTo(p.x, p.y - 5);
        c.lineTo(p.x, p.y - 10);
        c.stroke();
      }
    }

    // --- systems readout
    const ab = (label: string, cd: number) => (cd <= 0 ? `${label} RDY` : `${label} ${cd.toFixed(1).padStart(4, '0')}`);
    const sw = w.build.secondary;
    const items: [string, boolean][] = [
      [`SPD ${String(Math.round(spd)).padStart(3, '0')}`, true],
      [`DGE ${'■'.repeat(pl.dodgeCharges)}${'□'.repeat(Math.max(0, s.dodges - pl.dodgeCharges))}`, pl.dodgeCharges > 0],
      [ab('Q', pl.shockCd), pl.shockCd <= 0],
      [ab('E', pl.stasisCd), pl.stasisCd <= 0],
      [ab('RMB', sw.cd), sw.cd <= 0],
    ];
    c.font = '700 11px "JetBrains Mono"';
    c.textAlign = 'left';
    const gap = 18;
    const widths = items.map(([txt]) => c.measureText(txt).width);
    let x = cx - (widths.reduce((a2, b2) => a2 + b2, 0) + gap * (items.length - 1)) / 2;
    const by = cy + R + 44;
    items.forEach(([txt, ready], i) => {
      c.fillStyle = ready ? PAPER : 'rgba(235,232,225,0.35)';
      c.fillText(txt, x, by);
      if (ready && i > 1) {
        c.fillStyle = SIG;
        c.fillRect(x, by + 8, widths[i]!, 2);
      }
      x += widths[i]! + gap;
    });

    // --- target readout
    const tgt = pl.aimTarget >= 0 ? w.enemies.find((e) => e.id === pl.aimTarget) : undefined;
    if (tgt && tgt.alive) {
      const tx = cx + R + 70;
      const ty = cy + 22;
      const dist = Math.round(tgt.pos.distanceTo(pl.pos));
      c.fillStyle = SIG;
      c.fillRect(tx, ty - 9, 2, 40);
      c.fillStyle = PAPER;
      c.font = '900 12px Archivo';
      const stn = subtypeName(tgt.def.id, tgt.subtype);
      c.fillText(tgt.def.name.toUpperCase() + (stn ? ' · ' + stn.toUpperCase() : ''), tx + 8, ty);
      c.font = '400 10px "JetBrains Mono"';
      c.fillText(`TGT-${String(tgt.id % 100).padStart(2, '0')} · ${String(dist).padStart(3, '0')}M${tgt.rarity > 0 ? ' · ' + RARITY[tgt.rarity].name.toUpperCase() : ''}`, tx + 8, ty + 14);
      if (tgt.rarity > 0) {
        c.fillStyle = RARITY[tgt.rarity].color;
        c.fillText(rankLabel(tgt).toUpperCase(), tx + 8, ty + 40);
        c.fillStyle = PAPER;
      }
      const hf = clamp(tgt.hp / tgt.maxHp, 0, 1);
      c.fillStyle = DIM;
      c.fillRect(tx + 8, ty + 24, 90, 3);
      c.fillStyle = PAPER;
      c.fillRect(tx + 8, ty + 24, 90 * hf, 3);
    }
    if (critical) {
      c.font = '900 13px Archivo';
      c.textAlign = 'center';
      c.fillStyle = blink ? SIG : PAPER;
      c.fillText('HULL CRITICAL', cx, cy - R - 82);
    }
    c.restore();
  }

  private positionNodeLabels(): void {
    const run = this.g.run;
    if (!run) return;
    const nextRow = run.node < 0 ? 0 : run.map.nodes[run.node]!.row + 1;
    const entries: { el: HTMLElement; label: MapLabelPosition; behind: boolean }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.node-label[data-node]')) {
      const n = run.map.nodes[Number(el.dataset.node)];
      if (!n) continue;
      const p = this.project(n.x, n.y + 5, n.z);
      const ahead = n.row - nextRow;
      const current = n.id === run.node;
      const eligible = current || (ahead >= 0 && ahead <= 2);
      el.classList.toggle('map-preview', ahead === 1 && !current);
      el.classList.toggle('map-distant', ahead === 2 && !current);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      const priority = el.classList.contains('reach') ? 'reachable' : current ? 'current' : ahead === 1 ? 'preview' : 'distant';
      entries.push({ el, label: { id: n.id, x: p.x, y: p.y, priority }, behind: p.behind || !eligible });
    }
    const visible = visibleMapLabels(entries.filter((entry) => !entry.behind).map((entry) => entry.label));
    for (const entry of entries) entry.el.style.display = !entry.behind && visible.has(entry.label.id) ? 'flex' : 'none';
    const detail = document.getElementById('node-detail');
    const focused = document.querySelector<HTMLElement>('.node-label.reach.focus');
    const node = focused ? run.map.nodes[Number(focused.dataset.node)] : undefined;
    if (detail && detail.dataset.selectedNode !== String(node?.id ?? '')) {
      detail.dataset.selectedNode = String(node?.id ?? '');
      const name = detail.querySelector<HTMLElement>('[data-node-name]');
      const description = detail.querySelector<HTMLElement>('[data-node-description]');
      const rarity = detail.querySelector<HTMLElement>('[data-node-rarity]');
      if (name) name.textContent = node ? NODE_INFO[node.type].name : 'Choose a route';
      if (description) description.textContent = node ? NODE_INFO[node.type].desc : 'Highlight a destination to inspect it.';
      if (rarity) {
        rarity.textContent = node && isThreatRoom(node.type) ? `${node.rarity.toUpperCase()} ENCOUNTER` : '';
        rarity.style.color = node ? ROOM_TIER[node.rarity].color : '';
      }
    }
  }

  private renderPerf(w: World | null): void {
    const g = this.g;
    const p = g.pipe;
    const l = g.loop;
    const lines = [
      `FPS ${g.fps.toFixed(0)}  frame ${l.frameMs.toFixed(1)}ms`,
      `sim ${l.simMs.toFixed(2)}ms  render(cpu) ${l.renderMs.toFixed(2)}ms`,
      `draw calls ${p.drawCalls}  tris ${fmtInt(p.triangles)}`,
      `internal ${p.lowW}×${p.lowH}  out ${p.outW}×${p.outH}  scale ${p.resScale.toFixed(1)}`,
    ];
    if (w) {
      lines.push(
        `enemies ${w.enemies.length}  live ${w.liveEnemyCount()}`,
        `proj ${w.proj.n}  enemy proj ${w.eproj.n}`,
        `particles ~${fmtInt(g.view.particles.liveEstimate())}  motes ${w.motes.n}  debris ${w.debris.n}`,
        `tokens ${w.tokens}/${w.maxTokens}  dps est ${fmtInt(w.build.dpsEstimate())}`,
      );
    }
    this.perfEl.textContent = lines.join('\n');
  }

  renderDebug(): void {
    const look = this.g.pipe.look;
    const s = (k: string, label: string, v: number, min: number, max: number, step: number) =>
      `<div class="setting"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${k}"><span class="v">${v}</span></div>`;
    this.debugEl.innerHTML = `<b>LOOK PANEL (F1)</b>
      ${s('pixelScale', 'pixel scale', look.pixelScale, 1, 6, 1)}
      <div class="setting"><span>dither</span><select data-k="matrix">${['Bayer 4×4', 'Bayer 8×8', 'Interleaved', 'Off'].map((n, i) => `<option value="${i}" ${look.matrix === i ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>
      ${s('spread', 'spread', look.spread, 0, 2, 0.05)}
      ${s('bloom', 'bloom', look.bloom, 0, 3, 0.05)}
      ${s('bloomThreshold', 'bloom thresh', look.bloomThreshold, 0, 3, 0.05)}
      ${s('exposure', 'exposure', look.exposure, 0.2, 3, 0.05)}
      ${s('scanlines', 'scanlines', look.scanlines, 0, 0.5, 0.01)}
      ${s('vignette', 'vignette', look.vignette, 0, 3, 0.05)}
      ${s('skyScale', 'sky dither', look.skyScale, 50, 600, 10)}
      <div class="setting"><span>palette</span><select data-k="palette">${PALETTES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select><span></span></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
        <button class="small" data-dbg="stress">stress test</button><button class="small" data-dbg="god">god mode</button>
        <button class="small" data-dbg="light">+500 light</button><button class="small" data-dbg="lumen">fill lumen</button>
        <button class="small" data-dbg="boss">jump to boss</button><button class="small" data-dbg="draft">draft</button>
        <button class="small" data-dbg="next">next sector</button><button class="small" data-dbg="embers">+500 embers</button>
      </div>`;
  }

  private onDebug(e: Event): void {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k;
    if (!k) return;
    const g = this.g;
    if (k === 'palette') {
      g.pipe.setPalette(PALETTES.find((p) => p.id === el.value)!, 0.6);
      return;
    }
    (g.pipe.look as unknown as Record<string, number>)[k] = Number(el.value);
    const v = el.parentElement?.querySelector('.v');
    if (v) v.textContent = el.value;
    if (k === 'pixelScale') g.pipe.rebuildTargets();
  }

  private debugAction(a: string): void {
    const g = this.g;
    const w = g.world;
    switch (a) {
      case 'stress':
        g.stress();
        break;
      case 'god':
        g.godMode = !g.godMode;
        break;
      case 'light':
        if (w) w.player.light += 500;
        break;
      case 'lumen':
        if (w) w.player.lumen = 100;
        break;
      case 'boss':
        if (g.run) g.startEncounter('boss', 7);
        break;
      case 'draft':
        if (g.run) g.openDraft({ after: 'map' });
        break;
      case 'next':
        if (g.run && g.run.sector < 4) g.enterSector(g.run.sector + 1);
        break;
      case 'embers':
        g.save.data.embers += 500;
        g.save.save();
        break;
    }
  }
}
