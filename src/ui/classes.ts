import './classes.css';
import type { Game } from '../game/game';
import { CLASSES, CLASS_BY_HULL, MAX_CLASS_LEVEL, canLearn, canUnlearn, classLevel, skillPoints, spentPoints, type ClassDef, type SkillNode } from '../data/classes';
import { HEARTH_HULLS, HULL_BY_ID } from '../data/world';
import { WEAPON_BY_ID } from '../data/weapons';
import type { HullDef, WeaponDef } from '../game/types';
import { esc } from './ui';
import { mountShipPreview } from './shippreview';

/**
 * The class screen: pick one of three pilot classes (or an owned Hearth hull),
 * see its ship, weapons and passive, spend skill points in its tree, launch.
 */
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const STAT_LABELS: [keyof ClassDef['ratings'], string][] = [
  ['offense', 'Offense'],
  ['defense', 'Defense'],
  ['mobility', 'Mobility'],
  ['difficulty', 'Difficulty'],
];

function launchLabel(g: Game): string {
  if (g.classLaunch.daily) return 'Daily Dive';
  if (g.classLaunch.endless) return 'Endless';
  return `Dive · Heat ${g.selectedHeat}`;
}

function weaponRow(slot: string, w: WeaponDef | undefined): string {
  if (!w) return '';
  return `<div class="cls-weapon" style="--wc:${w.color}"><span class="cls-slot">${slot}</span><div><b>${esc(w.name)}</b><span class="faint"> · ${w.family}</span><div class="d">${esc(w.desc)}</div></div></div>`;
}

function weapons(h: HullDef): string {
  return weaponRow('PRI', WEAPON_BY_ID[h.start.primary]) + weaponRow('SEC', WEAPON_BY_ID[h.start.secondary]) + (h.start.system ? weaponRow('SYS', WEAPON_BY_ID[h.start.system]) : '');
}

function nodeState(g: Game, cls: ClassDef, node: SkillNode): 'owned' | 'open' | 'locked' | 'poor' {
  const p = g.classProgress(cls.id);
  const pts = skillPoints(classLevel(p.xp).level);
  const r = canLearn(cls.id, p.learned, node.id, pts);
  if (r === 'owned') return 'owned';
  if (r === 'ok') return 'open';
  if (r === 'points') return 'poor';
  return 'locked';
}

function tree(g: Game, cls: ClassDef): string {
  const p = g.classProgress(cls.id);
  return `<div class="cls-tree">${cls.branches
    .map(
      (b) => `<div class="cls-branch">
        <div class="cls-branch-h"><b>${esc(b.name)}</b><span class="faint">${esc(b.desc)}</span></div>
        ${b.nodes
          .map((node) => {
            const st = nodeState(g, cls, node);
            const refund = st === 'owned' && canUnlearn(p.learned, node.id);
            const hint = st === 'owned' ? (refund ? 'Learned · select to refund' : 'Learned') : st === 'open' ? `Learn · ${node.cost} pt${node.cost > 1 ? 's' : ''}` : st === 'poor' ? `Needs ${node.cost} pt${node.cost > 1 ? 's' : ''}` : 'Learn the node above first';
            return `<button class="cls-node ${st} ${node.tier === 4 ? 'key' : ''}" data-nav data-act="skill" data-arg="${node.id}" data-silent="1" aria-label="${esc(node.name)}: ${esc(node.desc)} (${hint})">
              <span class="cls-node-tier">${node.tier === 4 ? 'KEY' : ROMAN[node.tier]}<i>${node.cost}</i></span>
              <span class="cls-node-body"><b>${esc(node.name)}</b><span class="d">${esc(node.desc)}</span><span class="cls-node-hint">${hint}</span></span>
            </button>`;
          })
          .join('<i class="cls-link" aria-hidden="true"></i>')}
      </div>`,
    )
    .join('')}</div>`;
}

function classDetail(g: Game, cls: ClassDef): string {
  const p = g.classProgress(cls.id);
  const lv = classLevel(p.xp);
  const pts = skillPoints(lv.level);
  const spent = spentPoints(p.learned);
  const pct = lv.need ? Math.round((lv.into / lv.need) * 100) : 100;
  const gained = g.lastClassXp?.classId === cls.id ? g.lastClassXp : null;
  return `<div class="cls-detail" style="--cc:${cls.hull.accent}">
    <div class="cls-head">
      <div class="cls-ship" data-ship-preview></div>
      <div class="cls-headtext">
        <div class="cls-kicker">${esc(cls.role)}</div>
        <h2>${esc(cls.name)} <span class="faint">· ${esc(cls.hull.name)}</span></h2>
        <p class="dim">${esc(cls.lore)}</p>
        <div class="cls-passive"><b>Passive</b> ${esc(cls.hull.passive)}</div>
        <div class="cls-ratings">${STAT_LABELS.map(([k, l]) => `<div><span>${l}</span><i style="--v:${cls.ratings[k]}"></i></div>`).join('')}</div>
      </div>
    </div>
    <div class="cls-weapons">${weapons(cls.hull)}</div>
    <div class="cls-level">
      <div class="cls-lv"><span>LEVEL</span><b>${lv.level}</b><span class="faint">/${MAX_CLASS_LEVEL}</span></div>
      <div class="cls-xp"><i style="width:${pct}%"></i></div>
      <div class="cls-xptext">${lv.need ? `${lv.into} / ${lv.need} XP` : 'MAX LEVEL'}${gained ? ` · <span class="light">+${gained.xp} last dive</span>` : ''}</div>
      <div class="cls-pts"><b>${pts - spent}</b> skill point${pts - spent === 1 ? '' : 's'} free</div>
      <button class="small" data-nav data-act="skillreset" data-arg="${cls.id}" ${spent ? '' : 'disabled'}>Reset tree</button>
    </div>
    ${tree(g, cls)}
  </div>`;
}

