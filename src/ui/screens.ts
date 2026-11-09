import type { Game } from '../game/game';
import { cardRarity, cardTitle, type DraftCard } from '../game/build';
import { esc } from './ui';
import { HULLS, HEARTH_HULLS, HEARTH_UNLOCKS, DIALOGUE, CHALLENGES, LORE, HEAT_LEVELS, SECTORS, BOSSES } from '../data/world';
import { registerClassActions } from './classes';
import { CLASS_BY_ID } from '../data/classes';
import { SHIP_GLOW, type ShipGlow } from '../render/combat-look';
export { showClasses } from './classes';
import { WEAPONS, WEAPON_BY_ID } from '../data/weapons';
import { UPGRADES, SYNERGIES } from '../data/upgrades';
import { ENEMIES } from '../data/enemies';
import { AFFIXES, RARITY } from '../data/affixes';
import { SUBTYPES } from '../data/subtypes';
import { DROP_INFO, DROP_TABLE, DROP_KINDS, RARITY_DROP } from '../data/drops';
import { NODE_INFO, ROOM_TIER, isThreatRoom } from '../game/run';
import { Input, ACTION_LABELS, type Action } from '../core/input';
import { dailySeed } from '../core/rng';
import { PALETTES } from '../data/palettes';
import { fmtInt } from '../core/math';
import { MAX_LEVEL } from '../game/build';
import { EFFECTS } from '../game/loot';
import type { StatMod } from '../game/types';
import { mountPreviews } from './preview';
import { currentWeaponPreview, draftComparison } from './draft-comparison';

const FAMILY_ICON: Record<string, string> = { kinetic: '⁂', energy: '✧', ordnance: '✹', exotic: '◎', drone: '⟡', light: '☼' };
const VISUAL_ICON: Record<string, string> = { projectile: '➶', ship: '⛭', trail: '≋', aura: '◌', explosion: '✺', drone: '⟡', hud: '◈' };

function cardIcon(c: DraftCard): string {
  switch (c.kind) {
    case 'upgrade':
      return c.def.rarity === 'artifact' ? '✦' : c.def.rarity === 'curse' ? '☠' : VISUAL_ICON[c.def.visual] ?? '◆';
    case 'weapon':
      return FAMILY_ICON[c.def.family] ?? '◆';
    case 'level':
      return '▲';
    case 'evolve':
      return '❂';
  }
}

function cardDesc(c: DraftCard): string {
  switch (c.kind) {
    case 'upgrade':
      return c.def.desc;
    case 'weapon':
      return `<span class="dim">${c.def.family} · ${c.def.slot === 'system' ? 'system · always on' : `linked ${c.def.slot} · fires with your ${c.def.slot === 'primary' ? 'primary' : 'secondary'} trigger`}</span><br>${c.def.desc}<br><span class="faint">Evolves at Lv 5 with <b>${c.def.evolve.tag}</b>.</span>`;
    case 'level':
      return `Level ${c.weapon.level} → ${c.weapon.level + 1}. +20% damage, faster fire${c.weapon.level + 1 >= 3 ? ', more projectiles' : ''}.${c.weapon.level + 1 >= MAX_LEVEL ? `<br><span class="light">Max level: evolves with the ${c.weapon.def.evolve.tag} tag.</span>` : ''}`;
    case 'evolve':
      return `${c.weapon.def.evolve.desc}<br><span class="faint">${c.weapon.def.name} becomes something new.</span>`;
  }
}

function cardTags(c: DraftCard, g: Game): string {
  const tags = c.kind === 'upgrade' ? c.def.tags : c.kind === 'weapon' ? c.def.tags : c.weapon.def.tags;
  return tags.map((t) => `<span class="tag ${(g.world!.build.tags[t] ?? 0) > 0 ? 'hit' : ''}">${t}</span>`).join('');
}

/** "Vanguard XP +340 · Level 3" on the run summary, when the dive was flown by a class. */
function classXpStat(g: Game): string {
  const x = g.lastClassXp;
  const cls = x ? CLASS_BY_ID[x.classId] : undefined;
  if (!x || !cls) return '';
  const up = x.levelAfter > x.levelBefore ? ` · <span style="color:${cls.hull.accent}">LEVEL ${x.levelAfter}</span>` : '';
  return `<div class="stat"><span>${esc(cls.name)} XP</span><b class="light">+${fmtInt(x.xp)}${up}</b></div>`;
}

export function showTitle(g: Game): void {
  const d = g.save.data;
  const daily = dailySeed();
  const best = d.dailyBest[daily];
  g.ui.show(
    'title',
    `<div class="numeral">${String(d.bossesKilled.length).padStart(2, '0')}</div>
    <div class="title-screen ${g.settings.reducedMotion ? 'motion-reduced' : ''}">
      <div class="title-kicker"><span class="title-kicker-mark" aria-hidden="true">✶</span> THE HEARTH <span class="title-kicker-divider">/</span> YOUR LAST BEACON</div>
      <div class="logo"><span class="lg-base">Last Light</span><span class="lg-lit" aria-hidden="true">Last Light</span><small>The universe is going dark · ${d.bossesKilled.length}/${Object.keys(BOSSES).length} stars relit</small></div>
      <div class="title-progress" aria-label="${d.bossesKilled.length} of ${Object.keys(BOSSES).length} stars relit">
        <div class="title-progress-lights" aria-hidden="true">${Object.keys(BOSSES).map((_, i) => `<i class="${i < d.bossesKilled.length ? 'lit' : ''}" style="--light-index:${i}"></i>`).join('')}</div>
        <span>${d.bossesKilled.length ? 'THE LIGHT RETURNS' : 'ONE SPARK REMAINS'}</span>
      </div>
      <div class="menu">
        <button class="primary" data-nav data-autofocus data-act="classes"><span class="ix">01</span>Dive<span class="sub">Choose your class · ${esc(HULLS.find((h) => h.id === g.selectedHull)?.name ?? 'The Lantern')} · Heat ${g.selectedHeat}</span></button>
        <button data-nav data-act="quickdive"><span class="ix">02</span>Quick Dive<span class="sub">${esc(HULLS.find((h) => h.id === g.selectedHull)?.name ?? 'The Lantern')} · Heat ${g.selectedHeat}</span></button>
        <button data-nav data-act="hearth"><span class="ix">03</span>The Hearth<span class="sub">Unlocks and hulls · ${fmtInt(d.embers)} Embers</span></button>
        <button data-nav data-act="classes" data-arg="daily"><span class="ix">04</span>Daily Dive<span class="sub">${daily}${best ? ` · best ${fmtInt(best)}` : ''}</span></button>
        <button data-nav data-act="classes" data-arg="endless"><span class="ix">05</span>Endless<span class="sub">Waves through all ten sectors${d.endlessBest ? ` · best wave ${d.endlessBest}` : ''}</span></button>
        <button data-nav data-act="codex"><span class="ix">06</span>Codex</button>
        <button data-nav data-act="settings"><span class="ix">07</span>Settings</button>
        <button data-nav data-act="credits"><span class="ix">08</span>Credits</button>
      </div>
      <div class="footer"><span>Runs ${d.runs} · Wins ${d.wins} · Stars relit ${d.bossesKilled.length}</span><span>F1 look panel · F3 perf · click the game to lock the mouse</span></div>
    </div>`,
  );
}

