# LAST LIGHT

A browser-based 3D roguelite space shooter in the **Dithered Cosmos** style. The universe is going dark. You fly the Lantern, the last lightship, diving through five dying star systems to harvest the light they have left before the Hush swallows it.

The look is **Chroma Dither**, three styles with one job each:
- **The world** is a painterly HDR space, posterized through ordered dithering into per-sector OKLab palettes at low internal resolution.
- **Everything with energy** (ships, enemies, bolts, shock rings) draws crisp native-res vector cores, with bloom halos rendered as dither.
- **Information** follows Swiss brutalism: bold grotesk type, target brackets, kill confirmations, and a signal-orange accent that is never dithered.

- **Scale** comes from real geometry, not just paint. Each sector has a gas giant with rings and a lit terminator filling the sky. Far outside the arena sit an arc of mountain-sized asteroids and a broken ring station thousands of metres across, all with true parallax. Distance haze dissolves far hulls into the nebula, and near-field dust streaks past the lens at speed. The arena is 640 m across its radius, almost three times its old size, with rocks gathered into fields.

Where light dies, the world prints in three inks.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL in Chrome, Edge, Firefox or Safari (WebGL2 required). Click the game to lock the mouse.

## Build

```bash
npm run build
```

`dist/` is a fully static site (relative paths) that runs from any static host or a subfolder. Preview it with `npm run preview`.

For desktop packages and itch.io publishing, see [the release guide](docs/release.md).

Balance: `npm run balance -- 10 ok` plays 10 headless runs with a bot (`good`, `ok` or `poor`) and prints win rate, deaths by sector and damage per fight. The tuning levers live in `src/data/balance.ts`.

## Test

```bash
npm test
```

Vitest covers RNG determinism, map generation, save migrations, draft rules, evolution rules, a 300-enemy/3000-bullet sim budget check, and automated build simulations (power curve per sector, trigger-chain termination). `node scripts/play.mjs <outdir> <basic|look|ship|stress|diag>` drives the built game in headless Chromium and saves screenshots (set `PW_PATH` if Playwright is installed globally).

## Controls

Action buttons are rebindable in Settings → Controls; rebinding one device preserves the other device’s binding. Stick movement, D-pad vertical movement, and menu navigation use fixed mappings.

| Action | Keyboard & mouse | Gamepad |
| --- | --- | --- |
| Steer / aim | Mouse (click to lock) | Right stick (aim assist) |
| Thrust / strafe | W S / A D | Left stick |
| Rise / sink | R / C | D-pad up / down |
| Primary / secondary fire | LMB / RMB | RT / LT |
| Boost | Space | A |
| Dodge roll | Shift | B |
| Shockwave / Stasis | Q / E | LB / RB |
| Flare (when Lumen is full) | F | Y |
| Guard / parry | X / MMB | X |
| Camera: chase / cockpit | V | View |
| Radar | Tab | Left stick click |
| Pause | Esc / P | Menu |
| Look panel / perf overlay | F1 / F3 | — |

Menus are navigable with arrow keys + Enter/Esc or the D-pad / left stick + A/B. Use left/right to change sliders and selection lists. On the draft screen, `1` `2` `3` pick a card. On the death screen, `R` dives again.

### Local co-op (1–4 players)

Up to three more pilots drop in at any time, in every mode (Act I and II runs, Endless and the Daily Dive) and on any screen: the title, the chart, drafts, the loadout or mid-fight. Press **Start** on a spare controller to take the next free seat (P2 mint, P3 amber, P4 violet). Player 1 can fly with keyboard and mouse while every controller is a wingman, or with a controller of their own. Wingmen use the gamepad layout above, and any of them can pause a fight with **Start**.

- **Sharing:** every ship shares the build and the Light, and each keeps its own hull, shield and weapon cooldowns. Enemies go after the nearest pilot.
- **Scaling:** enemies get tougher with each extra pilot (+40% HP, +50% for bosses; levers in `src/data/balance.ts`). The scaling is live: when someone joins or leaves mid-fight, every enemy on the field rescales.
- **Camera:** it stays behind Player 1 and pulls back to keep the whole party in frame. A soft tether keeps wingmen near Player 1, and each fight starts in formation.
- **Downed pilots:** hover close to a downed partner for 3 s to revive them. Each extra rescuer speeds it up. The run ends only when every pilot is down. A roster under the sector readout shows each pilot's hull or revive progress.
- **Leaving:** hold **View/Back** for 1.5 s to leave, or unplug the controller. Seats carry over into the next run and across modes while their controllers stay connected. Outside fights, a strip at the bottom of the screen shows who is seated.

