# Performance

Budgets from the brief and how the build measures against them. Numbers marked *(headless)* come from automated runs in Chromium with SwiftShader (software WebGL on CPU) and are pessimistic for GPU cost; numbers marked *(node)* are pure simulation benchmarks.

| Target | Budget | Measured | Notes |
| --- | --- | --- | --- |
| Simulation | ≤ 4 ms | **0.74 ms/tick** *(node)* with 300 enemies, 3000 enemy bullets, primary+secondary+drones+halo firing | `tests/perf.test.ts` asserts < 6 ms |
| Draw calls | ≤ 250 | **46** in the stress scene *(headless)* | everything instanced: one draw per enemy mesh kind, plus its vector-edge halo and core (sharing the hull instance buffers), a native-res depth prepass, debris, drones, halos, particles, streaks, bullets, telegraphs + 9 post passes |
| Particles | 50,000+ | **65,536-slot GPU ring buffer** | analytic motion in the vertex shader; CPU writes only spawned slots |
| Projectiles | 3,000+ | **4,096 player + 3,072 enemy** pooled SoA | instanced quads in the readability layer |
| Enemies | 300+ | **325** live in the stress scene | spatial hash broadphase |
| GC | no per-frame allocation in hot paths | sim hot paths use scratch vectors and typed arrays | known small allocations remain in ricochet/chain target sets and a few view helpers (tracked below) |
| Download | < 60 MB | **~0.9 MB** total `dist/` (JS ~240 kB gzip) | no external assets; fonts are woff2 |
| First playable | < 5 s | boot is synchronous after JS parse; shader prewarm < 1 s on desktop GPUs | |

## Quality presets

| Preset | Internal pixel scale | Particle budget | Nebula strokes | Bloom |
| --- | --- | --- | --- | --- |
| Low | 1/4 | 40% | 600 | 0.6 |
| Medium | 1/3 | 70% | 1000 | 0.8 |
| High | 1/3 | 100% | 1400 | 0.9 |
| Ultra | 1/2 | 100% | 2000 | 1.0 |
| Auto | starts High, adapts internal resolution 0.6×–1.4× to hold < 19 ms frames | | | |

The final palette pass is the only full-resolution shader (16 OKLab distance tests per pixel); everything else runs at internal resolution.

## Tools

- **F3** perf overlay: FPS, frame/sim/render ms, draw calls, triangles, internal resolution, entity counts, particle estimate, attack tokens, build DPS estimate.
- **F1 → stress test** (or `__ll.stress()` in the console): 300 enemies + 3000 bullets + god mode.
- `node scripts/play.mjs <out> stress` runs the stress scene headless and prints counts.

## Known costs / TODO

- `new Set` allocations in ricochet targeting and chain lightning; replace with a stamp array.
- Afterimage matrices and a couple of per-instance quaternions in `View` allocate per frame.
- Real-GPU profiling on an Iris Xe laptop and a mid-range discrete GPU is still to do; headless SwiftShader runs at ~5 fps at 720p, which says nothing about GPU timing.