export function showHearth(g: Game, refresh = false): void {
  const d = g.save.data;
  const lines = DIALOGUE.filter((l) => (l.req.runs ?? 0) <= d.runs && (l.req.bosses ?? 0) <= d.bossesKilled.length && (l.req.wins ?? 0) <= d.wins);
  const shown = lines.slice(-3);
  const tab = g.hearthTab;
  let body = '';
  if (tab === 'unlocks') {
    body = HEARTH_UNLOCKS.map((u) => {
      const lvl = g.save.unlockLevel(u.id);
      const max = u.max ?? 1;
      const cost = u.cost * (lvl + 1);
      const done = lvl >= max;
      return `<div class="item ${done ? 'owned' : d.embers < cost ? 'disabled' : ''}" data-nav data-act="unlock" data-arg="${u.id}">
        <div class="ic">${u.kind === 'cosmetic' ? '❖' : u.kind === 'boost' ? '▲' : '◆'}</div>
        <div class="grow"><div class="t">${esc(u.name)} ${max > 1 ? `<span class="faint">${lvl}/${max}</span>` : ''}</div><div class="d">${esc(u.desc)}</div></div>
        <div class="price">${done ? 'OWNED' : `${cost} ✶`}</div></div>`;
    }).join('');
  } else if (tab === 'hulls') {
    body = HEARTH_HULLS.map((h) => {
      const own = d.hulls.includes(h.id);
      const sel = g.selectedHull === h.id;
      return `<div class="item ${sel ? 'owned' : ''} ${!own && d.embers < h.cost ? 'disabled' : ''}" data-nav data-act="hull" data-arg="${h.id}" style="--rc:${h.accent}">
        <div class="ic">▲</div><div class="grow"><div class="t">${esc(h.name)} ${sel ? '<span class="light">· SELECTED</span>' : ''}</div><div class="d">${esc(h.desc)} <br><span class="light">${esc(h.passive)}</span><br>Starts: ${WEAPON_BY_ID[h.start.primary]!.name} + ${WEAPON_BY_ID[h.start.secondary]!.name}</div></div>
        <div class="price">${own ? (sel ? '✓' : 'SELECT') : `${h.cost} ✶`}</div></div>`;
    }).join('');
  } else if (tab === 'arsenal') {
    const pick = g.save.unlockLevel('l_pick') > 0;
    body = `<p class="dim">Unlocked weapons enter the draft pool. ${pick ? 'Click an owned primary to start with it.' : 'Unlock <b>Armory Access</b> to choose your starting primary.'}</p>` +
      WEAPONS.map((w) => {
        const own = d.weapons.includes(w.id);
        const sel = g.selectedPrimary === w.id;
        return `<div class="item ${own ? '' : d.embers < (w.unlock ?? 50) ? 'disabled' : ''} ${sel ? 'owned' : ''}" data-nav data-act="weapon" data-arg="${w.id}">
          <div class="ic">${FAMILY_ICON[w.family]}</div><div class="grow"><div class="t">${esc(w.name)} <span class="faint">${w.family} · ${w.slot}</span>${sel ? ' <span class="light">· START</span>' : ''}</div><div class="d">${esc(w.desc)}</div></div>
          <div class="price">${own ? (pick && w.slot === 'primary' ? (sel ? '✓' : 'PICK') : '✓') : `${w.unlock ?? 50} ✶`}</div></div>`;
      }).join('');
  } else if (tab === 'heat') {
    body = `<p class="dim">${d.heatUnlocked ? 'Stacking difficulty for better Embers.' : 'Relight the Last Star once to unlock Heat.'}</p>` +
      [{ name: 'Heat 0 · Ember', desc: 'The standard dive.' }, ...HEAT_LEVELS].map((h, i) => {
        const ok = i === 0 || (d.heatUnlocked && i <= d.maxHeat);
        return `<div class="item ${g.selectedHeat === i ? 'owned' : ''} ${ok ? '' : 'disabled'}" data-nav data-act="heat" data-arg="${i}"><div class="ic">${i}</div><div class="grow"><div class="t">${h.name}</div><div class="d">${h.desc}${i > 0 ? ` (+${i * 12}% Embers)` : ''}</div></div></div>`;
      }).join('');
  } else if (tab === 'history') {
    body = d.history.length
      ? d.history.map((r) => `<div class="item"><div class="ic">${r.won ? '☀' : '☾'}</div><div class="grow"><div class="t">${r.won ? 'Relit the Last Star' : `Sector ${r.sector} · ${esc(r.cause)}`}${r.daily ? ' · DAILY' : ''}</div>
          <div class="d">${esc(HULLS.find((h) => h.id === r.hull)?.name ?? r.hull)} · Heat ${r.heat} · ${r.kills} kills · ${fmtInt(r.light)} Light · ${Math.floor(r.timeSec / 60)}m${r.timeSec % 60}s<br>${esc(r.weapons.join(', '))}</div></div>
          <div class="price">${fmtInt(r.score)}<br><span class="faint mono" title="seed">${esc(r.seed)}</span></div></div>`).join('')
      : '<p class="dim">No dives yet.</p>';
  } else if (tab === 'challenges') {
    body = CHALLENGES.map((c) => `<div class="item ${d.challenges.includes(c.id) ? 'owned' : ''}"><div class="ic">${d.challenges.includes(c.id) ? '✓' : '·'}</div><div class="grow"><div class="t">${esc(c.name)}</div><div class="d">${esc(c.desc)}</div></div><div class="price">+${c.reward} ✶</div></div>`).join('');
  }
  const tabs = ['unlocks', 'hulls', 'arsenal', 'heat', 'challenges', 'history'];
  const html = `<div class="row" style="padding:3vh 3vw;gap:3vw;align-items:stretch;width:100%">
    <div class="col hearth-side" style="width:min(420px,32vw)">
      <h1>The Hearth</h1>
      <div class="light display" style="font-size:var(--s4)">${fmtInt(d.embers)} Embers</div>
      <div class="dim">Hearth level ${d.hearthLevel} · ${HEARTH_HULLS.filter((h) => d.hulls.includes(h.id)).length}/${HEARTH_HULLS.length} hulls · ${d.weapons.length}/${WEAPONS.length} weapons</div>
      <div style="margin-top:2vh">${shown.map((l, i) => `<div class="dialogue" style="animation-delay:${i * 0.25}s"><div class="who">${l.who}</div>${esc(l.text)}</div>`).join('')}</div>
      <div class="col" style="margin-top:auto">
        <button class="primary" data-nav data-autofocus data-act="classes">Dive · ${esc(HULLS.find((h) => h.id === g.selectedHull)?.name ?? '')} · Heat ${g.selectedHeat}</button>
        <button data-nav data-act="classes" data-arg="daily">Daily Dive</button>
        <button data-nav data-act="title" data-back data-sfx="back">Back</button>
      </div>
    </div>
    <div class="panel col grow" style="max-height:94vh">
      <div class="tabs">${tabs.map((t) => `<button class="${t === tab ? 'on' : ''}" data-nav data-act="htab" data-arg="${t}">${t}</button>`).join('')}</div>
      <div class="scroll col" style="max-height:78vh">${body}</div>
    </div></div>`;
  if (refresh) g.ui.refresh('hearth', html);
  else g.ui.show('hearth', html);
}

