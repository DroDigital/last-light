# Credits & asset log

**LAST LIGHT — Copyright © 2026 Digital Dro. All rights reserved.**

Third-party components are the work of their respective authors and remain
available under their own licenses. Their full notices are provided in
`public/third-party/` in the source and `third-party/` in the build.

LAST LIGHT ships **no third-party visual assets**. Every model is procedural geometry built in code (`src/render/meshes.ts`) and every texture is computed in shaders. Sound effects are built from the freely licensed recordings listed under *Sound effects*, edited and layered in the engine (`src/audio/`), with synthesized sweeteners and a fully synthesized fallback. The recorded soundtrack below was supplied by the project owner. The original procedural score is still in the engine as a fallback and a settings option.

## Music

Music by **Digital Dro**, created using Suno during a premium subscription, as confirmed by the project owner. The tracks ship unmodified as 64 kbps / 48 kHz MP3 in `public/music/`.

| Track | Cue | Length | File |
| --- | --- | --- | --- |
| Last Analog Dawn | Title / Hearth | 3:40 | `menu-last-analog-dawn.mp3` |
| Proximity to Earth | Exploration (map, shop, events, drafts) | 3:44 | `explore-proximity-to-earth.mp3` |
| Proximity to Earth (II) | Exploration, alternates | 3:59 | `explore-proximity-to-earth-2.mp3` |
| Warp Drive | Combat | 3:09 | `combat-warp-drive.mp3` |
| Void Engagements | Combat, alternates | 1:39 | `combat-void-engagements.mp3` |
| Void Leviathan | Boss fights | 3:42 | `boss-void-leviathan.mp3` |
| Last Transmission | Victory / finale | 3:07 | `finale-last-transmission.mp3` |

Suno's terms apply to use of its service and generated music.

## Sound effects

All sound effects ship in one sprite, `public/sfx/sfx.ogg` (index: `sfx.json`), built reproducibly by `scripts/sfx/build.py` from commit-pinned sources. Every clip was modified: trimmed, high/low-pass filtered, de-harsh equalised, some pitch-shifted or looped with crossfades, loudness-normalised, then mixed in game with layering, reverb and stereo widening.

| Source | Author | License | Used for |
| --- | --- | --- | --- |
| [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) (via [Godot port](https://github.com/Boyquotes/kenney-sci-fi-sounds-for-godot)) | Kenney | CC0 1.0 | weapon bodies, lasers, explosions, force fields, engine, thruster and beam loops, warp spool |
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) (via [mirror](https://github.com/ETdoFresh/kenney.nl)) | Kenney | CC0 1.0 | hits, metal ticks, plates, glass, bells (shield, guard, parry), punches, heartbeat thumps |
| [Interface Sounds](https://kenney.nl/assets/interface-sounds) (via mirror) | Kenney | CC0 1.0 | UI taps, clicks and confirms, mines, glass plucks for pickups, glitches |
| [Digital Audio](https://kenney.nl/assets/digital-audio) (via mirror) | Kenney | CC0 1.0 | energy bolts, arcs, phasers, power-ups, telegraph tones, reactions |
| [Space Shooter Redux](https://kenney.nl/assets/space-shooter-redux) bonus sounds (via mirror) | Kenney | CC0 1.0 | shield down/up |
| [Oculus Audio Pack 01](https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/) (via [Meta-open-sound](https://github.com/facebookincubator/Meta-open-sound)) | Oculus VR, LLC | **CC BY 4.0** | whooshes and swooshes (dodge, graze, cards), hull impacts, boss dread impacts and drone, UI confirm/back/error, power-ups, chimes, enemy heavy shots, ambience beds |

**Required attribution:** "Oculus Audio Pack 01" by Oculus VR, LLC (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0. Files renamed to the UCS naming convention; OGG previews transcoded from the original WAVs. Edited for LAST LIGHT as described above. The license text is in `third-party/oculus-audio-pack-CC-BY-4.0.txt`.

Kenney's packs are public domain (CC0); credit is given gladly, not required. See `third-party/kenney-audio-CC0.txt`.

## Code libraries

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| three.js 0.187 | three.js authors | https://github.com/mrdoob/three.js | MIT | Used strictly as a WebGL2 rendering library (scene graph, materials, renderer, BufferGeometryUtils). No engine features. |
| Electron 45 | Electron contributors | https://github.com/electron/electron | MIT | Desktop application runtime. Its distributed builds include Electron and Chromium license notices. |

## Fonts

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| Archivo | Omnibus-Type | https://fonts.google.com/specimen/Archivo (via @fontsource/archivo) | SIL Open Font License 1.1 | Swiss grotesk for all UI and display type (weights 400/600/800/900). Unmodified. |
| Silkscreen | Jason Kottke | https://fonts.google.com/specimen/Silkscreen (via @fontsource/silkscreen) | SIL Open Font License 1.1 | Pixel type for labels, keys, indices and tags only. Unmodified. |
| JetBrains Mono | JetBrains | https://fonts.google.com/specimen/JetBrains+Mono (via @fontsource/jetbrains-mono) | SIL Open Font License 1.1 | Readouts, coordinates, labels, perf overlay. Unmodified. |

## Dev tooling (not shipped)

TypeScript, Vite, Vitest, ESLint, Prettier, and electron-builder (MIT/Apache-2.0). Playwright (Apache-2.0) for automated playtests.

## Mood references (nothing copied)

Signalis, the palette discipline of Return of the Obra Dinn, Chris Foss space paintings, Outer Wilds lighting.
