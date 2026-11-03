# Credits & asset log

LAST LIGHT ships **no third-party art or audio assets**. Every model is procedural geometry built in code (`src/render/meshes.ts`), every texture is computed in shaders, every sound effect and every note of music is synthesized at runtime with the Web Audio API (`src/audio/audio.ts`). This keeps the download tiny and the look fully consistent with the Dithered Cosmos style.

## Code libraries

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| three.js 0.187 | three.js authors | https://github.com/mrdoob/three.js | MIT | Used strictly as a WebGL2 rendering library (scene graph, materials, renderer, BufferGeometryUtils). No engine features. |

## Fonts

| Name | Author | Source | License | Use / changes |
| --- | --- | --- | --- | --- |
| Unica One | Eduardo Tunni | https://fonts.google.com/specimen/Unica+One (via @fontsource/unica-one) | SIL Open Font License 1.1 | Display face (titles, boss names). Unmodified. |
| Chakra Petch | Cadson Demak | https://fonts.google.com/specimen/Chakra+Petch (via @fontsource/chakra-petch) | SIL Open Font License 1.1 | UI face. Unmodified. |
| Syne Mono | Bonjour Monde | https://fonts.google.com/specimen/Syne+Mono (via @fontsource/syne-mono) | SIL Open Font License 1.1 | Numbers, seeds, perf overlay. Unmodified. |

## Dev tooling (not shipped)

TypeScript, Vite, Vitest, ESLint, Prettier (all MIT/Apache-2.0). Playwright (Apache-2.0) for automated playtests.

## Mood references (nothing copied)

Signalis, the palette discipline of Return of the Obra Dinn, Chris Foss space paintings, Outer Wilds lighting.
