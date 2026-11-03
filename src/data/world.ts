import type { HullDef } from '../game/types';

export interface SectorDef {
  id: string;
  name: string;
  star: string;
  palette: string;
  pool: [string, number][];
  boss: string;
  asteroids: number;
  music: { root: number; scale: number[]; bpm: number; voice: 'glass' | 'warm' | 'cold' | 'pulse' | 'void' };
  intro: string;
}

export const SECTORS: SectorDef[] = [
  {
    id: 'cradle', name: 'I · The Cradle', star: 'Vela Minor', palette: 'cradle', boss: 'foreman', asteroids: 26,
    pool: [['moteeater', 5], ['scrapper', 5], ['gloom', 2], ['ramdrone', 2], ['surveyor', 2], ['gunship', 1], ['rivet', 1], ['nullwisp', 1], ['eclipse', 0.6], ['hollow', 1]],
    music: { root: 45, scale: [0, 3, 5, 7, 10], bpm: 104, voice: 'glass' }, intro: 'A nursery of stars, now mostly ash.',
  },
  {
    id: 'ember', name: 'II · Ember Reach', star: 'Antares Pyre', palette: 'ember', boss: 'leviathan', asteroids: 34,
    pool: [['scrapper', 4], ['ramdrone', 3], ['gunship', 2], ['welder', 1.5], ['rivet', 2], ['turretrig', 2], ['hauler', 1], ['bulwark', 1], ['gloom', 2], ['hollow', 1.5], ['cutter', 2]],
    music: { root: 40, scale: [0, 1, 5, 7, 8], bpm: 112, voice: 'warm' }, intro: 'A red giant coughing out its last breaths.',
  },
  {
    id: 'ice', name: 'III · The White Dwarf', star: 'Sirius Remnant', palette: 'ice', boss: 'glasschoir', asteroids: 18,
    pool: [['shardling', 5], ['cantor', 3], ['hymnlancer', 2], ['chorale', 1.5], ['facet', 2], ['prismwarden', 1], ['seraph', 2], ['resonator', 1], ['lure', 1], ['moteeater', 1]],
    music: { root: 50, scale: [0, 2, 3, 7, 9], bpm: 96, voice: 'cold' }, intro: 'A cooling ember of a star, ringed in singing glass.',
  },
  {
    id: 'pulsar', name: 'IV · Lighthouse Pulsar', star: 'PSR Lumen', palette: 'pulsar', boss: 'pulsarheart', asteroids: 22,
    pool: [['seraph', 3], ['cantor', 2], ['gunship', 2], ['cutter', 3], ['eclipse', 2], ['umbra', 2], ['hauler', 1], ['mawspawn', 1], ['bulwark', 1], ['shroud', 1], ['resonator', 1], ['whisper', 1]],
    music: { root: 42, scale: [0, 2, 3, 6, 7, 10], bpm: 124, voice: 'pulse' }, intro: 'A dead star that still spins its beam across the dark.',
  },
  {
    id: 'hush', name: 'V · The Hush', star: 'The Last Star', palette: 'hush', boss: 'lastdark', asteroids: 14,
    pool: [['moteeater', 5], ['gloom', 3], ['umbra', 3], ['hollow', 2], ['mawspawn', 1.5], ['whisper', 2], ['eclipse', 2], ['nullwisp', 3], ['shroud', 2]],
    music: { root: 38, scale: [0, 1, 3, 6, 7], bpm: 90, voice: 'void' }, intro: 'Where the light went. Where you must go.',
  },
];

export interface BossDef {
  id: string;
  name: string;
  title: string;
  hp: number;
  desc: string;
  phases: string[];
}

