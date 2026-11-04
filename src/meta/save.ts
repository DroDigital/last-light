/**
 * Versioned save system. IndexedDB primary, localStorage fallback.
 * Every schema change adds a migration; old saves always load.
 */
import { DEFAULT_BINDINGS, type Bindings } from '../core/input';
import type { ColorblindMode } from '../data/palettes';

export const SAVE_VERSION = 4;

export interface Settings {
  quality: 'low' | 'medium' | 'high' | 'ultra' | 'auto';
  shake: number;
  flash: number;
  reducedMotion: boolean;
  colorblind: ColorblindMode;
  uiScale: number;
  damageNumbers: boolean;
  gameSpeed: number;
  sensitivity: number;
  invertY: boolean;
  aimAssist: number;
  autoLevel: boolean;
  boostToggle: boolean;
  fov: number;
  volumes: { master: number; music: number; sfx: number; ui: number; ambience: number };
  mono: boolean;
  visualCues: boolean;
  bindings: Bindings;
  cockpit: boolean;
  scanlines: boolean;
  /** recorded soundtrack or the in-engine procedural score */
  music: 'recorded' | 'procedural';
}

export interface RunRecord {
  seed: string;
  date: number;
  hull: string;
  sector: number;
  won: boolean;
  kills: number;
  light: number;
  embers: number;
  heat: number;
  daily: boolean;
  cause: string;
  weapons: string[];
  upgrades: string[];
  score: number;
  timeSec: number;
}

export interface SaveData {
  version: number;
  embers: number;
  totalEmbers: number;
  runs: number;
  wins: number;
  bossesKilled: string[];
  unlocks: Record<string, number>;
  hulls: string[];
  weapons: string[];
  codex: { enemies: string[]; items: string[]; synergies: string[]; lore: string[]; weapons: string[] };
  challenges: string[];
  history: RunRecord[];
  maxHeat: number;
  heatUnlocked: boolean;
  dailyBest: Record<string, number>;
  settings: Settings;
  tutorialDone: boolean;
  hearthLevel: number;
  equippedCosmetics: { trail?: string; paint?: string; death?: string };
}

export const STARTER_WEAPONS = ['autocannon', 'scattergun', 'pulse', 'swarm', 'gravwell', 'interceptors', 'halo'];

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    shake: 1,
    flash: 1,
    reducedMotion: false,
    colorblind: 'default',
    uiScale: 1,
    damageNumbers: true,
    gameSpeed: 1,
    sensitivity: 1,
    invertY: false,
    aimAssist: 0.5,
    autoLevel: true,
    boostToggle: false,
    fov: 72,
    volumes: { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.7, ambience: 0.6 },
    mono: false,
    visualCues: false,
    bindings: structuredClone(DEFAULT_BINDINGS),
    cockpit: false,
    scanlines: true,
    music: 'recorded',
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    embers: 0,
    totalEmbers: 0,
    runs: 0,
    wins: 0,
    bossesKilled: [],
    unlocks: {},
    hulls: ['lantern'],
    weapons: [...STARTER_WEAPONS],
    codex: { enemies: [], items: [], synergies: [], lore: [], weapons: [] },
    challenges: [],
    history: [],
    maxHeat: 0,
    heatUnlocked: false,
    dailyBest: {},
    settings: defaultSettings(),
    tutorialDone: false,
    hearthLevel: 0,
    equippedCosmetics: {},
  };
}

type Migration = (d: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a version-n save to version n+1. */
export const MIGRATIONS: Record<number, Migration> = {
  1: (d) => {
    // v1 had a flat "light" meta currency; it became Embers in v2.
    const out = { ...d, embers: (d.light as number) ?? 0, totalEmbers: (d.light as number) ?? 0, version: 2 };
    delete (out as Record<string, unknown>).light;
    return out;
  },
  2: (d) => {
    // v3 added codex.weapons, cosmetics and per-setting accessibility toggles.
    const codex = (d.codex as Record<string, unknown>) ?? {};
    return {
      ...d,
      codex: { enemies: [], items: [], synergies: [], lore: [], ...codex, weapons: (codex.weapons as string[]) ?? [] },
      equippedCosmetics: d.equippedCosmetics ?? {},
      version: 3,
    };
  },
  3: (d) => {
    // Earlier saves stored pad bindings only when explicitly rebound; defaults
    // were implicit. Preserve custom buttons and add defaults where absent.
    const settings = { ...((d.settings as Partial<Settings>) ?? {}) };
    const bindings = { ...(settings.bindings ?? {}) };
    for (const action of Object.keys(DEFAULT_BINDINGS) as (keyof Bindings)[]) {
      const saved = bindings[action];
      if (!Array.isArray(saved)) continue;
      if (!saved.some((code) => code.startsWith('Pad'))) {
        bindings[action] = [...saved, ...DEFAULT_BINDINGS[action].filter((code) => code.startsWith('Pad'))];
      }
    }
    return { ...d, settings: { ...settings, bindings }, version: 4 };
  },
};

export function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  let d = raw as Record<string, unknown>;
  let v = typeof d.version === 'number' ? d.version : 1;
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) break;
    d = m(d);
    v = d.version as number;
  }
  // deep-merge onto defaults so newly added fields exist
  const merged = { ...base, ...d } as SaveData;
  merged.settings = { ...base.settings, ...(d.settings as Partial<Settings>) };
  merged.settings.volumes = { ...base.settings.volumes, ...(merged.settings.volumes ?? {}) };
  merged.settings.bindings = { ...base.settings.bindings, ...(merged.settings.bindings ?? {}) };
  merged.codex = { ...base.codex, ...(d.codex as object) };
  merged.version = SAVE_VERSION;
  return merged;
}

const DB = 'last-light';
const STORE = 'save';
const KEY = 'slot0';

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class SaveSystem {
  data: SaveData = defaultSave();
  private db: IDBDatabase | null = null;
  private pending = false;

  async load(): Promise<SaveData> {
    this.db = await idb();
    let raw: unknown = null;
    if (this.db) {
      raw = await new Promise((resolve) => {
        try {
          const tx = this.db!.transaction(STORE, 'readonly');
          const r = tx.objectStore(STORE).get(KEY);
          r.onsuccess = () => resolve(r.result ?? null);
          r.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    if (!raw) {
      try {
        const s = localStorage.getItem('last-light-save');
        if (s) raw = JSON.parse(s);
      } catch {
        /* ignore */
      }
    }
    this.data = migrate(raw);
    return this.data;
  }

  save(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      const json = JSON.parse(JSON.stringify(this.data));
      if (this.db) {
        try {
          const tx = this.db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(json, KEY);
        } catch {
          /* fall through */
        }
      }
      try {
        localStorage.setItem('last-light-save', JSON.stringify(json));
      } catch {
        /* ignore quota */
      }
    });
  }

  export(): string {
    return btoa(unescape(encodeURIComponent(JSON.stringify(this.data))));
  }

  import(code: string): boolean {
    try {
      const raw = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      this.data = migrate(raw);
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    const s = this.data.settings;
    this.data = defaultSave();
    this.data.settings = s;
    this.save();
  }

  unlockLevel(id: string): number {
    return this.data.unlocks[id] ?? 0;
  }

  discover(kind: keyof SaveData['codex'], id: string): boolean {
    const list = this.data.codex[kind];
    if (list.includes(id)) return false;
    list.push(id);
    return true;
  }
}
