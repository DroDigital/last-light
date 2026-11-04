# LAST LIGHT

A browser-based 3D roguelite space shooter in the **Dithered Cosmos** style. The universe is going dark. You fly the Lantern, the last lightship, diving through five dying star systems to harvest the light they have left before the Hush swallows it.

The look is **Chroma Dither**, three styles with one job each:
- **The world** is a painterly HDR space, posterized through ordered dithering into per-sector OKLab palettes at low internal resolution.
- **Everything with energy** (ships, enemies, bolts, shock rings) draws crisp native-res vector cores, with bloom halos rendered as dither.
- **Information** follows Swiss brutalism: bold grotesk type, target brackets, kill confirmations, and a signal-orange accent that is never dithered.

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

Balance: `npm run balance -- 10 ok` plays 10 headless runs with a bot (`good`, `ok` or `poor`) and prints win rate, deaths by sector and damage per fight. The tuning levers live in `src/data/balance.ts`.

## Test

```bash
npm test
```

Vitest covers RNG determinism, map generation, save migrations, draft rules, evolution rules, a 300-enemy/3000-bullet sim budget check, and automated build simulations (power curve per sector, trigger-chain termination). `node scripts/play.mjs <outdir> <basic|look|ship|stress|diag>` drives the built game in headless Chromium and saves screenshots (set `PW_PATH` if Playwright is installed globally).

## Controls

All bindings are rebindable in Settings → Controls.

| Action | Keyboard & mouse | Gamepad |
| --- | --- | --- |
| Steer / aim | Mouse (click to lock; unlocked = virtual stick) | Right stick (aim assist) |
| Thrust / strafe | W S / A D | Left stick |
| Rise / sink | R / C | D-pad up / down |
| Primary / secondary fire | LMB / RMB | RT / LT |
| Boost | Space | A |
| Dodge roll | Shift | B |
| Shockwave / Stasis | Q / E | LB / RB |
| Flare (when Lumen is full) | F | Y |
| Camera: chase / cockpit | V | View |
| Radar | Tab | Menu |
| Pause | Esc / P | Menu |
| Look panel / perf overlay | F1 / F3 | — |

Menus are fully navigable with arrow keys + Enter/Esc or the d-pad + A/B. On the draft screen, `1` `2` `3` pick a card. On the death screen, `R` dives again.

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