export const BOSSES: Record<string, BossDef> = {
  foreman: { id: 'foreman', name: 'THE FOREMAN', title: 'Salvage Overseer of the Cradle', hp: 2400, desc: 'A mining rig that strips dying stars for parts. Its drill arms come off first.', phases: ['Drill arms and turrets', 'Spinning sweep', 'Overheated core'] },
  leviathan: { id: 'leviathan', name: 'CINDER LEVIATHAN', title: 'Coiled Around Antares Pyre', hp: 4200, desc: 'A star-eating serpent armored in molten plates. Crack them open, plate by plate.', phases: ['Coiled volley', 'Burning dives', 'Molten fury'] },
  glasschoir: { id: 'glasschoir', name: 'THE GLASS CHOIR', title: 'Cathedral of the White Dwarf', hp: 5600, desc: 'A cathedral of singing crystal. Silence the choir shards to expose the heart.', phases: ['Hymn of beams', 'Refraction', 'Requiem'] },
  pulsarheart: { id: 'pulsarheart', name: 'PULSAR HEART', title: 'The Lighthouse at the End', hp: 7000, desc: 'A spinning neutron heart whose beams sweep in time with the music.', phases: ['Lighthouse', 'Twin beams', 'Magnetar'] },
  lastdark: { id: 'lastdark', name: 'THE LAST DARK', title: 'The Hush Made Whole', hp: 9000, desc: 'The dark that eats light. It drinks the color from the world as it fights.', phases: ['The Swallowing', 'Colorless', 'Relight the Last Star'] },
};

export const HULLS: HullDef[] = [
  { id: 'lantern', name: 'The Lantern', desc: 'The last lightship. Balanced and bright.', passive: 'Kindle: Light motes also fill 15% more Lumen.', stats: {}, start: { primary: 'pulse', secondary: 'swarm' }, flags: ['kindle'], cost: 0, accent: '#fff0c0' },
  { id: 'moth', name: 'Moth', desc: 'Tiny, fast, fragile. Lives on grazes.', passive: 'Wingbeat: graze radius doubled; grazes give double Lumen.', stats: { hull: -35, speed: 1.25, grazeRadius: 2, dodges: 1 }, start: { primary: 'needler', secondary: 'timeshard' }, flags: ['moth'], cost: 120, accent: '#c0ffe0' },
  { id: 'bastion', name: 'Bastion', desc: 'Heavy, slow, unshakable.', passive: 'Rampart: shields regenerate twice as fast; Shockwave is huge.', stats: { hull: 50, shield: 30, speed: 0.82, shieldRegen: 2, shockwave: 1.6 }, start: { primary: 'autocannon', secondary: 'torpedo' }, flags: ['bastion'], cost: 160, accent: '#ffd0a0' },
  { id: 'prism', name: 'Prism', desc: 'A crystal ship stolen from the Choir.', passive: 'Refraction: every primary shot splits into 2 extra beams at 40% damage.', stats: { hull: -10 }, start: { primary: 'prismgun', secondary: 'echo' }, flags: ['prismHull'], cost: 200, accent: '#ffc0ff' },
  { id: 'ember', name: 'Ember', desc: 'Runs hot. Gets stronger the hotter it runs.', passive: 'Furnace: sustained fire builds heat for up to +60% damage; overheating vents a nova.', stats: { hull: 10 }, start: { primary: 'scattergun', secondary: 'hellfire' }, flags: ['emberHull'], cost: 220, accent: '#ff9050' },
  { id: 'wraith', name: 'Wraith', desc: 'A ghost that lives between dodges.', passive: 'Phantom: 3 dodge charges; dodging through bullets grants a guaranteed crit.', stats: { hull: -20, dodges: 2, iframes: 1.4 }, start: { primary: 'gauss', secondary: 'voidspike' }, flags: ['wraith'], cost: 260, accent: '#d0d0ff' },
];

export const HULL_BY_ID: Record<string, HullDef> = Object.fromEntries(HULLS.map((h) => [h.id, h]));

export interface EventChoice {
  label: string;
  outcome: string;
  effect: EventEffect;
}
export interface EventEffect {
  light?: number;
  hull?: number;
  maxHull?: number;
  upgrade?: 'random' | 'rare' | 'artifact' | 'curse';
  weapon?: boolean;
  fight?: 'elite' | 'ambush';
  embers?: number;
  lore?: string;
  gamble?: number; // chance of success
  fail?: EventEffect;
}
export interface EventDef {
  id: string;
  title: string;
  text: string;
  choices: EventChoice[];
}