export function showMap(g: Game): void {
  const run = g.run!;
  const w = g.world!;
  const sec = SECTORS[run.sector]!;
  const reach = new Set(g.reachable().map((n) => n.id));
  const labels = run.map.nodes
    .map((n) => {
      const info = NODE_INFO[n.type];
      const cls = n.id === run.node ? 'cur' : reach.has(n.id) ? 'reach' : n.visited ? 'done' : '';
      return `<div class="node-label ${cls}" style="--room-color:${ROOM_TIER[n.rarity].color}" ${reach.has(n.id) ? 'data-nav' : ''} data-act="node" data-arg="${n.id}" data-node="${n.id}" aria-label="${esc(info.name)} · ${esc(info.desc)}" title="${esc(info.name)} — ${esc(info.desc)}"><span class="ic">${info.icon} ${String(n.row + 1).padStart(2, '0')}</span><span>${info.name}</span>${isThreatRoom(n.type) ? `<small>${n.rarity}</small>` : ''}</div>`;
    })
    .join('');
  const b = w.build;
  g.ui.show(
    'map',
    `<div class="numeral" style="left:2vw;right:auto">${String(run.sector + 1).padStart(2, '0')}</div>
    <div class="map-ui screen passthrough" style="position:absolute;inset:0;display:flex">
      <div class="side panel col">
        <h2>${esc(sec.name)}</h2>
        <div class="dim">${esc(sec.star)} · ${esc(BOSSES[sec.boss]!.name)} waits at the dying star.</div>
        <div class="stat"><span>Hull</span><b>${Math.ceil(w.player.hull)}/${w.player.maxHull}</b></div>
        <div class="stat"><span>Light</span><b>${fmtInt(w.player.light)}</b></div>
        <div class="stat"><span>Primary</span><b>${esc(b.primary.name)} Lv${b.primary.level}</b></div>
        <div class="stat"><span>Secondary</span><b>${esc(b.secondary.name)} Lv${b.secondary.level}</b></div>
        ${b.linked.map((x) => `<div class="stat"><span>Linked</span><b>${esc(x.name)} Lv${x.level}</b></div>`).join('')}
        ${b.linked.length < b.linkSlots ? `<div class="stat"><span>Linked</span><b class="faint">${b.linkSlots - b.linked.length} open hardpoint${b.linkSlots - b.linked.length > 1 ? 's' : ''}</b></div>` : ''}
        ${b.systems.map((s) => `<div class="stat"><span>System</span><b>${esc(s.name)} Lv${s.level}</b></div>`).join('')}
        <div class="stat"><span>Upgrades</span><b>${[...b.upgrades.values()].reduce((a, c) => a + c, 0)}</b></div>
        <div class="stat"><span>Synergies</span><b>${[...b.synergies].map((s) => SYNERGIES.find((x) => x.id === s)?.name).join(', ') || '—'}</b></div>
        <div class="faint" style="margin-top:8px">Seed <span class="mono">${esc(run.seed)}</span>${run.daily ? ' · DAILY' : ''} · Heat ${run.heat}</div>
        <button class="small" data-nav data-act="inventory">Loadout · ${b.inventory.length} salvage</button>
        <button class="small" data-nav data-act="pausemenu">Menu</button>
      </div>
      <div class="side panel col" id="nodeinfo"><h3>Chart your course</h3><div class="dim">Choose a highlighted destination. Higher-tier encounters hold more salvage and stronger, denser fleets.</div>
        <div id="node-detail" class="node-detail"><span class="node-detail-label">NEXT DESTINATION</span><strong data-node-name>Choose a route</strong><span data-node-description>Highlight a destination to inspect it.</span><span data-node-rarity></span></div>
        <div class="route-legend"><span class="route-current">◆ Current</span><span class="route-reachable">◇ Reachable</span><span class="route-visited">· Visited</span></div>
        <div class="map-legend">${(['common', 'rare', 'epic', 'legendary', 'mythical'] as const).map((r) => `<span style="color:${ROOM_TIER[r].color}">◆ ${r}</span>`).join('')}</div>
        <div class="faint">Drag empty space to orbit · scroll to zoom</div>
        <div class="row map-controls"><button class="small" data-nav data-act="maporbit" data-arg="-1" aria-label="Rotate chart left">↶</button><button class="small" data-nav data-act="maporbit" data-arg="1" aria-label="Rotate chart right">↷</button><button class="small" data-nav data-act="mapzoom" data-arg="-1" aria-label="Zoom in">＋</button><button class="small" data-nav data-act="mapzoom" data-arg="1" aria-label="Zoom out">−</button><button class="small" data-nav data-act="mapreset">Reset</button></div>
      </div>
    </div>
    <div id="nodelabels">${labels}</div>`,
  );
}