## Combat

- **Linked hardpoints:** a new primary or secondary no longer replaces your gun. It mounts on a linked hardpoint, outboard of the main guns, and fires together with them on the same trigger, on its own cooldown. Every ship has 2 linked hardpoints; **Auxiliary Hardpoint** upgrades add up to 2 more. When all of them are full, a new gun replaces the oldest linked one (the draft card says which). Linked guns level and evolve like any other weapon. Draft cards offer weapons more often while a hardpoint is open.
- **Opening armory:** every dive, including Endless and the Daily Dive, opens with a free pick of three new guns for a linked hardpoint, so the first fight already has two weapons on each trigger you fill.
- **Kill streak:** kills within 3 s of each other build a streak worth +2% fire rate per kill, up to +40% (**Momentum Engine**: +60% and 4.5 s). Tiers at 8, 20, 40 and 80 kills announce themselves. Any hit halves the streak.
- **Guard and parry:** hold Guard to raise a shield bubble. It blocks 70% of incoming damage, slows you and stops your guns, lasts up to 1.1 s, then locks out for 0.5 s. If a hit lands within 0.16 s of raising it, that is a **perfect parry**: you take nothing, an enemy round flies back as a homing shot at your target for 6× its damage, a melee attacker takes a counter-blow, and the guard is ready again at once. Holding the key never re-arms the window; you have to time each press. **Riposte Coils** and **Guard Lattice** improve both.
- **Shields:** shield cards now play differently, not only bigger. **Siphon Weave** (kills restore shield), **Overcharge Cells** (pickups can push the shield to 150%), **Reflector Skin** (some rounds glance back while shielded), **Capacitor Burst** (a breaking shield detonates and erases nearby fire), **Hardlight Ram** (boost through enemies with your bubble), **Charged Plating** (+15% damage above half shield) and **Second Wind** (a full shield refill when your hull drops low). Four shield cards complete the **Hardlight Doctrine** synergy.
- **Sustain drops:** enemies and asteroids can drop **Hull Patches** (12 hull + 8% of max) and **Shield Cells** (30 shield + 20% of max, and regen restarts at once). Fodder rarely drops them; heavies, support ships and rocks are worth chasing.

## Bosses

Every boss has its own set of signature attacks (`src/game/bossmoves.ts`), drawn in its own colour, with volumetric shockfronts, horizons and pools where a hazard needs volume. The boss bar names each attack as it starts. Later phases add moves and drop the gentle ones, and the final phase of every boss keeps up background fire on top of its moves. Bosses also get faster and tougher through the run.

| Boss | Signature attacks |
| --- | --- |
| The Foreman | Drill Launch (arms spear at you and return) · Scrap Cage (a closing sphere of scrap with one gap) · Tractor Haul · Mortar Walk · Scrap Conveyor (lanes of scrap, one clear) |
| Cinder Leviathan | Constrict (coils around you, firing inward) · Cinder Breath (a sweeping cone of fire) · Burning Dive (dives that leave magma) · Eruption (geysers along its whole body) |
| The Glass Choir | Glass Lattice (a spinning web of beams between shards) · Refraction (orbs that shatter into rings) · Chorus of Lances · Requiem (a beam that bounces through the shards and ends on you) |
| Pulsar Heart | Pulse Wave (flat rings: leave the plane) · Strobe (lances on the beat) · Magnetar Snap (pull, then a shell: roll or parry through) · Metronome (the safe side swaps every beat) |
| The Last Dark | Swallow (lingering pools of dark) · Eye Lances · Umbra Wave · Drain (its eyes ring you while the colour drains) |
| The Kiln Mother | Slag Pools · Bellows (a blast that throws you back) · Kiln Barrage (lobbed mortars) · Molten Pour (a stream that chases you) |
| Horizon Eater | Swelling Horizon · Lensing (bent light arrives from behind) · Tidal Shear · Accretion (a disc forms around you while you are dragged in). Running away makes its pull stronger. |
| Quasar Regent | Judgment (falling columns of light) · Court Charge · Jet Sweep · Coronation (a crown of bars, then the centre burns) |
| Iron Magnetar | Polarity (pull and push, flipping) · Shrapnel Shell · Rail Lock · Iron Storm (every round in the air turns toward you) |
| The Endless Night | Masks (borrows a move from an earlier boss, named on the bar) · Eclipse · The First Light (rotating spokes) |