export const EVENTS: EventDef[] = [
  { id: 'driftingpod', title: 'A Drifting Lifepod', text: 'A lifepod tumbles past, its beacon still blinking. Something inside is warm.', choices: [
    { label: 'Crack it open', outcome: 'A sleeping pilot. They leave you their stash and a blessing.', effect: { gamble: 0.7, light: 60, upgrade: 'random', fail: { fight: 'ambush' } } },
    { label: 'Tow it to safety', outcome: 'You spend fuel, but you feel lighter.', effect: { light: -20, embers: 15, hull: 20 } },
    { label: 'Leave it', outcome: 'The beacon blinks out behind you.', effect: {} },
  ] },
  { id: 'hushaltar', title: 'An Altar of the Hush', text: 'A ring of black stones drinks the light from your hull. It offers power in exchange.', choices: [
    { label: 'Accept the bargain', outcome: 'Power floods you. So does the dark.', effect: { upgrade: 'artifact', fail: undefined, light: 0, maxHull: -15 } },
    { label: 'Offer it Light instead', outcome: 'It drinks. It gives back a fragment.', effect: { light: -50, upgrade: 'rare' } },
    { label: 'Shatter it', outcome: 'The stones scream. Things stir.', effect: { fight: 'elite', embers: 20 } },
  ] },
  { id: 'choirsong', title: 'The Choir Sings', text: 'A crystalline chorus drifts in the void, harmonizing with your engine hum.', choices: [
    { label: 'Sing back', outcome: 'They resonate and gift you a shard of song.', effect: { gamble: 0.6, upgrade: 'rare', fail: { hull: -25 } } },
    { label: 'Listen quietly', outcome: 'You learn something about where they came from.', effect: { lore: 'choir_origin', light: 20 } },
  ] },
  { id: 'scrapyard', title: 'Salvage Graveyard', text: 'Drone husks orbit a dead foundry. Parts everywhere, some still twitching.', choices: [
    { label: 'Scavenge weapons', outcome: 'You find a working weapon core.', effect: { gamble: 0.75, weapon: true, fail: { fight: 'ambush' } } },
    { label: 'Patch your hull', outcome: 'Good plating, if mismatched.', effect: { hull: 45 } },
    { label: 'Mine the wrecks for Light', outcome: 'Dim, but it all adds up.', effect: { light: 70 } },
  ] },
  { id: 'dyingstar', title: 'A Star Gutters Out', text: 'A small star is collapsing. Its last light could be yours, if you fly close enough to burn.', choices: [
    { label: 'Dive in', outcome: 'You burn. You shine.', effect: { hull: -30, light: 140 } },
    { label: 'Skim the edge', outcome: 'A careful harvest.', effect: { light: 50 } },
  ] },
  { id: 'cursedgift', title: 'A Gift Wrapped in Static', text: 'A box floats, humming with dithered noise. A tag reads: "for the Lantern".', choices: [
    { label: 'Open it', outcome: 'It was a curse, and also a blessing.', effect: { upgrade: 'curse', light: 80 } },
    { label: 'Throw it into the dark', outcome: 'Nothing happens. You wonder.', effect: { embers: 5 } },
  ] },
  { id: 'mirror', title: 'Your Reflection', text: 'A perfect mirror-ship hangs ahead, matching your every move.', choices: [
    { label: 'Fight it', outcome: 'It fights exactly like you.', effect: { fight: 'elite', upgrade: 'rare' } },
    { label: 'Salute it', outcome: 'It salutes back and fades. Something of it stays with you.', effect: { upgrade: 'random' } },
  ] },
  { id: 'wick', title: 'An Old Signal', text: "A voice crackles in: Wick, the Hearth's keeper. \"Lantern, the Hearth needs fuel. Can you spare any?\"", choices: [
    { label: 'Send Light home', outcome: '"Thank you. We will keep the fire."', effect: { light: -40, embers: 30 } },
    { label: '"Not yet, Wick."', outcome: '"Then fly well. Come back."', effect: { lore: 'wick_signal' } },
  ] },
  { id: 'gravityslingshot', title: 'Gravity Slingshot', text: 'Twin black holes spin close. Thread between them and you could leap ahead.', choices: [
    { label: 'Thread the needle', outcome: 'You skip ahead, faster than light should go.', effect: { gamble: 0.65, light: 90, upgrade: 'random', fail: { hull: -40 } } },
    { label: 'Go around', outcome: 'Slow and steady.', effect: { hull: 10 } },
  ] },
  { id: 'emberthief', title: 'An Ember Thief', text: 'A Salvage drone has stolen a fragment of the Hearth. It flees.', choices: [
    { label: 'Chase it down', outcome: 'You catch it, but it called friends.', effect: { fight: 'ambush', embers: 40 } },
    { label: 'Let it go', outcome: 'You will remember its face.', effect: {} },
  ] },
  { id: 'lumenpool', title: 'A Pool of Lumen', text: 'Liquid light pools in a hollow asteroid, perfectly still.', choices: [
    { label: 'Drink deep', outcome: 'Your gauge overflows.', effect: { light: 40, upgrade: 'random' } },
    { label: 'Bottle it for the Hearth', outcome: 'Wick will like this.', effect: { embers: 25 } },
  ] },
  { id: 'derelict_log', title: 'A Captain\'s Log', text: 'A derelict cruiser drifts, its log still playing on loop.', choices: [
    { label: 'Listen to the log', outcome: 'You learn how the first star went out.', effect: { lore: 'first_star', light: 15 } },
    { label: 'Strip it', outcome: 'You take its reactor coil.', effect: { upgrade: 'random' } },
  ] },
];