/** Describe the actual rolled values so equipment can be compared before fitting it. */
function equipmentMods(mods: StatMod[]): string {
  return mods.map((m) => {
    const value = m.mul !== undefined ? `${Math.round((m.mul - 1) * 100) >= 0 ? '+' : ''}${Math.round((m.mul - 1) * 100)}%` : `${(m.add ?? 0) >= 0 ? '+' : ''}${Number((m.add ?? 0).toFixed(2))}`;
    return `${value} ${m.s.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
  }).join(' · ');
}

export function showInventory(g: Game, refresh = false): void {
  const w = g.world!;
  const b = w.build;
  const target = g.effectTarget;
  const slots = (['port', 'starboard', 'propulsion'] as const).map((slot) => {
    const item = b.inventory.find((it) => it.id === b.equipment[slot]);
    return `<div class="loadout-mounted"><span class="faint">${slot}</span><strong style="color:${item?.color ?? 'var(--paper-2)'}">${item ? esc(item.name) : 'Standard issue'}</strong>${item ? `<small>${esc(equipmentMods(item.mods))}</small>${item.trait ? `<small>${esc(item.trait.name)}: ${esc(item.trait.desc)}</small>` : ''}<button class="small" data-nav data-act="unequipsalvage" data-arg="${slot}">Remove</button>` : '<small>No component fitted</small>'}</div>`;
  }).join('');
  const effectSlots = (['port', 'starboard'] as const).map((side) => `<div class="loadout-side"><h3>${side} hardpoint</h3><div class="loadout-effect-slots">${([0, 1] as const).map((index) => {
    const effect = EFFECTS.find((e) => e.id === b.effects[side][index]);
    const selected = target.side === side && target.index === index;
    return `<button class="small ${selected ? 'primary' : ''}" data-nav data-act="effecttarget" data-arg="${side}:${index}"><span class="faint">0${index + 1}</span> ${effect ? esc(effect.name) : 'Empty effect'}</button>`;
  }).join('')}</div></div>`).join('');
  const items = [...b.inventory].reverse().map((item) => {
    const equipped = b.equipment[item.slot] === item.id;
    const unlockedEffect = EFFECTS.find((effect) => effect.id === item.effectId);
    return `<div class="item ${equipped ? 'owned' : ''}" style="--rc:${item.color}" data-nav data-act="equipsalvage" data-arg="${esc(item.id)}"><div class="ic">${item.slot === 'propulsion' ? '➤' : '✶'}</div><div class="grow"><div class="t">${esc(item.name)}</div><div class="d"><span style="color:${item.color}">${item.rarity}</span> · ${item.slot} · ${esc(equipmentMods(item.mods))}${item.trait ? `<br><b>${esc(item.trait.name)}:</b> ${esc(item.trait.desc)}` : ''}${unlockedEffect ? `<br>Effect discovered: ${esc(unlockedEffect.name)}` : ''}</div></div><div class="price">${equipped ? 'FITTED' : 'EQUIP'}</div></div>`;
  }).join('');
  const effects = EFFECTS.map((effect) => {
    const installed = b.effects[target.side][target.index] === effect.id;
    const unlocked = b.unlockedEffects.has(effect.id);
    return `<div class="item ${installed ? 'owned' : !unlocked || w.player.light < effect.cost ? 'disabled' : ''}" style="--rc:${effect.color}" ${installed || !unlocked ? '' : `data-nav data-act="installeffect" data-arg="${esc(effect.id)}"`}><div class="ic">✧</div><div class="grow"><div class="t">${esc(effect.name)}</div><div class="d">${unlocked ? `${esc(effect.desc)} · ${esc(equipmentMods(effect.mods))}` : 'Discover this effect on salvaged equipment.'}</div></div><div class="price">${installed ? 'FITTED' : unlocked ? `${effect.cost} LIGHT` : 'UNDISCOVERED'}</div></div>`;
  }).join('');
  const html = `<div class="panel loadout-panel col">
    <div class="loadout-header"><div><div class="faint mono">THE LANTERN / FIELD HANGAR</div><h1>Loadout</h1></div><div class="lightcount">${fmtInt(w.player.light)} Light</div></div>
    <div class="loadout-mounted-grid">${slots}</div>
    <div class="loadout-body">
      <section class="loadout-column"><h3>Salvaged components <span class="faint">${b.inventory.length}</span></h3><div class="dim">Equip a component to replace the one in its slot. All salvage stays in your hold.</div><div class="scroll loadout-list">${items || '<p class="dim">Clear an encounter to recover components.</p>'}</div></section>
      <section class="loadout-column"><h3>Weapon effects</h3><div class="dim">Choose one of four sockets, then fit a discovered effect. Fitting costs Light; replacing an effect costs its listed price.</div>${effectSlots}<div class="row spread"><div class="label">Fitting: ${target.side} / 0${target.index + 1}</div>${b.effects[target.side][target.index] ? '<button class="small" data-nav data-act="removeeffect">Remove · free</button>' : ''}</div><div class="scroll loadout-list">${effects}</div></section>
    </div><button class="primary loadout-return" data-nav data-autofocus data-act="closeinventory" data-back>${g.inventoryAfter === 'endless' ? 'Next wave' : 'Return to chart'}</button>
  </div>`;
  if (refresh) g.ui.refresh('inventory', html);
  else g.ui.show('inventory', html);
}

export function showDraft(g: Game): void {
  const run = g.run!;
  const w = g.world!;
  const cards = run.draft ?? [];
  const previewCards: DraftCard[] = [];
  const previewPhases: number[] = [];
  const rerollCost = run.freeRerolls > 0 ? 'FREE' : `${20 + run.rerolls * 15} Light`;
  const src = run.draftCtx?.source;
  const title = run.draftCtx?.armory ? 'Armory · Arm a Hardpoint' : src ? DROP_INFO[src].name : run.draftCtx?.minRarity === 'legendary' ? 'Rift Spoils' : run.draftCtx?.minRarity === 'rare' ? 'Rare Salvage' : 'Choose an Upgrade';
  const queued = run.draftQueue?.length ?? 0;
  g.ui.show(
    'draft',
    `<h1>${title}</h1>${run.draftCtx?.armory ? `<div class="dim" style="margin-bottom:6px">Pick a gun for a linked hardpoint. It fires together with your main weapon on the same trigger.</div>` : ''}<div class="dim">Light <span class="light mono">${fmtInt(w.player.light)}</span> · Cards marked COMBO work with your build${queued ? ` · <span style="color:var(--lantern)">${queued} more draft${queued > 1 ? 's' : ''} queued from drops</span>` : ''}</div>
     <div class="cards">${cards
       .map((c, i) => {
         const r = cardRarity(c);
         const comparison = draftComparison(c, w.build);
         const currentPreview = currentWeaponPreview(c, w.build);
         if (currentPreview) { previewCards.push(currentPreview); previewPhases.push(i * 0.37); }
         previewCards.push(c); previewPhases.push(i * 0.37);
         return `<div class="card r-${r}" style="--rc:var(--c-${r})" data-nav ${i === 0 ? 'data-autofocus' : ''} data-act="pick" data-arg="${i}">
          <div class="glow"></div>${c.combo >= 2 ? '<div class="combo"></div>' : ''}
          <div class="idx">${String(i + 1).padStart(2, '0')}</div>
          <div class="rar">${c.kind === 'evolve' ? 'Evolution' : c.kind === 'weapon' ? 'New weapon' : c.kind === 'level' ? 'Weapon level' : r}</div>
          <div class="pv ${currentPreview ? 'pv-paired' : ''}">${currentPreview ? '<div class="pv-side"><span>CURRENT</span><canvas aria-hidden="true"></canvas></div>' : ''}<div class="pv-side"><span>${currentPreview ? 'PROPOSED' : 'PREVIEW'}</span><canvas aria-hidden="true"></canvas></div><span class="pv-ic">${cardIcon(c)}</span></div>
          <div class="nm">${esc(cardTitle(c))}</div>
          <div class="ds">${cardDesc(c)}</div>
          <div class="card-comparison" aria-label="${esc(comparison.label)}: ${esc(comparison.before)} changes to ${esc(comparison.after)}"><span class="compare-label">${esc(comparison.label)}</span><div><span>${esc(comparison.before)}</span><b aria-hidden="true">→</b><strong>${esc(comparison.after)}</strong></div></div>
          <div>${cardTags(c, g)}</div>
          ${c.kind === 'upgrade' && run.banishes > 0 ? `<button class="small banish" data-nav data-act="banish" data-arg="${i}" title="Remove from this run's pool">Banish (${run.banishes})</button>` : ''}
        </div>`;
       })
       .join('')}</div>
     <div class="row"><button data-nav data-act="reroll">Reroll · ${rerollCost}</button><button data-nav data-act="skip">Skip · +25 Light</button></div>
     <div class="faint" style="margin-top:12px">Keys <span class="kbd">1</span> <span class="kbd">2</span> <span class="kbd">3</span> pick</div>`,
    'draft',
  );
  mountPreviews([...g.ui.root.querySelectorAll<HTMLCanvasElement>('.card .pv canvas')], previewCards, g.settings.reducedMotion, previewPhases);
}

export function showShop(g: Game, refresh = false): void {
  const run = g.run!;
  const w = g.world!;
  const items = run.shop ?? [];
  const html = `<div class="panel center col" style="width:min(760px,92vw)">
    <h1>Ash's Trading Post</h1>
    <div class="dialogue"><div class="who">Ash</div>${['Everything must go. Mostly because the Hush is eating my warehouse.', 'Light only. No refunds. No questions. Some questions.', 'You again! Good. My best customer is still alive.'][run.sector % 3]}</div>
    <div class="row spread"><span class="dim">Hull ${Math.ceil(w.player.hull)}/${w.player.maxHull}</span><span class="lightcount">${fmtInt(w.player.light)} Light</span></div>
    <div class="col scroll" style="max-height:56vh">${items
      .map((it, i) => `<div class="item ${it.sold ? 'owned' : w.player.light < it.price ? 'disabled' : ''}" style="--rc:var(--c-${it.rarity})" data-nav data-act="buy" data-arg="${i}">
        <div class="ic">${it.kind === 'weapon' ? FAMILY_ICON[WEAPON_BY_ID[it.id]!.family] : it.kind.includes('repair') ? '✚' : it.kind === 'level' ? '▲' : '◆'}</div>
        <div class="grow"><div class="t">${esc(it.name)} <span class="faint">${it.rarity}</span></div><div class="d">${esc(it.desc)}</div></div>
        <div class="price">${it.sold ? 'SOLD' : `${it.price}`}</div></div>`)
      .join('')}</div>
    <button class="primary" data-nav data-act="leave" data-back>Warp on</button></div>`;
  if (refresh) g.ui.refresh('shop', html);
  else g.ui.show('shop', html);
}

export function showEvent(g: Game): void {
  const run = g.run!;
  const ev = run.lastEvent!;
  const out = run.eventOutcome;
  g.ui.show(
    'event',
    `<div class="panel center col" style="width:min(640px,92vw)">
      <h1>${esc(ev.title)}</h1><p style="font-size:var(--s3);line-height:1.6">${esc(ev.text)}</p>
      ${out ? `<div class="dialogue">${esc(out)}</div>${run.pendingFight ? '<div class="dim">Brace for contact…</div>' : '<button class="primary" data-nav data-autofocus data-act="leave">Continue</button>'}` : ev.choices.map((c, i) => `<button data-nav data-act="choice" data-arg="${i}" style="text-align:left">${esc(c.label)}</button>`).join('')}
    </div>`,
  );
}

export function showForge(g: Game): void {
  const w = g.world!;
  const run = g.run!;
  const cost = 50 + run.sector * 20;
  const commons = [...w.build.upgrades.keys()].filter((id) => UPGRADES.find((x) => x.id === id)?.rarity === 'common').length;
  g.ui.refresh(
    'forge',
    `<div class="panel center col" style="width:min(720px,92vw)">
      <h1>The Forge</h1><div class="row spread"><span class="dim">Fuse, upgrade or reroll.</span><span class="lightcount">${fmtInt(w.player.light)} Light</span></div>
      <h3>Upgrade a weapon · ${cost} Light</h3>
      ${w.build.weapons.map((x) => `<div class="item ${x.level >= 5 || w.player.light < cost ? 'disabled' : ''}" data-nav data-act="forge" data-arg="level:${x.def.id}"><div class="ic">${FAMILY_ICON[x.def.family]}</div><div class="grow"><div class="t">${esc(x.name)}</div><div class="d">Lv ${x.level} → ${Math.min(5, x.level + 1)}</div></div></div>`).join('')}
      <h3>Fuse · two commons into a rare choice</h3>
      <div class="item ${commons < 2 ? 'disabled' : ''}" data-nav data-act="forge" data-arg="fuse:"><div class="ic">⚒</div><div class="grow"><div class="t">Fuse</div><div class="d">${commons} common upgrades available</div></div></div>
      <h3>Reroll an upgrade · ${Math.round(cost * 0.6)} Light</h3>
      <div class="col scroll" style="max-height:24vh">${[...w.build.upgrades.keys()].map((id) => {
        const u = UPGRADES.find((x) => x.id === id)!;
        return `<div class="item" style="--rc:var(--c-${u.rarity})" data-nav data-act="forge" data-arg="reroll:${id}"><div class="ic">↻</div><div class="grow"><div class="t">${esc(u.name)}</div><div class="d">${esc(u.desc)}</div></div></div>`;
      }).join('') || '<div class="dim">No upgrades yet.</div>'}</div>
      <button class="primary" data-nav data-act="forge" data-arg="leave:" data-back>Leave</button></div>`,
  );
}

export function showRest(g: Game): void {
  const w = g.world!;
  g.ui.show(
    'rest',
    `<div class="panel center col" style="width:min(620px,92vw)">
      <h1>A Quiet Orbit</h1><p class="dim">The dark is still here. For a moment, nothing hunts you.</p>
      <div class="item" data-nav data-autofocus data-act="rest" data-arg="repair:"><div class="ic">✚</div><div class="grow"><div class="t">Repair</div><div class="d">Restore ${Math.round(w.player.maxHull * 0.5)} hull (${Math.ceil(w.player.hull)}/${w.player.maxHull}).</div></div></div>
      ${w.build.weapons.filter((x) => x.level < 5).map((x) => `<div class="item" data-nav data-act="rest" data-arg="train:${x.def.id}"><div class="ic">▲</div><div class="grow"><div class="t">Train ${esc(x.name)}</div><div class="d">Lv ${x.level} → ${x.level + 1}</div></div></div>`).join('')}
    </div>`,
  );
}

function buildSummary(g: Game): string {
  const w = g.world!;
  const b = w.build;
  const total = b.weapons.reduce((a, x) => a + x.damageDealt, 0) || 1;
  return `<div class="col"><h3>Weapons</h3>${b.weapons
    .map((x) => `<div><div class="stat"><span>${esc(x.name)} Lv${x.level}${x.evolved ? ' ❂' : ''}</span><b>${fmtInt(x.damageDealt)} · ${x.kills} kills</b></div><div class="dmgbar" style="width:${(x.damageDealt / total) * 100}%"></div></div>`)
    .join('')}
    <h3 style="margin-top:10px">Upgrades</h3><div>${[...b.upgrades.entries()].map(([id, n]) => {
      const u = UPGRADES.find((x) => x.id === id)!;
      return `<span class="tag" style="color:var(--c-${u.rarity})">${esc(u.name)}${n > 1 ? ' ×' + n : ''}</span>`;
    }).join('') || '<span class="dim">none</span>'}</div>
    <h3 style="margin-top:10px">Synergies</h3><div>${[...b.synergies].map((s) => `<span class="tag hit">${esc(SYNERGIES.find((x) => x.id === s)!.name)}</span>`).join('') || '<span class="dim">none</span>'}</div></div>`;
}

export function showPause(g: Game): void {
  g.ui.show(
    'pause',
    `<div class="row center" style="gap:3vw;align-items:flex-start">
      <div class="col" style="width:280px"><h1>Paused</h1>
        <button class="primary" data-nav data-autofocus data-act="resume" data-back>Resume</button>
        <button data-nav data-act="settings">Settings</button>
        <button data-nav data-act="abandon">Abandon dive</button>
        <div class="dim" style="margin-top:12px">Seed <span class="mono">${esc(g.run?.seed ?? '')}</span></div>
      </div>
      <div class="panel" style="width:min(520px,60vw);max-height:80vh;overflow:auto">${g.world ? buildSummary(g) : ''}</div>
    </div>`,
  );
}

export function showDeath(g: Game): void {
  const w = g.world!;
  const r = g.lastRecord!;
  g.ui.show(
    'death',
    `<div class="row center" style="gap:3vw;align-items:flex-start">
      <div class="col" style="width:360px">
        <div class="display" style="font-size:var(--s6);line-height:.85">The light<br>fades</div><span class="sigbar"></span>
        <div class="cause">Killed by <b>${esc(w.player.deathCause)}</b> in ${esc(SECTORS[g.run!.sector]!.name)}</div>
        <div class="panel col" style="margin-top:12px">
          <div class="stat"><span>Kills</span><b>${fmtInt(w.stats.kills)}</b></div>
          <div class="stat"><span>Light harvested</span><b>${fmtInt(w.player.lightTotal)}</b></div>
          <div class="stat"><span>Grazes</span><b>${fmtInt(w.stats.grazes)}</b></div>
          <div class="stat"><span>Best chain</span><b>${w.stats.maxChain}</b></div>
          <div class="stat"><span>Stars relit</span><b>${w.stats.bossKills}</b></div>
          <div class="stat"><span>Score</span><b>${fmtInt(r.score)}</b></div>
          <div class="stat"><span>Embers earned</span><b class="light">+${r.embers}</b></div>${classXpStat(g)}
          <div class="faint">Seed <span class="mono">${esc(r.seed)}</span></div>
        </div>
        <button class="primary" data-nav data-autofocus data-act="again">Dive again <span class="kbd">R</span></button>
        <button data-nav data-act="hearth">Return to the Hearth</button>
        <button class="small" data-nav data-act="copyseed">Copy seed & score</button>
      </div>
      <div class="panel" style="width:min(520px,55vw);max-height:84vh;overflow:auto">${buildSummary(g)}</div>
    </div>`,
  );
}

export function showVictory(g: Game): void {
  const r = g.lastRecord!;
  const finalAct = !!g.run?.deep;
  g.ui.show(
    'victory',
    `<div class="col center" style="align-items:center;text-align:center;max-width:720px">
      <div class="logo" style="font-size:var(--s6)">${finalAct ? 'THE FIRST LIGHT BURNS' : 'THE LAST STAR BURNS'}</div>
      <p class="plate-line" style="font-size:var(--s3)">${finalAct ? 'The Night is unmade. Past the edge, the oldest light in the universe is yours to carry home.' : 'For now, the dark retreats. But past the Last Dark, something older is still hiding: the Deep.'}</p>
      <div class="panel" style="width:420px"><div class="stat"><span>Score</span><b>${fmtInt(r.score)}</b></div><div class="stat"><span>Embers</span><b class="light">+${r.embers}</b></div>${classXpStat(g)}<div class="stat"><span>Time</span><b>${Math.floor(r.timeSec / 60)}m ${r.timeSec % 60}s</b></div></div>
      <div class="row" style="margin-top:16px">${finalAct ? '' : '<button class="primary" data-nav data-autofocus data-act="deep">Into the Deep · Act II</button>'}<button ${finalAct ? 'class="primary" data-autofocus' : ''} data-nav data-act="endless">Go beyond · Endless</button><button data-nav data-act="hearth">Return home</button></div>
    </div>`,
  );
}

export function showCredits(g: Game): void {
  g.ui.show(
    'credits',
    `<div class="panel center col" style="width:min(640px,92vw);max-height:94vh;overflow:auto"><h1>Credits</h1>
      <p>Copyright © 2026 Digital Dro. All rights reserved.</p>
      <p>LAST LIGHT — design, code, shaders, VFX and synthesized sound effects generated in-engine.</p>
      <p><b>Music</b> by Digital Dro, created using Suno during a premium subscription: Last Analog Dawn, Proximity to Earth I &amp; II, Warp Drive, Void Engagements, Void Leviathan, Last Transmission. The procedural in-engine score remains available under Settings → Audio.</p>
      <p class="dim">Rendering: three.js (MIT). Desktop: Electron (MIT). Fonts: Archivo, JetBrains Mono, Silkscreen (SIL Open Font License) via Fontsource.</p>
      <p class="dim">Every model is procedural geometry and every sound effect is synthesized with the Web Audio API. See CREDITS.md and third-party license notices included with the build.</p>
      <p class="faint">Mood references: Signalis, Return of the Obra Dinn, Chris Foss, Outer Wilds. No assets copied.</p>
      <button data-nav data-autofocus data-act="title" data-back>Back</button></div>`,
  );
}

export function showCodex(g: Game): void {
  const d = g.save.data;
  const tab = g.codexTab;
  let body: string;
  const unk = '<span class="faint">???</span>';
  if (tab === 'enemies') {
    body = ENEMIES.map((e) => {
      const k = d.codex.enemies.includes(e.id);
      return `<div class="item ${k ? '' : 'disabled'}" style="--rc:${e.accent}"><div class="ic">●</div><div class="grow"><div class="t">${k ? esc(e.name) : unk} <span class="faint">${k ? e.faction : ''}</span></div><div class="d">${k ? esc(e.desc) + (SUBTYPES[e.id] ? `<br><span class="faint">Variants: ${SUBTYPES[e.id]!.map((s) => s.name + (s.moves.length ? ' (' + s.moves.join(', ') + ')' : '')).join(' · ')}</span>` : '') : 'Not yet encountered.'}</div></div></div>`;
    }).join('') + `<h3 style="margin-top:12px">Rarities</h3>` + RARITY.slice(1).map((r, i) => `<div class="stat"><span style="color:${r.color}">${r.name}</span><span class="dim">${['1 affix', '2–3 affixes', '3–4 affixes and a name'][i]} · ×${r.hp} HP · ×${r.light} Light</span></div>`).join('') + `<h3 style="margin-top:12px">Affixes · ${AFFIXES.length}</h3>` + AFFIXES.map((x) => `<div class="stat"><span>${x.name}</span><span class="dim">${x.desc}</span></div>`).join('') +
      `<h3 style="margin-top:12px">Drop table · chance per kill</h3><div class="dim" style="margin-bottom:6px">Rarity multiplies these: Magic ×${RARITY_DROP[1]}, Rare ×${RARITY_DROP[2]}, Unique ×${RARITY_DROP[3]}. Gilded doubles them; Luck adds 15% per point.</div>` +
      `<div class="droptable"><div class="dt-h"><span></span>${DROP_KINDS.map((k) => `<span style="color:${DROP_INFO[k].color}">${DROP_INFO[k].name}</span>`).join('')}</div>` +
      (Object.keys(DROP_TABLE) as (keyof typeof DROP_TABLE)[]).map((cls) => `<div class="dt-r"><span>${cls}</span>${DROP_KINDS.map((k) => `<span class="mono">${DROP_TABLE[cls][k] >= 1 ? '100%' : (DROP_TABLE[cls][k] * 100).toFixed(DROP_TABLE[cls][k] < 0.01 ? 2 : 1) + '%'}</span>`).join('')}</div>`).join('') + '</div>' +
      `<h3 style="margin-top:12px">Bosses</h3>` + Object.values(BOSSES).map((b) => `<div class="item ${d.bossesKilled.includes(b.id) ? '' : 'disabled'}"><div class="ic">☀</div><div class="grow"><div class="t">${d.bossesKilled.includes(b.id) ? b.name : unk}</div><div class="d">${d.bossesKilled.includes(b.id) ? esc(b.desc) : esc(b.title)}</div></div></div>`).join('');
  } else if (tab === 'weapons') {
    body = WEAPONS.map((w) => {
      const k = d.codex.weapons.includes(w.id);
      return `<div class="item ${k ? '' : 'disabled'}"><div class="ic">${FAMILY_ICON[w.family]}</div><div class="grow"><div class="t">${k ? esc(w.name) : unk} <span class="faint">${w.family}</span></div><div class="d">${k ? esc(w.desc) + `<br>Evolves with <b>${w.evolve.tag}</b> into <span class="light">${esc(w.evolve.name)}</span>` : 'Undiscovered.'}</div></div></div>`;
    }).join('');
  } else if (tab === 'upgrades') {
    body = UPGRADES.map((u) => {
      const k = d.codex.items.includes(u.id);
      return `<div class="item ${k ? '' : 'disabled'}" style="--rc:var(--c-${u.rarity})"><div class="ic">◆</div><div class="grow"><div class="t">${k ? esc(u.name) : unk} <span class="faint">${u.rarity}</span></div><div class="d">${k ? esc(u.desc) : ''}</div></div></div>`;
    }).join('');
  } else if (tab === 'synergies') {
    body = SYNERGIES.map((s) => {
      const k = d.codex.synergies.includes(s.id);
      const needs = Object.entries(s.needs).map(([t, n]) => `${n}× ${t}`).join(' + ');
      return `<div class="item ${k ? '' : 'disabled'}"><div class="ic">${s.kind === 'reaction' ? '⚗' : '✦'}</div><div class="grow"><div class="t">${k ? esc(s.name) : unk} <span class="faint">${s.kind}</span></div><div class="d">${k ? esc(s.desc) : s.kind === 'synergy' ? `Needs ${needs}` : 'Combine statuses to discover.'}</div></div></div>`;
    }).join('');
  } else {
    body = LORE.map((l) => {
      const k = d.codex.lore.includes(l.id);
      return `<div class="item ${k ? '' : 'disabled'}"><div class="ic">❦</div><div class="grow"><div class="t">${k ? esc(l.title) : unk}</div><div class="d">${k ? esc(l.text) : 'Found in derelicts and events.'}</div></div></div>`;
    }).join('');
  }
  const count = (a: string[], all: number) => `${a.length}/${all}`;
  const tabs: [string, string][] = [
    ['enemies', count(d.codex.enemies, ENEMIES.length)],
    ['weapons', count(d.codex.weapons, WEAPONS.length)],
    ['upgrades', count(d.codex.items, UPGRADES.length)],
    ['synergies', count(d.codex.synergies, SYNERGIES.length)],
    ['lore', count(d.codex.lore, LORE.length)],
  ];
  g.ui.refresh(
    'codex',
    `<div class="panel center col" style="width:min(860px,94vw);max-height:92vh">
      <h1>Codex</h1>
      <div class="tabs">${tabs.map(([t, c]) => `<button class="${t === tab ? 'on' : ''}" data-nav data-act="ctab" data-arg="${t}">${t} ${c}</button>`).join('')}</div>
      <div class="scroll col" style="max-height:66vh">${body}</div>
      <button data-nav data-act="back" data-back>Back</button></div>`,
  );
}

function slider(label: string, key: string, v: number, min: number, max: number, step: number, fmt = (x: number) => x.toFixed(2)): string {
  return `<div class="setting"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-input="set" data-key="${key}" data-nav><span class="v">${fmt(v)}</span></div>`;
}
function toggle(label: string, key: string, v: boolean): string {
  return `<div class="setting"><span>${label}</span><button class="switch ${v ? 'on' : ''}" role="switch" aria-checked="${v}" aria-label="${label}" data-nav data-act="toggle" data-arg="${key}"></button><span class="v">${v ? 'On' : 'Off'}</span></div>`;
}
function select(label: string, key: string, v: string, opts: [string, string][]): string {
  return `<div class="setting"><span>${label}</span><select data-change="set" data-key="${key}" data-nav>${opts.map(([k, n]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>`;
}

export function showSettings(g: Game, refresh = false): void {
  const s = g.settings;
  const tab = g.settingsTab;
  let body: string;
  if (tab === 'video') {
    body = select('Quality', 'quality', s.quality, [['auto', 'Auto (adaptive)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']]) +
      select('Ship lights', 'shipGlow', s.shipGlow, (Object.keys(SHIP_GLOW) as ShipGlow[]).map((k) => [k, SHIP_GLOW[k].label])) +
      slider('Field of view', 'fov', s.fov, 55, 100, 1, (x) => x.toFixed(0)) + toggle('CRT scanlines', 'scanlines', s.scanlines) + toggle('Cockpit camera (V)', 'cockpit', s.cockpit);
  } else if (tab === 'audio') {
    body = select('Music', 'music', s.music, [['recorded', 'Soundtrack · digitaldro'], ['procedural', 'Procedural score']]) + slider('Master', 'volumes.master', s.volumes.master, 0, 1, 0.05) + slider('Music', 'volumes.music', s.volumes.music, 0, 1, 0.05) + slider('Effects', 'volumes.sfx', s.volumes.sfx, 0, 1, 0.05) +
      slider('Interface', 'volumes.ui', s.volumes.ui, 0, 1, 0.05) + slider('Ambience', 'volumes.ambience', s.volumes.ambience, 0, 1, 0.05) + toggle('Mono audio', 'mono', s.mono) + toggle('Visual cues for sounds', 'visualCues', s.visualCues);
  } else if (tab === 'controls') {
    body = slider('Mouse/stick sensitivity', 'sensitivity', s.sensitivity, 0.2, 3, 0.05) + toggle('Invert Y', 'invertY', s.invertY) + slider('Aim assist', 'aimAssist', s.aimAssist, 0, 1, 0.05) +
      toggle('Auto-level', 'autoLevel', s.autoLevel) + toggle('Boost: toggle instead of hold', 'boostToggle', s.boostToggle) +
      `<h3 style="margin-top:12px">Bindings · click then press a key/button</h3>` +
      (Object.keys(ACTION_LABELS) as Action[]).map((a) => `<div class="setting"><span>${ACTION_LABELS[a]}</span><button class="small" data-nav data-act="rebind" data-arg="${a}">${s.bindings[a].map(Input.codeLabel).join(' / ')}</button><span></span></div>`).join('') +
      `<button class="small" data-nav data-act="resetbind">Reset bindings</button>`;
  } else if (tab === 'access') {
    body = slider('Screen shake', 'shake', s.shake, 0, 1.5, 0.05) + slider('Flash intensity', 'flash', s.flash, 0, 1, 0.05) + toggle('Reduced motion', 'reducedMotion', s.reducedMotion) +
      select('Colorblind shot tones', 'colorblind', s.colorblind, [['default', 'Default'], ['deuteranopia', 'Deuteranopia'], ['protanopia', 'Protanopia'], ['tritanopia', 'Tritanopia']]) +
      slider('UI scale', 'uiScale', s.uiScale, 0.75, 1.6, 0.05) + toggle('Damage numbers', 'damageNumbers', s.damageNumbers) + slider('Game speed (assist)', 'gameSpeed', s.gameSpeed, 0.5, 1, 0.05);
  } else {
    body = `<p class="dim">Saves live in this browser (IndexedDB, localStorage fallback). Export a code to back up or move your progress.</p>
      <button class="small" data-nav data-act="export">Export save</button>
      <textarea id="savecode" placeholder="Paste a save code here"></textarea>
      <div class="row"><button class="small" data-nav data-act="import">Import save</button><button class="small" data-nav data-act="wipe">Erase progress</button></div>`;
  }
  const tabs = ['video', 'audio', 'controls', 'access', 'data'];
  const html = `<div class="panel center col" style="width:min(760px,94vw);max-height:92vh">
    <h1>Settings</h1>
    <div class="tabs">${tabs.map((t) => `<button class="${t === tab ? 'on' : ''}" data-nav data-act="stab" data-arg="${t}">${t === 'access' ? 'accessibility' : t}</button>`).join('')}</div>
    <div class="scroll" style="max-height:66vh">${body}</div>
    <button data-nav data-act="back" data-back data-sfx="back">Back</button></div>`;
  if (refresh) g.ui.refresh('settings', html);
  else g.ui.show('settings', html);
}

/** Wire every data-act action to the game. */
export function registerActions(g: Game): void {
  const ui = g.ui;
  registerClassActions(g);
  let settingsReturn: () => void = () => showTitle(g);
  let codexReturn: () => void = () => showTitle(g);
  ui.on('maporbit', (v) => { g.mapYaw = Math.max(-0.8, Math.min(0.8, g.mapYaw + Number(v) * 0.2)); });
  ui.on('mapzoom', (v) => { g.mapZoom = Math.max(0.75, Math.min(1.45, g.mapZoom + Number(v) * 0.12)); });
  ui.on('mapreset', () => { g.mapYaw = 0; g.mapPitch = 1.03; g.mapZoom = 1; });
  ui.on('hearth', () => g.goHearth());
  ui.on('title', () => g.goTitle());
  ui.on('quickdive', () => g.startRun());
  ui.on('dive', () => g.startRun());
  ui.on('daily', () => g.startRun({ daily: true }));
  ui.on('credits', () => {
    g.setState('credits');
    showCredits(g);
  });
  ui.on('codex', () => {
    const from = g.state;
    codexReturn = from === 'hearth' ? () => g.goHearth() : () => g.goTitle();
    g.setState('codex');
    showCodex(g);
  });
  ui.on('ctab', (a) => {
    g.codexTab = a;
    showCodex(g);
  });
  ui.on('settings', () => {
    const from = g.state;
    settingsReturn = from === 'pause' ? () => {
      g.setState('pause');
      showPause(g);
    } : () => g.goTitle();
    g.setState('settings');
    showSettings(g);
  });
  ui.on('stab', (a) => {
    g.settingsTab = a;
    showSettings(g, true);
  });
  ui.on('back', () => {
    if (g.state === 'settings') {
      g.save.save();
      settingsReturn();
    } else if (g.state === 'codex') codexReturn();
    else g.goTitle();
  });
  ui.on('set', (v, el) => {
    const key = el.dataset.key!;
    const s = g.settings as unknown as Record<string, unknown>;
    const num = Number(v);
    const val = isNaN(num) || key === 'quality' || key === 'colorblind' || key === 'music' || key === 'shipGlow' ? v : num;
    if (key.startsWith('volumes.')) (s.volumes as Record<string, number>)[key.slice(8)] = num;
    else s[key] = val;
    const label = el.parentElement?.querySelector('.v');
    if (label) label.textContent = typeof val === 'number' ? (key === 'fov' ? val.toFixed(0) : val.toFixed(2)) : '';
    g.applySettings();
    g.save.save();
  });
  ui.on('toggle', (k) => {
    const s = g.settings as unknown as Record<string, boolean>;
    s[k] = !s[k];
    g.applySettings();
    g.save.save();
    showSettings(g, true);
  });
  ui.on('rebind', (a, el) => {
    el.textContent = 'PRESS…';
    g.input.captureNext = (code) => {
      if (code !== 'Escape') {
        const action = a as Action;
        const isPad = code.startsWith('Pad');
        g.settings.bindings[action] = [...g.settings.bindings[action].filter((binding) => binding.startsWith('Pad') !== isPad), code];
      }
      g.applySettings();
      g.save.save();
      showSettings(g, true);
    };
  });
  ui.on('resetbind', () => {
    import('../core/input').then((m) => {
      g.settings.bindings = structuredClone(m.DEFAULT_BINDINGS);
      g.applySettings();
      g.save.save();
      showSettings(g, true);
    });
  });
  ui.on('export', () => {
    const ta = document.getElementById('savecode') as HTMLTextAreaElement;
    ta.value = g.save.export();
    ta.select();
    navigator.clipboard?.writeText(ta.value).catch(() => {});
  });
  ui.on('import', () => {
    const ta = document.getElementById('savecode') as HTMLTextAreaElement;
    const ok = g.save.import(ta.value);
    g.audio.play(ok ? 'uiBuy' : 'uiDeny');
    if (ok) g.applySettings();
  });
  ui.on('wipe', (_a, el) => {
    if (el.dataset.confirm) {
      g.save.reset();
      g.goTitle();
    } else {
      el.dataset.confirm = '1';
      el.textContent = 'Click again to erase';
    }
  });
  ui.on('htab', (a) => {
    g.hearthTab = a;
    showHearth(g, true);
  });
  ui.on('unlock', (a) => g.buyUnlock(a));
  ui.on('hull', (a) => g.buyHull(a));
  ui.on('weapon', (a) => {
    if (g.save.data.weapons.includes(a)) {
      if (g.save.unlockLevel('l_pick') > 0 && WEAPON_BY_ID[a]!.slot === 'primary') {
        g.selectedPrimary = g.selectedPrimary === a ? '' : a;
        showHearth(g, true);
      }
    } else g.buyWeapon(a);
  });
  ui.on('heat', (a) => {
    const i = Number(a);
    if (i === 0 || (g.save.data.heatUnlocked && i <= g.save.data.maxHeat)) {
      g.selectedHeat = i;
      showHearth(g, true);
    } else g.audio.play('uiDeny');
  });
  ui.on('node', (a) => g.chooseNode(Number(a)));
  ui.on('inventory', () => g.openInventory());
  ui.on('closeinventory', () => g.closeInventory());
  ui.on('equipsalvage', (a) => g.equipSalvage(a));
  ui.on('unequipsalvage', (a) => g.unequipSalvage(a));
  ui.on('effecttarget', (a) => {
    const [side, index] = a.split(':');
    if ((side === 'port' || side === 'starboard') && (index === '0' || index === '1')) {
      g.effectTarget = { side, index: Number(index) as 0 | 1 };
      showInventory(g, true);
    }
  });
  ui.on('installeffect', (a) => g.installSalvageEffect(a));
  ui.on('removeeffect', () => g.removeSalvageEffect());
  ui.on('pausemenu', () => {
    g.setState('pause');
    showPause(g);
  });
  ui.on('pick', (a) => g.pickCard(Number(a)));
  ui.on('banish', (a) => g.banishCard(Number(a)));
  ui.on('reroll', () => g.rerollDraft());
  ui.on('skip', () => g.skipDraft());
  ui.on('buy', (a) => g.buy(Number(a)));
  ui.on('leave', () => {
    if (g.state === 'event' && g.run?.pendingFight) return;
    g.openMap();
  });
  ui.on('choice', (a) => g.chooseEvent(Number(a)));
  ui.on('forge', (a) => {
    const [k, arg] = a.split(':');
    g.forgeAction(k!, arg ?? '');
  });
  ui.on('rest', (a) => {
    const [k, arg] = a.split(':');
    g.restAction(k!, arg ?? '');
  });
  ui.on('resume', () => {
    if (g.prevState === 'map' || (g.state === 'pause' && !g.director)) {
      g.openMap();
      return;
    }
    g.resume();
  });
  ui.on('abandon', () => g.abandonRun());
  ui.on('again', () => g.startRun({ hull: g.run?.hull, heat: g.run?.heat }));
  ui.on('copyseed', () => {
    const r = g.lastRecord;
    if (r) navigator.clipboard?.writeText(`LAST LIGHT · seed ${r.seed} · ${r.won ? 'WON' : 'sector ' + r.sector} · score ${r.score}${r.daily ? ' · daily' : ''}`).catch(() => {});
  });
  ui.on('endless', () => g.startEndless());
  ui.on('deep', () => g.startDeep());
  ui.on('endlessrun', () => g.startRun({ endless: true }));
  ui.onBack = () => {
    if (g.state === 'map') {
      g.setState('pause');
      showPause(g);
    }
  };
  // number keys pick draft cards
  window.addEventListener('keydown', (e) => {
    if (g.state === 'draft' && /^Digit[1-4]$/.test(e.code)) g.pickCard(Number(e.code.slice(5)) - 1);
  });
  void PALETTES;
}
