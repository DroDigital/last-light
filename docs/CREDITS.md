# Credits & asset log

LAST LIGHT ships **no third-party art or audio assets**. Every model is procedural geometry built in code (`src/render/meshes.ts`), every texture is computed in shaders, every sound effect and every note of music is synthesized at runtime with the Web Audio API (`src/audio/audio.ts`). This keeps the download tiny and the look fully consistent with the Dithered Cosmos style.

## Code libraries

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| three.js 0.187 | three.js authors | https://github.com/mrdoob/three.js | MIT | Used strictly as a WebGL2 rendering library (scene graph, materials, renderer, BufferGeometryUtils). No engine features. |

## Fonts

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| Archivo | Omnibus-Type | https://fonts.google.com/specimen/Archivo (via @fontsource/archivo) | SIL Open Font License 1.1 | Swiss grotesk for all UI and display type (weights 400/600/800/900). Unmodified. |
| JetBrains Mono | JetBrains | https://fonts.google.com/specimen/JetBrains+Mono (via @fontsource/jetbrains-mono) | SIL Open Font License 1.1 | Readouts, coordinates, labels, perf overlay. Unmodified. |

## Dev tooling (not shipped)

TypeScript, Vite, Vitest, ESLint, Prettier (all MIT/Apache-2.0). Playwright (Apache-2.0) for automated playtests.

## Mood references (nothing copied)

Signalis, the palette discipline of Return of the Obra Dinn, Chris Foss space paintings, Outer Wilds lighting.