export interface LoreDef {
  id: string;
  title: string;
  text: string;
}
export const LORE: LoreDef[] = [
  { id: 'first_star', title: 'How the First Star Went Out', text: 'It did not explode. It simply forgot how to shine. The Hush was there before; it only waited.' },
  { id: 'choir_origin', title: 'The Choir', text: 'They were once ordinary starlight, frozen into crystal at the moment their stars died. They chase light to remember being warm.' },
  { id: 'wick_signal', title: 'Wick', text: 'Wick has tended the Hearth for nine hundred years. He does not sleep. He says the fire talks to him.' },
  { id: 'salvage', title: 'The Salvage Swarm', text: 'Mining drones, built to harvest dying stars. Their makers are long gone. The drones never stopped.' },
  { id: 'lantern', title: 'The Lantern', text: 'The last lightship carries a captured sunlet in its keel. It is the only light that does not fade.' },
  { id: 'hush', title: 'The Hush', text: 'Not darkness, exactly. A hunger for the absence of light. It is quiet because it ate the sound too.' },
  { id: 'ash', title: 'Ash', text: 'A Salvage drone that woke up. It trades in parts and jokes, and it is the only one who can fix the Lantern.' },
  { id: 'vela', title: 'Vela Minor', text: 'Once a nursery where a thousand stars were born. Now the cradle holds only embers.' },
  { id: 'antares', title: 'Antares Pyre', text: 'A red giant so old it remembers the first light. The Leviathan coiled around it to keep warm.' },
  { id: 'sirius', title: 'Sirius Remnant', text: 'A white dwarf: the dense, cooling heart of a star that already died once.' },
  { id: 'pulsar', title: 'PSR Lumen', text: 'A lighthouse star, spinning six hundred times a second. Ships once navigated by it. Now only the Hush listens.' },
  { id: 'laststar', title: 'The Last Star', text: 'At the bottom of the dark, one star still burns, very faintly. If it goes out, everything does.' },
  { id: 'embers', title: 'Embers', text: 'Light brought home becomes Embers: heat the Hearth can keep. Every run, the fire grows.' },
  { id: 'heat', title: 'Heat', text: 'The deeper you dare to dive, the hotter you must burn.' },
  { id: 'lumen', title: 'Lumen', text: 'Concentrated light. Fill the gauge and the Lantern remembers what it is: a sun.' },
];

