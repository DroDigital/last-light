import * as THREE from 'three';
import type { Game, State } from '../game/game';
import type { World } from '../game/world';
import { PALETTES } from '../data/palettes';
import { fmtInt, clamp } from '../core/math';
import { esc } from './ui';
import type { SfxId } from '../audio/audio';
import { SECTORS } from '../data/world';

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
  private lastLight = 0;
  private miniMap = false;
  private t = 0;

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
      <div class="tl"><div class="display" data-r="sector" style="font-size:var(--s3);letter-spacing:.3em"></div><div class="dim" data-r="enc" style="font-size:var(--s1)"></div></div>
      <div class="tc"><div data-r="boss" class="bossbar" style="display:none"><div class="name" data-r="bossname"></div><div class="bar"><b data-r="bossghost"></b><i data-r="bosshp"></i></div><div class="dim" data-r="bossphase"></div></div></div>
      <div class="tr"><div class="lightcount" data-r="light">0</div><div class="dim" style="font-size:var(--s1);letter-spacing:.2em">LIGHT</div><div class="weapons" data-r="weapons" style="margin-top:10px"></div></div>
      <div class="bl">
        <div class="label"><span>Hull</span><b data-r="hullt"></b></div><div class="bar hull"><b data-r="hullghost"></b><i data-r="hull"></i></div>
        <div class="label"><span>Shield</span><b data-r="shieldt"></b></div><div class="bar shield"><i data-r="shield"></i></div>
        <div class="label"><span>Lumen</span><b data-r="lument"></b></div><div class="lumen" data-r="lumen"><div class="liquid" data-r="lumenl"></div></div>
      </div>
      <div class="br"><div class="label"><span>Boost</span><b></b></div><div class="bar" style="color:#9fd8ff;height:5px"><i data-r="boost"></i></div>
        <div class="abilities">
          <div class="ab" data-r="abdodge"><span class="k">⇧</span><div class="cd" data-r="cddodge"></div><span class="n" data-r="ndodge">DODGE</span></div>
          <div class="ab" data-r="abq"><span class="k">Q</span><div class="cd" data-r="cdq"></div><span class="n">SHOCK</span></div>
          <div class="ab" data-r="abe"><span class="k">E</span><div class="cd" data-r="cde"></div><span class="n">STASIS</span></div>
          <div class="ab" data-r="abs"><span class="k">R</span><div class="cd" data-r="cds"></div><span class="n">2ND</span></div>
        </div></div>
      <div class="toasts" data-r="toasts"></div>
      <div data-r="hint"></div>
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
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (g.showPerf) this.renderPerf(w);
    this.perfEl.style.display = g.showPerf ? 'block' : 'none';
    this.debugEl.style.display = g.showDebug ? 'block' : 'none';
    // sector title (also on map)
    if (g.state === 'map') this.positionNodeLabels();
    if (g.sectorTitle && (g.state === 'map' || g.state === 'combat')) {
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
    r.lument!.textContent = pl.flareT > 0 ? `FLARE ${pl.flareT.toFixed(1)}s` : pl.lumen >= 100 ? 'READY · F' : `${Math.floor(pl.lumen)}%`;
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
    const s = w.build.ship;
    r.cddodge!.style.height = pl.dodgeCharges >= s.dodges ? '0%' : `${(1 - pl.dodgeRecharge / s.dodgeCd) * 100}%`;
    r.ndodge!.textContent = `DODGE ×${pl.dodgeCharges}`;
    r.abdodge!.classList.toggle('ready', pl.dodgeCharges > 0);
    const qcd = 9 * s.abilityCd;
    const ecd = 14 * s.abilityCd;
    r.cdq!.style.height = `${Math.max(0, pl.shockCd / qcd) * 100}%`;
    r.abq!.classList.toggle('ready', pl.shockCd <= 0);
    r.cde!.style.height = `${Math.max(0, pl.stasisCd / ecd) * 100}%`;
    r.abe!.classList.toggle('ready', pl.stasisCd <= 0);
    const sw = w.build.secondary;
    const scd = 1 / Math.max(0.01, sw.params.rate);
    r.cds!.style.height = `${Math.max(0, sw.cd / scd) * 100}%`;
    if (this.t % 0.25 < 0.02 || !r.weapons!.innerHTML) {
      r.weapons!.innerHTML = w.build.weapons.map((x, i) => `${i === 0 ? 'LMB' : i === 1 ? 'RMB' : 'SYS'} <b>${esc(x.name)}</b> ${'▮'.repeat(x.level)}${x.evolved ? ' ❂' : ''}`).join('<br>');
      const run = g.run;
      if (run) {
        r.sector!.textContent = run.endless ? 'BEYOND · ENDLESS' : SECTORS[run.sector]!.name;
        const dir = g.director;
        r.enc!.textContent = dir ? (dir.kind === 'derelict' ? `Relight the beacons · ${dir.beacons.filter((b) => b.lit).length}/3` : dir.kind === 'endless' ? `Wave ${dir.endlessWave + 1}` : `${dir.kind.toUpperCase()} · ${w.liveEnemyCount()} hostiles`) : '';
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
    const hint = g.hints ?? '';
    if (r.hint!.dataset.k !== hint) {
      r.hint!.dataset.k = hint;
      r.hint!.innerHTML = hint ? `<div class="hint">${hint}</div>` : '';
    }
    this.el.classList.toggle('glitch', j.damageGlitch > 0.5 && !g.settings.reducedMotion);
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
    if (!pl.alive) return;
    // reticle at aim point
    const aimP = _w.copy(pl.pos).addScaledVector(pl.aimDir, 90);
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
    // target bracket
    if (pl.aimTarget >= 0) {
      const t = w.enemies.find((e) => e.id === pl.aimTarget);
      if (t) {
        const p = this.project(t.pos.x, t.pos.y, t.pos.z);
        if (p.on) {
          const s = 14;
          c.strokeStyle = 'rgba(255,240,180,0.8)';
          c.beginPath();
          c.moveTo(p.x - s, p.y - s + 5); c.lineTo(p.x - s, p.y - s); c.lineTo(p.x - s + 5, p.y - s);
          c.moveTo(p.x + s - 5, p.y - s); c.lineTo(p.x + s, p.y - s); c.lineTo(p.x + s, p.y - s + 5);
          c.moveTo(p.x - s, p.y + s - 5); c.lineTo(p.x - s, p.y + s); c.lineTo(p.x - s + 5, p.y + s);
          c.moveTo(p.x + s - 5, p.y + s); c.lineTo(p.x + s, p.y + s); c.lineTo(p.x + s, p.y + s - 5);
          c.stroke();
        }
      }
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
        c.fillStyle = e.elite ? '#ffc24a' : '#ff8a6a';
        c.fillRect(p.x - bw / 2, p.y - 26, bw * clamp(e.hp / e.maxHp, 0, 1), 4);
        if (e.elite) {
          c.font = '600 10px "Chakra Petch"';
          c.textAlign = 'center';
          c.fillStyle = '#ffc24a';
          c.fillText(e.elite.toUpperCase(), p.x, p.y - 30);
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
        c.font = `600 ${size}px "Chakra Petch"`;
        c.fillStyle = label ? `rgba(255,154,208,${1 - k})` : n.crit ? `rgba(255,236,150,${1 - k})` : `rgba(255,255,255,${0.85 - k * 0.85})`;
        c.fillText(label ?? String(n.v), p.x + n.vx * n.t, p.y + n.vy * n.t + 40 * n.t * n.t);
      }
    }
    // derelict beacon labels
    const dir = g.director;
    if (dir?.beacons.length) {
      for (const b of dir.beacons) {
        const p = this.project(b.pos.x, b.pos.y, b.pos.z);
        if (!p.on) continue;
        c.font = '600 11px "Chakra Petch"';
        c.fillStyle = b.lit ? '#fff2b8' : '#a6c8ff';
        c.fillText(b.lit ? 'RELIT' : `BEACON ${Math.round(b.progress * 100)}%`, p.x, p.y - 22);
      }
    }
    // cockpit frame
    if (g.camMode === 'cockpit') {
      c.strokeStyle = 'rgba(255,240,200,0.18)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, H * 0.82);
      c.lineTo(W * 0.22, H * 0.7);
      c.lineTo(W * 0.78, H * 0.7);
      c.lineTo(W, H * 0.82);
      c.moveTo(W * 0.12, 0);
      c.lineTo(W * 0.2, H * 0.7);
      c.moveTo(W * 0.88, 0);
      c.lineTo(W * 0.8, H * 0.7);
      c.stroke();
    }
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

  private positionNodeLabels(): void {
    const run = this.g.run;
    if (!run) return;
    for (const el of document.querySelectorAll<HTMLElement>('[data-node]')) {
      const n = run.map.nodes[Number(el.dataset.node)]!;
      const p = this.project(n.x, n.y + 5, n.z);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.display = p.behind ? 'none' : 'block';
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
