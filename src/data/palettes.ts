/**
 * Sector palettes. 16 colors each, stored as data so they can be tuned live
 * from the F1 debug panel. Reserved tones (player shots, enemy shots) are kept
 * outside every palette and composited after quantization.
 */
export interface PaletteDef {
  id: string;
  name: string;
  colors: string[];
  /** Nebula stroke tints (HDR multipliers applied in-scene before quantization). */
  nebula: [string, string, string];
  star: string;
  ambient: string;
  /** UI accent pair (readable on ink) used to tint the interface in this sector */
  ui: [string, string];
}

export const PALETTES: PaletteDef[] = [
  {
    id: 'cradle',
    name: 'Cradle Nebula (teal-magenta)',
    colors: [
      '#05040d', '#0d0a24', '#1a1040', '#2b1459', '#47186b', '#6e1f7a', '#a12a83', '#d64596',
      '#ff7bb0', '#0f2a3a', '#11485a', '#157078', '#22a39a', '#5fd3c0', '#b8f2e6', '#f4f0ff',
    ],
    nebula: ['#c4307f', '#1a9c98', '#4a1c8a'],
    star: '#ffd6f0',
    ambient: '#140a26',
    ui: ['#5fd3c0', '#d64596'],
  },
  {
    id: 'ember',
    name: 'Ember Giant (dying red)',
    colors: [
      '#070304', '#1a0707', '#300b0a', '#4d120c', '#6e1c0e', '#942a10', '#bb3f12', '#df5e17',
      '#f58b2a', '#ffb54d', '#ffd98a', '#fff3d6', '#2a1420', '#47233a', '#6a3a4c', '#9a6a6a',
    ],
    nebula: ['#d8401a', '#8a1c22', '#e88a2a'],
    star: '#ff9a50',
    ambient: '#1e0808',
    ui: ['#f58b2a', '#df5e17'],
  },
  {
    id: 'ice',
    name: 'White Dwarf (ice blue)',
    colors: [
      '#02040a', '#071122', '#0c1d38', '#13304f', '#1b4868', '#276483', '#3a84a0', '#57a5bc',
      '#7fc4d6', '#aee0ea', '#ddf5f8', '#ffffff', '#1d1a3a', '#3a3566', '#6b6aa0', '#a7a9d6',
    ],
    nebula: ['#3a8ac4', '#6a6ad0', '#9adcec'],
    star: '#eaf6ff',
    ambient: '#08121e',
    ui: ['#7fc4d6', '#a7a9d6'],
  },
  {
    id: 'pulsar',
    name: 'Violet Pulsar',
    colors: [
      '#040210', '#0f0626', '#1d0a3f', '#2e0f5c', '#44167b', '#5e1f99', '#7b2cb4', '#9b40cc',
      '#bd5fe0', '#dd8bf0', '#f5c4ff', '#fff0ff', '#0c1c3d', '#13336a', '#2a5dab', '#59a2e6',
    ],
    nebula: ['#8a30d8', '#2a5ad0', '#d060e0'],
    star: '#e8c8ff',
    ambient: '#0e0620',
    ui: ['#bd5fe0', '#59a2e6'],
  },
  {
    id: 'binary',
    name: 'Gold Binary',
    colors: [
      '#060403', '#171006', '#2b1d08', '#44300b', '#614510', '#835d15', '#a6781c', '#c99628',
      '#e6b63d', '#f8d468', '#fff0a8', '#fffbe8', '#10242a', '#1e4246', '#386a62', '#6aa08a',
    ],
    nebula: ['#d89a28', '#2a8a7a', '#a05a18'],
    star: '#fff0c0',
    ambient: '#141006',
    ui: ['#e6b63d', '#6aa08a'],
  },
  {
    id: 'hush',
    name: 'The Hush (near-monochrome)',
    colors: [
      '#000000', '#060608', '#0c0c10', '#141418', '#1d1d22', '#28282e', '#34343b', '#42424a',
      '#52525a', '#64646c', '#7a7a82', '#94949a', '#b0b0b4', '#cdcdd0', '#e8e8ea', '#3a2f4a',
    ],
    nebula: ['#5a5068', '#2a2a36', '#7a7088'],
    star: '#d8d0e8',
    ambient: '#060608',
    ui: ['#b0b0b4', '#7a7a82'],
  },
  {
    id: 'hearth',
    name: 'The Hearth (last warmth)',
    colors: [
      '#040308', '#0e0a18', '#1c1428', '#2e1c30', '#4a2830', '#6e3a2c', '#9a5228', '#c87028',
      '#e89a3a', '#ffc65a', '#ffe9a8', '#fff8ec', '#14213a', '#22365a', '#3c5a86', '#7a9ac0',
    ],
    nebula: ['#c86a28', '#2a4a8a', '#8a3a5a'],
    star: '#ffd890',
    ambient: '#100a10',
    ui: ['#e89a3a', '#7a9ac0'],
  },
];

export function paletteById(id: string): PaletteDef {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;
}

/**
 * Ink print (brutalist style A): ink, warm gray, paper. Used wherever light has
 * died: the menus/Hearth (as a paper negative), the death screen, the Hush.
 */
export const INK = ['#141414', '#968f84', '#ebe8e1'];
/** Signal orange: the one accent that is never dithered or quantized (HUD signals, hot light in ink scenes). */
export const SIGNAL = '#ff4f00';

/**
 * Reserved readability tones. Player fire is a cyan-white vector core with a
 * dithered halo; enemy fire is hot crimson rings/diamonds; signal orange is
 * reserved for UI and never used by either. Index 0 = default, others colorblind-safe.
 */
export const RESERVED_TONES = {
  default: { player: '#bff6ff', enemy: '#ff2e63', pickup: '#ffe9a0' },
  deuteranopia: { player: '#8fd8ff', enemy: '#ffb000', pickup: '#ffffff' },
  protanopia: { player: '#9fe8ff', enemy: '#ffd200', pickup: '#ffffff' },
  tritanopia: { player: '#c8fff4', enemy: '#ff3a7a', pickup: '#ffe9a0' },
} as const;
export type ColorblindMode = keyof typeof RESERVED_TONES;