/** Hearth NPC dialogue, unlocked by run count / bosses defeated. */
export interface Line {
  who: 'Wick' | 'Ash' | 'Seren';
  req: { runs?: number; bosses?: number; wins?: number };
  text: string;
}
export const DIALOGUE: Line[] = [
  { who: 'Wick', req: {}, text: 'Welcome home, Lantern. The fire is low. Bring back what light you can.' },
  { who: 'Wick', req: { runs: 1 }, text: 'You came back. Most don\'t. The Embers you brought are already warming the old stones.' },
  { who: 'Ash', req: { runs: 2 }, text: 'Oh good, you\'re in one piece. Mostly. I can fit new hulls if you bring me enough Embers.' },
  { who: 'Wick', req: { runs: 3 }, text: 'Every star you relight out there makes the Hearth burn brighter here. I can feel it.' },
  { who: 'Ash', req: { bosses: 1 }, text: 'You took down the Foreman? I used to work for that thing. Good riddance.' },
  { who: 'Seren', req: { bosses: 2 }, text: '...You can hear me? I am of the Choir. Or I was. Your light is very loud.' },
  { who: 'Wick', req: { runs: 5 }, text: 'Ash thinks I talk to the fire. I don\'t. It talks to me. It says you are getting closer.' },
  { who: 'Seren', req: { bosses: 3 }, text: 'The Glass Choir sang for a thousand years. Thank you for letting them rest.' },
  { who: 'Ash', req: { runs: 8 }, text: 'Fun fact: the Hush isn\'t dark. It\'s *hungry*. I measured it. Do not ask me how.' },
  { who: 'Seren', req: { bosses: 4 }, text: 'Beyond the pulsar is the Last Star. I was born near it. Please... be gentle with it.' },
  { who: 'Wick', req: { wins: 1 }, text: 'You relit the Last Star. Do you hear that? That is the universe breathing again. ...It is still so dark, though. Will you go again?' },
  { who: 'Ash', req: { wins: 1 }, text: 'Heat\'s unlocked. That means harder dives for better Embers. I love it. You\'ll hate it.' },
  { who: 'Seren', req: { wins: 2 }, text: 'Each time you relight it, another star somewhere remembers. Keep going, Lantern.' },
  { who: 'Wick', req: { runs: 12 }, text: 'Sometimes I think the Hush is just the universe getting tired. Then you come home, and I think: not yet.' },
];

export interface HearthUnlock {
  id: string;
  name: string;
  desc: string;
  cost: number;
  kind: 'hull' | 'weapon' | 'boost' | 'cosmetic' | 'loadout' | 'pool';
  ref?: string;
  max?: number;
}

