import type { MoveId } from '../game/moves';

/**
 * Subtypes: every enemy type spawns as one of 2-3 named variants with its own
 * signature moves (src/game/moves.ts) on top of its role, and small stat
 * leanings. The variant name shows on the target plate ("GUNSHIP · STRAFER").
 */
export interface SubtypeDef {
  id: string;
  name: string;
  moves: MoveId[];
  /** spawn weight */
  w: number;
  speed?: number;
  hp?: number;
  fire?: number;
  /** first sector (0-based) this variant appears in */
  minSector?: number;
}

export const SUBTYPES: Record<string, SubtypeDef[]> = {
  // --- Hush
  moteeater: [
    { id: 'drifter', name: 'Drifter', moves: [], w: 3 },
    { id: 'diver', name: 'Diver', moves: ['dive'], w: 2, speed: 1.1 },
    { id: 'skitter', name: 'Skitter', moves: ['evade'], w: 1, minSector: 1 },
  ],
  gloom: [
    { id: 'lunger', name: 'Lunger', moves: ['ram'], w: 2 },
    { id: 'trickster', name: 'Trickster', moves: ['feint', 'evade'], w: 2 },
    { id: 'stalker', name: 'Stalker', moves: ['flank', 'ram'], w: 1, minSector: 2 },
  ],
  umbra: [
    { id: 'lance', name: 'Lance', moves: ['retreat'], w: 2 },
    { id: 'sweeper', name: 'Sweeper', moves: ['sweep', 'evade'], w: 2, minSector: 1 },
    { id: 'phantom', name: 'Phantom', moves: ['blink', 'snipe'], w: 1, minSector: 3 },
  ],
  hollow: [
    { id: 'husk', name: 'Husk', moves: ['ring'], w: 2 },
    { id: 'bloater', name: 'Bloater', moves: ['dive'], w: 2, hp: 1.3, speed: 0.85 },
  ],
  mawspawn: [
    { id: 'brood', name: 'Brood', moves: ['call'], w: 2 },
    { id: 'gullet', name: 'Gullet', moves: ['orb', 'retreat'], w: 1 },
  ],
  whisper: [
    { id: 'echo', name: 'Echo', moves: ['dive'], w: 2 },
    { id: 'wraithling', name: 'Wraithling', moves: ['blink', 'dive'], w: 1, minSector: 3 },
  ],
  eclipse: [
    { id: 'corona', name: 'Corona', moves: ['spiral'], w: 2 },
    { id: 'umbral', name: 'Umbral', moves: ['artillery', 'retreat'], w: 2 },
  ],
  nullwisp: [
    { id: 'mote', name: 'Mote', moves: ['evade'], w: 2 },
    { id: 'needle', name: 'Needle', moves: ['burst', 'dash'], w: 2 },
    { id: 'shade', name: 'Shade', moves: ['flank', 'orb'], w: 1, minSector: 2 },
  ],
  shroud: [
    { id: 'veil', name: 'Veil', moves: ['bulwark'], w: 2 },
    { id: 'pall', name: 'Pall', moves: ['ring', 'retreat'], w: 1 },
  ],
  // --- Salvage
  scrapper: [
    { id: 'cutter', name: 'Cutter', moves: [], w: 3 },
    { id: 'buzzer', name: 'Buzzer', moves: ['dive'], w: 2, speed: 1.15 },
    { id: 'sapper', name: 'Sapper', moves: ['mines'], w: 1, minSector: 1 },
  ],
  ramdrone: [
    { id: 'battering', name: 'Battering Ram', moves: ['ram'], w: 2, hp: 1.2 },
    { id: 'jinker', name: 'Jinker', moves: ['dash', 'ram'], w: 2 },
  ],
  surveyor: [
    { id: 'spotter', name: 'Spotter', moves: ['retreat', 'evade'], w: 2 },
    { id: 'marksman', name: 'Marksman', moves: ['snipe', 'dash'], w: 2, minSector: 1 },
    { id: 'spotter2', name: 'Artillerist', moves: ['artillery'], w: 1, minSector: 2 },
  ],
  gunship: [
    { id: 'strafer', name: 'Strafer', moves: ['dash', 'burst'], w: 2 },
    { id: 'bombard', name: 'Bombard', moves: ['artillery', 'fan'], w: 2, speed: 0.85, hp: 1.15 },
    { id: 'hunter', name: 'Hunter', moves: ['flank', 'orb'], w: 1, minSector: 2 },
  ],
  bulwark: [
    { id: 'aegis', name: 'Aegis', moves: ['bulwark'], w: 2 },
    { id: 'rampart', name: 'Rampart', moves: ['fan', 'bulwark'], w: 1, minSector: 2 },
  ],
  rivet: [
    { id: 'layer', name: 'Layer', moves: ['mines', 'evade'], w: 2 },
    { id: 'trapper', name: 'Trapper', moves: ['mines', 'flank'], w: 1, minSector: 1 },
  ],
  welder: [
    { id: 'mender', name: 'Mender', moves: ['retreat', 'evade'], w: 2 },
    { id: 'foreman', name: 'Shift Boss', moves: ['call', 'retreat'], w: 1, minSector: 2 },
  ],
  hauler: [
    { id: 'barge', name: 'Barge', moves: ['call'], w: 2 },
    { id: 'gunbarge', name: 'Gun Barge', moves: ['fan', 'ring'], w: 1 },
  ],
  turretrig: [
    { id: 'battery', name: 'Battery', moves: ['burst'], w: 2 },
    { id: 'flak', name: 'Flak', moves: ['artillery'], w: 1, minSector: 1 },
  ],
  cutter: [
    { id: 'flanker', name: 'Flanker', moves: ['flank', 'dash'], w: 2 },
    { id: 'harrier', name: 'Harrier', moves: ['dive', 'burst'], w: 2 },
  ],
  // --- Choir
  shardling: [
    { id: 'splinter', name: 'Splinter', moves: [], w: 3 },
    { id: 'diver', name: 'Glass Diver', moves: ['dive'], w: 2, speed: 1.1 },
    { id: 'flicker', name: 'Flicker', moves: ['blink'], w: 1, minSector: 3 },
  ],
  cantor: [
    { id: 'tenor', name: 'Tenor', moves: ['fan'], w: 2 },
    { id: 'alto', name: 'Alto', moves: ['spiral', 'evade'], w: 2 },
    { id: 'bass', name: 'Bass', moves: ['ring', 'orb'], w: 1, minSector: 3, hp: 1.2 },
  ],
  hymnlancer: [
    { id: 'psalm', name: 'Psalm', moves: ['retreat'], w: 2 },
    { id: 'litany', name: 'Litany', moves: ['sweep', 'blink'], w: 1, minSector: 2 },
  ],
  prismwarden: [
    { id: 'lens', name: 'Lens', moves: ['bulwark'], w: 2 },
    { id: 'mirror', name: 'Mirror', moves: ['ring', 'bulwark'], w: 1 },
  ],
  chorale: [
    { id: 'soothe', name: 'Soothsinger', moves: ['retreat', 'evade'], w: 2 },
    { id: 'choirmaster', name: 'Choirmaster', moves: ['call', 'blink'], w: 1, minSector: 3 },
  ],
  facet: [
    { id: 'shard', name: 'Cleaved', moves: ['ring'], w: 2 },
    { id: 'gem', name: 'Faceted', moves: ['dash', 'fan'], w: 1 },
  ],
  resonator: [
    { id: 'bell', name: 'Bell', moves: ['spiral'], w: 2 },
    { id: 'gong', name: 'Gong', moves: ['artillery', 'ring'], w: 1, minSector: 3 },
  ],
  seraph: [
    { id: 'wing', name: 'Wing', moves: ['dash', 'burst'], w: 2 },
    { id: 'herald', name: 'Herald', moves: ['flank', 'sweep'], w: 1, minSector: 2 },
    { id: 'choir', name: 'Thrice-Winged', moves: ['blink', 'orb', 'evade'], w: 1, minSector: 3 },
  ],
  lure: [
    { id: 'glint', name: 'Glint', moves: ['dive'], w: 2 },
    { id: 'siren', name: 'Siren', moves: ['blink', 'dive'], w: 1 },
  ],
  // --- the Deep
  sparkler: [
    { id: 'ember', name: 'Ember', moves: ['dive'], w: 2 },
    { id: 'slag', name: 'Slag', moves: ['mines'], w: 1 },
  ],
  smelter: [
    { id: 'pourer', name: 'Pourer', moves: ['artillery'], w: 2 },
    { id: 'furnace', name: 'Furnace', moves: ['spiral', 'bulwark'], w: 1 },
  ],
  tidewraith: [
    { id: 'eddy', name: 'Eddy', moves: ['evade', 'burst'], w: 2 },
    { id: 'undertow', name: 'Undertow', moves: ['flank', 'orb'], w: 1 },
  ],
  spaghettifier: [
    { id: 'tidal', name: 'Tidal', moves: ['sweep'], w: 2 },
    { id: 'stretcher', name: 'Stretcher', moves: ['blink', 'snipe'], w: 1 },
  ],
  gravemind: [
    { id: 'well', name: 'Well', moves: ['call'], w: 2 },
    { id: 'maw', name: 'Maw', moves: ['orb', 'ring'], w: 1 },
  ],
  jetwing: [
    { id: 'lancer', name: 'Jet Lancer', moves: ['dash', 'burst'], w: 2 },
    { id: 'raptor', name: 'Raptor', moves: ['dive', 'fan'], w: 2 },
  ],
  regentguard: [
    { id: 'herald', name: 'Herald', moves: ['fan', 'bulwark'], w: 2 },
    { id: 'executor', name: 'Executor', moves: ['snipe', 'flank'], w: 1 },
  ],
  lodestone: [
    { id: 'anchor', name: 'Anchor', moves: ['bulwark'], w: 2 },
    { id: 'repulsor', name: 'Repulsor', moves: ['ring', 'retreat'], w: 1 },
  ],
  railbug: [
    { id: 'spotter', name: 'Spotter', moves: ['snipe', 'evade'], w: 2 },
    { id: 'gauss', name: 'Gauss', moves: ['snipe', 'blink'], w: 1 },
  ],
  nightmask: [
    { id: 'grin', name: 'Grin', moves: ['ram', 'blink'], w: 2 },
    { id: 'weeper', name: 'Weeper', moves: ['feint', 'orb'], w: 1 },
  ],
  riftling: [
    { id: 'shard', name: 'Shard', moves: [], w: 3 },
    { id: 'skipper', name: 'Skipper', moves: ['blink'], w: 1 },
  ],
  unmaker: [
    { id: 'unweaver', name: 'Unweaver', moves: ['ring', 'spiral'], w: 2 },
    { id: 'eraser', name: 'Eraser', moves: ['artillery', 'call'], w: 1 },
  ],
};

/** Display name for an enemy's variant, or '' */
export function subtypeName(defId: string, idx: number): string {
  return idx >= 0 ? (SUBTYPES[defId]?.[idx]?.name ?? '') : '';
}

/** Pick a subtype index for an enemy (weighted, sector-gated). -1 when none. */
export function pickSubtype(id: string, sector: number, roll: (weights: number[]) => number): number {
  const list = SUBTYPES[id];
  if (!list?.length) return -1;
  const w = list.map((s) => ((s.minSector ?? 0) <= sector ? s.w : 0));
  if (w.every((x) => x <= 0)) return 0;
  return roll(w);
}