function hullDetail(h: HullDef): string {
  return `<div class="cls-detail" style="--cc:${h.accent}">
    <div class="cls-head">
      <div class="cls-ship" data-ship-preview></div>
      <div class="cls-headtext">
        <div class="cls-kicker">Hearth hull</div>
        <h2>${esc(h.name)}</h2>
        <p class="dim">${esc(h.desc)}</p>
        <div class="cls-passive"><b>Passive</b> ${esc(h.passive)}</div>
        <p class="faint">Hearth hulls have no skill tree and earn no class XP. Pick a class to grow one.</p>
      </div>
    </div>
    <div class="cls-weapons">${weapons(h)}</div>
  </div>`;
}

export function showClasses(g: Game, refresh = false): void {
  const viewing = HULL_BY_ID[g.selectedHull] ?? CLASSES[0]!.hull;
  const cls = CLASS_BY_HULL[viewing.id];
  const owned = HEARTH_HULLS.filter((h) => g.save.data.hulls.includes(h.id));
  const cards = CLASSES.map((c, i) => {
    const lv = classLevel(g.classProgress(c.id).xp).level;
    const sel = g.selectedHull === c.hull.id;
    return `<button class="cls-card ${sel ? 'sel' : ''}" style="--cc:${c.hull.accent}" data-nav ${sel ? 'data-autofocus' : ''} data-act="pickclass" data-arg="${c.hull.id}">
      <span class="ix">${String(i + 1).padStart(2, '0')}</span>
      <span class="cls-card-name">${esc(c.name)}<small>${esc(c.hull.name)} · ${esc(WEAPON_BY_ID[c.hull.start.primary]!.name)}</small></span>
      <span class="cls-card-lv">LV ${lv}</span>
    </button>`;
  }).join('');
  const hulls = owned.length
    ? `<div class="cls-sub">Hearth hulls</div><div class="cls-hulls">${owned
        .map((h) => `<button class="small ${g.selectedHull === h.id ? 'on' : ''}" style="--cc:${h.accent}" data-nav data-act="pickclass" data-arg="${h.id}">${esc(h.name)}</button>`)
        .join('')}</div>`
    : '';
  const html = `<div class="cls-screen">
    <div class="cls-side col">
      <div class="cls-kicker">${esc(launchLabel(g))}</div>
      <h1>Choose your pilot</h1>
      <p class="dim">Three classes, all ready to fly. Each grows its own skill tree from the XP of every dive.</p>
      <div class="col cls-cards">${cards}</div>
      ${hulls}
      <div class="col" style="margin-top:auto">
        <button class="primary" data-nav data-act="classlaunch">Launch · ${esc(viewing.name)}</button>
        <button data-nav data-act="classback" data-back data-sfx="back">Back</button>
      </div>
    </div>
    <div class="panel cls-panel scroll">${cls ? classDetail(g, cls) : hullDetail(viewing)}</div>
  </div>`;
  if (refresh) g.ui.refresh('classes', html);
  else g.ui.show('classes', html);
  mountShipPreview(g.ui.screenEl.querySelector<HTMLElement>('[data-ship-preview]'), viewing.id, viewing.accent, g.settings.reducedMotion);
}

export function registerClassActions(g: Game): void {
  const ui = g.ui;
  let back: () => void = () => g.goTitle();
  ui.on('classes', (a) => {
    back = g.state === 'hearth' ? () => g.goHearth() : () => g.goTitle();
    g.openClasses(a === 'daily' ? { daily: true } : a === 'endless' ? { endless: true } : {});
  });
  ui.on('pickclass', (a) => {
    g.selectHull(a);
    showClasses(g, true);
  });
  ui.on('skill', (a) => {
    g.toggleSkill(a);
    showClasses(g, true);
  });
  ui.on('skillreset', (a) => {
    g.resetSkills(a);
    showClasses(g, true);
  });
  ui.on('classlaunch', () => g.startRun({ ...g.classLaunch, hull: g.selectedHull }));
  ui.on('classback', () => back());
}