export const HEARTH_UNLOCKS: HearthUnlock[] = [
  { id: 'b_hull', name: 'Tempered Keel', desc: '+8 starting hull per level.', cost: 30, kind: 'boost', max: 5 },
  { id: 'b_shield', name: 'Ember Shield', desc: '+6 starting shield per level.', cost: 30, kind: 'boost', max: 5 },
  { id: 'b_light', name: 'Lantern Glass', desc: '+5% Light gain per level.', cost: 40, kind: 'boost', max: 4 },
  { id: 'b_reroll', name: 'Second Thoughts', desc: '+1 free reroll per sector per level.', cost: 50, kind: 'boost', max: 2 },
  { id: 'b_start', name: 'Head Start', desc: 'Start each run with 40 Light per level.', cost: 35, kind: 'boost', max: 3 },
  { id: 'b_banish', name: 'Banishment', desc: '+1 banish per run per level.', cost: 40, kind: 'boost', max: 3 },
  { id: 'p_tier2', name: 'Wider Arsenal', desc: 'Adds rare upgrades and artifacts to the pool.', cost: 60, kind: 'pool', max: 1 },
  { id: 'p_curses', name: 'Rift Charts', desc: 'Rift nodes appear on the sector map.', cost: 50, kind: 'pool', max: 1 },
  { id: 'l_pick', name: 'Armory Access', desc: 'Choose your starting primary from unlocked weapons.', cost: 80, kind: 'loadout', max: 1 },
  { id: 'c_trail_gold', name: 'Gilded Trail', desc: 'A golden engine trail.', cost: 25, kind: 'cosmetic', max: 1 },
  { id: 'c_trail_violet', name: 'Violet Wake', desc: 'A violet engine trail.', cost: 25, kind: 'cosmetic', max: 1 },
  { id: 'c_paint_ash', name: 'Ash Paint', desc: 'Pale hull plating.', cost: 30, kind: 'cosmetic', max: 1 },
  { id: 'c_death_bloom', name: 'Bloom Death', desc: 'Your last moment blooms into flowers of light.', cost: 40, kind: 'cosmetic', max: 1 },
];

export interface ChallengeDef {
  id: string;
  name: string;
  desc: string;
  reward: number;
}
export const CHALLENGES: ChallengeDef[] = [
  { id: 'first_boss', name: 'Foreclosure', desc: 'Defeat the Foreman.', reward: 20 },
  { id: 'win', name: 'Relight', desc: 'Relight the Last Star.', reward: 100 },
  { id: 'nohull', name: 'Untouched Hull', desc: 'Win a run without taking hull damage.', reward: 300 },
  { id: 'flare200', name: 'Supernova', desc: 'Kill 200 enemies during a single Flare.', reward: 120 },
  { id: 'kills1000', name: 'Lamplighter', desc: 'Kill 1000 enemies in one run.', reward: 80 },
  { id: 'graze100', name: 'Threadbare', desc: 'Graze 100 bullets in one sector.', reward: 60 },
  { id: 'chain20', name: 'Fireworks', desc: 'Trigger a chain reaction of 20 kills.', reward: 60 },
  { id: 'evolve', name: 'Metamorphosis', desc: 'Evolve a weapon.', reward: 40 },
  { id: 'evolve3', name: 'Menagerie', desc: 'Have 3 evolved weapons in one run.', reward: 120 },
  { id: 'light2000', name: 'Hoarder', desc: 'Bank 2000 Light in one run.', reward: 80 },
  { id: 'heat5', name: 'White Hot', desc: 'Win at Heat 5.', reward: 200 },
  { id: 'daily', name: 'Daily Diver', desc: 'Finish a daily run.', reward: 30 },
  { id: 'allhulls', name: 'Fleet', desc: 'Unlock every hull.', reward: 100 },
  { id: 'synergy5', name: 'Harmony', desc: 'Have 5 synergies active at once.', reward: 80 },
  { id: 'endless10', name: 'Beyond', desc: 'Survive 10 waves of endless mode.', reward: 150 },
];

export const HEAT_LEVELS = [
  { name: 'Heat 1 · Warm', desc: 'Enemies have +15% hull.' },
  { name: 'Heat 2 · Hot', desc: 'Enemy shots are 15% faster.' },
  { name: 'Heat 3 · Searing', desc: 'Elites appear more often.' },
  { name: 'Heat 4 · Blazing', desc: 'Shops cost 25% more.' },
  { name: 'Heat 5 · Molten', desc: 'Enemies have +30% more hull.' },
  { name: 'Heat 6 · Stellar', desc: 'Bosses gain an extra attack pattern speed.' },
  { name: 'Heat 7 · Fusion', desc: 'Fewer repair options.' },
  { name: 'Heat 8 · Nova', desc: 'Enemies deal 25% more damage.' },
  { name: 'Heat 9 · Supernova', desc: 'Swarm waves are larger.' },
  { name: 'Heat 10 · Hypernova', desc: 'The Hush is hungrier: Light decays slowly.' },
];
