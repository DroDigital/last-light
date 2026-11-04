import { AFFIX_BY_ID, type AffixId } from './affixes';
import type { EnemyDef } from '../game/types';

/** 28 enemy types across three factions (+ asteroids). */
export const ENEMIES: EnemyDef[] = [
  // ---------------- THE HUSH: entropy that eats light. Dissolve into static. ----------------
  { id: 'moteeater', name: 'Mote-Eater', faction: 'hush', role: 'swarmer', mesh: 'hushSpike', scale: 0.9, hp: 18, speed: 34, radius: 1.2, contact: 8, accent: '#9a70ff', light: 2, threat: 1, desc: 'Swarms toward light. Fragile alone, smothering in packs.' },
  { id: 'gloom', name: 'Gloom', faction: 'hush', role: 'charger', mesh: 'hushDart', scale: 1.1, hp: 40, speed: 26, radius: 1.5, contact: 16, accent: '#c060ff', light: 4, threat: 3, desc: 'Telegraphs, then lunges. Dodge through it.' },
  { id: 'umbra', name: 'Umbra Lance', faction: 'hush', role: 'lancer', mesh: 'hushEye', scale: 1.1, hp: 60, speed: 14, radius: 2, contact: 10, accent: '#ff60c0', light: 6, threat: 4, desc: 'Charges a line of darkness. Watch the red line.', fire: { rate: 0.25, speed: 0, count: 1, spread: 0, kind: 1, damage: 22 } },
  { id: 'hollow', name: 'Hollow', faction: 'hush', role: 'splitter', mesh: 'hushBlob', scale: 1.2, hp: 70, speed: 16, radius: 2.2, contact: 14, accent: '#8a60e0', light: 5, threat: 3, desc: 'Splits into Mote-Eaters when broken.' },
  { id: 'mawspawn', name: 'Maw Spawn', faction: 'hush', role: 'carrier', mesh: 'hushBlob', scale: 1.8, hp: 160, speed: 9, radius: 3.4, contact: 20, accent: '#d050ff', light: 12, threat: 7, desc: 'A drifting womb that births swarmers. Kill it first.' },
  { id: 'whisper', name: 'Whisper', faction: 'hush', role: 'mimic', mesh: 'hushSpike', scale: 0.8, hp: 26, speed: 40, radius: 1.2, contact: 18, accent: '#ffffff', light: 6, threat: 2, desc: 'Disguised as a Light mote. Strikes when you come close.', minSector: 2 },
  { id: 'eclipse', name: 'Eclipse', faction: 'hush', role: 'bomber', mesh: 'hushEye', scale: 1.5, hp: 110, speed: 10, radius: 2.8, contact: 12, accent: '#a050ff', light: 9, threat: 5, desc: 'Releases slow rings of dark bullets.', fire: { rate: 0.4, speed: 22, count: 16, spread: 0, kind: 1, damage: 10 } },
  { id: 'nullwisp', name: 'Null Wisp', faction: 'hush', role: 'orbiter', mesh: 'hushDart', scale: 0.9, hp: 34, speed: 26, radius: 1.3, contact: 8, accent: '#b080ff', light: 4, threat: 2, desc: 'Circles you, spitting diamond shards.', fire: { rate: 1.2, speed: 45, count: 1, spread: 0, kind: 2, damage: 8 } },
  { id: 'shroud', name: 'Shroud', faction: 'hush', role: 'shielder', mesh: 'hushEye', scale: 1.3, hp: 90, speed: 14, radius: 2.4, contact: 10, armor: 2, accent: '#7040c0', light: 8, threat: 5, desc: 'Veils nearby Hush in a light-eating shield.', minSector: 2 },

  // ---------------- SALVAGE DRONES: rogue mining machines. Fracture into parts. ----------------
  { id: 'scrapper', name: 'Scrapper', faction: 'salvage', role: 'swarmer', mesh: 'salvBox', scale: 0.8, hp: 22, speed: 30, radius: 1.2, contact: 8, armor: 1, accent: '#ffa040', light: 2, threat: 1, desc: 'Cheap cutting drones. They come in dozens.' },
  { id: 'ramdrone', name: 'Ram Drone', faction: 'salvage', role: 'charger', mesh: 'salvRam', scale: 1.1, hp: 55, speed: 24, radius: 1.6, contact: 22, armor: 3, accent: '#ff8030', light: 4, threat: 3, desc: 'A drill on an engine. Flashes before it charges.' },
  { id: 'surveyor', name: 'Surveyor', faction: 'salvage', role: 'sniper', mesh: 'salvGun', scale: 1, hp: 45, speed: 18, radius: 1.6, contact: 8, armor: 1, accent: '#ffc060', light: 5, threat: 3, desc: 'Keeps its distance and fires telegraphed survey bolts.', fire: { rate: 0.5, speed: 110, count: 1, spread: 0, kind: 2, damage: 14 } },
  { id: 'gunship', name: 'Gunship', faction: 'salvage', role: 'gunner', mesh: 'salvGun', scale: 1.4, hp: 90, speed: 18, radius: 2.2, contact: 10, armor: 2, accent: '#ff9040', light: 8, threat: 4, desc: 'Strafes and fires three-round bursts.', fire: { rate: 0.7, speed: 60, count: 3, spread: 0.12, kind: 1, damage: 9 } },
  { id: 'bulwark', name: 'Bulwark', faction: 'salvage', role: 'shielder', mesh: 'salvHauler', scale: 0.9, hp: 140, speed: 12, radius: 2.8, contact: 12, armor: 5, accent: '#ffb060', light: 9, threat: 5, desc: 'Projects shields onto nearby drones.', minSector: 2 },
  { id: 'rivet', name: 'Rivet Layer', faction: 'salvage', role: 'minelayer', mesh: 'salvBox', scale: 1.2, hp: 60, speed: 20, radius: 1.8, contact: 10, armor: 2, accent: '#ff7040', light: 6, threat: 3, desc: 'Seeds proximity mines across the arena.' },
  { id: 'welder', name: 'Welder', faction: 'salvage', role: 'healer', mesh: 'salvBox', scale: 1, hp: 50, speed: 22, radius: 1.6, contact: 8, armor: 1, accent: '#80ff90', light: 6, threat: 3, desc: 'Repairs damaged drones. Priority target.' },
  { id: 'hauler', name: 'Hauler', faction: 'salvage', role: 'carrier', mesh: 'salvHauler', scale: 1.3, hp: 220, speed: 8, radius: 3.6, contact: 20, armor: 4, accent: '#ffa050', light: 14, threat: 7, desc: 'A mining barge that deploys Scrappers.' },
  { id: 'turretrig', name: 'Turret Rig', faction: 'salvage', role: 'turret', mesh: 'salvTurret', scale: 1.3, hp: 120, speed: 0, radius: 2.2, contact: 10, armor: 3, accent: '#ff8040', light: 8, threat: 4, desc: 'Bolted to an asteroid. Fires rotating volleys.', fire: { rate: 0.6, speed: 40, count: 6, spread: 0, kind: 2, damage: 9 } },
  { id: 'cutter', name: 'Cutter', faction: 'salvage', role: 'orbiter', mesh: 'salvRam', scale: 0.8, hp: 38, speed: 28, radius: 1.3, contact: 10, armor: 1, accent: '#ffb040', light: 4, threat: 2, desc: 'Fast flanker that circles and needles.', fire: { rate: 1, speed: 55, count: 1, spread: 0, kind: 2, damage: 7 }, minSector: 2 },

  // ---------------- THE CHOIR: crystalline beings drawn to light. Shatter into shards. ----------------
  { id: 'shardling', name: 'Shardling', faction: 'choir', role: 'swarmer', mesh: 'choirShard', scale: 0.9, hp: 20, speed: 38, radius: 1.1, contact: 8, accent: '#ff90d0', light: 3, threat: 1, desc: 'Singing splinters that dive at your light.' },
  { id: 'cantor', name: 'Cantor', faction: 'choir', role: 'gunner', mesh: 'choirPrism', scale: 1, hp: 70, speed: 16, radius: 2, contact: 10, accent: '#ffb0f0', light: 7, threat: 4, desc: 'Sings fans of glass bullets.', fire: { rate: 0.6, speed: 40, count: 5, spread: 0.3, kind: 2, damage: 8 } },
  { id: 'hymnlancer', name: 'Hymn Lancer', faction: 'choir', role: 'lancer', mesh: 'choirSeraph', scale: 1, hp: 65, speed: 18, radius: 1.8, contact: 10, accent: '#ff80b0', light: 7, threat: 4, desc: 'Focuses a hymn into a cutting beam.', fire: { rate: 0.3, speed: 0, count: 1, spread: 0, kind: 1, damage: 24 }, minSector: 2 },
  { id: 'prismwarden', name: 'Prism Warden', faction: 'choir', role: 'shielder', mesh: 'choirHalo', scale: 1.2, hp: 110, speed: 12, radius: 2.4, contact: 10, armor: 2, accent: '#e0a0ff', light: 9, threat: 5, desc: 'Refracts damage away from allies.' },
  { id: 'chorale', name: 'Chorale', faction: 'choir', role: 'healer', mesh: 'choirHalo', scale: 0.9, hp: 55, speed: 20, radius: 1.8, contact: 8, accent: '#a0ffd0', light: 7, threat: 3, desc: 'Its song mends cracked crystal.' },
  { id: 'facet', name: 'Facet', faction: 'choir', role: 'splitter', mesh: 'choirPrism', scale: 1.1, hp: 80, speed: 18, radius: 2, contact: 12, accent: '#ffa0e0', light: 6, threat: 3, desc: 'Breaks into Shardlings.' },
  { id: 'resonator', name: 'Resonator', faction: 'choir', role: 'bomber', mesh: 'choirHalo', scale: 1.6, hp: 130, speed: 9, radius: 3, contact: 12, accent: '#ff70d0', light: 10, threat: 5, desc: 'Pulses rings of resonance.', fire: { rate: 0.35, speed: 26, count: 20, spread: 0, kind: 2, damage: 9 } },
  { id: 'seraph', name: 'Seraph', faction: 'choir', role: 'orbiter', mesh: 'choirSeraph', scale: 1.1, hp: 60, speed: 26, radius: 1.8, contact: 10, accent: '#ffc0ff', light: 6, threat: 3, desc: 'Graceful, fast, and relentless.', fire: { rate: 0.9, speed: 50, count: 2, spread: 0.1, kind: 2, damage: 8 } },
  { id: 'lure', name: 'Lure', faction: 'choir', role: 'mimic', mesh: 'choirShard', scale: 0.8, hp: 30, speed: 42, radius: 1.1, contact: 16, accent: '#ffffff', light: 8, threat: 2, desc: 'A glint of Light that is not Light.', minSector: 3 },

  // ---------------- Neutral ----------------
  { id: 'asteroid', name: 'Asteroid', faction: 'none', role: 'inert', mesh: 'asteroid', scale: 3, hp: 80, speed: 0, radius: 3.2, contact: 6, accent: '#ff9050', light: 2, threat: 0, desc: 'Dead rock. Shatters into useful debris.' },
];

export const ENEMY_BY_ID: Record<string, EnemyDef> = Object.fromEntries(ENEMIES.map((e) => [e.id, e]));

/** Elite modifiers are the affix table (src/data/affixes.ts); kept as aliases for older call sites. */
export type EliteMod = AffixId;
export const ELITE_INFO = AFFIX_BY_ID;
