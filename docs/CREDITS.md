# Credits & asset log

LAST LIGHT ships **no third-party art assets**. Every model is procedural geometry built in code (`src/render/meshes.ts`), every texture is computed in shaders, and every sound effect is synthesized at runtime with the Web Audio API (`src/audio/audio.ts`). The recorded soundtrack below was supplied by the project owner. The original procedural score is still in the engine as a fallback and a settings option.

## Music

Supplied by the project owner for the sound-design phase. The tracks are by **digitaldro**, made with Suno (per the ID3 tags), and ship unmodified as 64 kbps / 48 kHz MP3 in `public/music/`.

| Track | Cue | Length | File |
| --- | --- | --- | --- |
| Last Analog Dawn | Title / Hearth | 3:40 | `menu-last-analog-dawn.mp3` |
| Proximity to Earth | Exploration (map, shop, events, drafts) | 3:44 | `explore-proximity-to-earth.mp3` |
| Proximity to Earth (II) | Exploration, alternates | 3:59 | `explore-proximity-to-earth-2.mp3` |
| Warp Drive | Combat | 3:09 | `combat-warp-drive.mp3` |
| Void Engagements | Combat, alternates | 1:39 | `combat-void-engagements.mp3` |
| Void Leviathan | Boss fights | 3:42 | `boss-void-leviathan.mp3` |
| Last Transmission | Victory / finale | 3:07 | `finale-last-transmission.mp3` |

Licensing note: Suno's terms tie commercial rights to the subscription tier the tracks were generated on. Confirm that tier before any commercial release.

## Code libraries

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| three.js 0.187 | three.js authors | https://github.com/mrdoob/three.js | MIT | Used strictly as a WebGL2 rendering library (scene graph, materials, renderer, BufferGeometryUtils). No engine features. |

## Fonts

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| Archivo | Omnibus-Type | https://fonts.google.com/specimen/Archivo (via @fontsource/archivo) | SIL Open Font License 1.1 | Swiss grotesk for all UI and display type (weights 400/600/800/900). Unmodified. |
| Silkscreen | Jason Kottke | https://fonts.google.com/specimen/Silkscreen (via @fontsource/silkscreen) | SIL Open Font License 1.1 | Pixel type for labels, keys, indices and tags only. Unmodified. |
| JetBrains Mono | JetBrains | https://fonts.google.com/specimen/JetBrains+Mono (via @fontsource/jetbrains-mono) | SIL Open Font License 1.1 | Readouts, coordinates, labels, perf overlay. Unmodified. |

## Dev tooling (not shipped)

TypeScript, Vite, Vitest, ESLint, Prettier (all MIT/Apache-2.0). Playwright (Apache-2.0) for automated playtests.

## Mood references (nothing copied)

Signalis, the palette discipline of Return of the Obra Dinn, Chris Foss space paintings, Outer Wilds lighting.