**Act II pacing:** turret rigs bolted to asteroids are optional bonus targets and never hold a fight open. Turrets the director sends drop in close. When the last few hostiles hang back far away, they warp in next to you. Every 14–22 s, the Deep folds a ring of enemies in around you.

## Classes

Every dive starts on the class screen (Quick Dive skips it and flies your last pick). Three pilot classes are free and can be played any time:

| Class | Ship | Starting weapons | Passive |
| --- | --- | --- | --- |
| Vanguard: heavy assault | Aegis | Flak Cannon · Siege Mortar | +2 armor; shields regenerate twice as fast while firing |
| Striker: interceptor | Kestrel | Coilshot · Cluster Pod | +1 dodge and faster recharge; each dodge primes +30% damage for 1.5 s |
| Conduit: technomancer | Loom | Arc Caster · Gravity Well · Interceptor Wing | Status effects 25% stronger; abilities recharge 15% faster |

Each class has its own skill tree: three branches of four nodes, and the last node of each branch is a keystone. Class XP from every finished dive (kills, sectors, bosses, wins, Endless waves) earns one skill point per level, up to level 12. That buys 12 of a tree's 21 points, so you have to choose. Select a learned node again to refund it (from the top of a branch down), or use **Reset tree**. The Lantern and any hulls bought in the Hearth fly from the same screen, without a tree. Data and rules are in `src/data/classes.ts`.

## Modes

- **Stellar chart and salvage:** Between encounters, drag the chart to orbit and scroll to zoom; the chart buttons also work with keyboard and gamepad navigation. Each highlighted route leads to a different destination. Combat rooms range from common to mythical: higher tiers bring stronger, denser fleets and higher-tier salvage. The final approach converges on the sector boss.
- **Loadout:** Open Loadout from the chart to equip recovered port, starboard, and propulsion components. Each hardpoint has two effect sockets. Some salvaged weapon components unlock effects; fitting or replacing an effect costs the displayed amount of Light, while removing one is free. Component rolls and the loadout last for the current run.
- **Run:** Act I is five sectors. Beating the Last Dark offers **Act II, the Deep**: five harder sectors, each with a live hazard and a four-phase boss. You can also go Endless or return home.
- **Endless** (title menu): waves through all ten environments, a boss every fifth wave, a draft after every wave, and a recorded best wave.
- **Daily Dive:** one seeded run per UTC day.

## Balance

`npm run balance -- 10 ok` plays 10 headless full runs (both acts) with a bot (`good`, `ok` or `poor`). It reports win rate, deaths by sector, damage per fight and bonus drafts from drops. `DROPLOG=1` adds a breakdown of where drops come from. The tuning levers live in `src/data/balance.ts`.

## Structure

```
src/core     loop (fixed 60 Hz + interpolation), seeded RNG, input, events, spatial hash
src/render   pipeline (HDR → bloom → OKLab palette dither → overlay), shaders, GPU particles, streaks, meshes, view
src/game     world sim, player flight, weapons, AI, bosses, director, run/map, juice, game state machine
src/audio    Web Audio mixer, synthesized SFX, recorded soundtrack router, procedural fallback score
src/ui       DOM screens, HUD, 2D overlay, navigation
src/meta     versioned IndexedDB saves with migrations
src/data     palettes, weapons, upgrades, synergies, enemies, sectors, bosses, events, lore, unlocks
docs         DESIGN_LOG.md, CREDITS.md, PERF.md
```

See `docs/DESIGN_LOG.md` for every decision and what changed from the original brief.
