# Design log

One line of reasoning per decision. Newest decisions at the bottom of each section. Honest status notes are marked **STATUS**.

## Architecture

- **three.js as renderer only.** Own loop, ECS-lite, physics, collision, input, audio, UI and saves, as the brief asks. three gives a solid WebGL2 backend and instancing without dictating game structure.
- **Fixed 60 Hz sim + interpolation.** Positions interpolate between ticks; *player rotation renders from the latest tick* so mouse aim has no interpolation lag (input-to-motion < 1 frame).
- **Hit-stop freezes the sim, never the renderer**, so shake/flash keep animating during the freeze.
- **Seeded sfc32 RNG for gameplay, separate `fxRng` for visuals.** Visual randomness can never desync daily runs. Map, drafts, shops, events, director and combat rolls all derive from the run seed.
- **Typed-array SoA stores** for projectiles (4096 player / 3072 enemy), motes, and debris; pooled plain objects for enemies; counting-sort spatial hash rebuilt per tick (zero allocation).
- **Content is data.** Weapons, upgrades, synergies, enemies, sectors, bosses, events, lore, unlocks and palettes live in `src/data`. Upgrades are generated from compact tier tables so 160+ entries stay maintainable.

## Rendering: Dithered Cosmos

- **HDR at ~1/3 res → dual-filter bloom → ACES → OKLab two-nearest palette dither → nearest upscale in the same pass.** Doing upscale inside the final shader avoids an extra target and keeps text/telegraphs native.
- **Two-nearest palette dither** (pick between the two closest OKLab colors using the ordered threshold) instead of "add noise then nearest": flat colors stay clean, gradients dither, and the `spread` slider is meaningful.
- **Readability overlay.** Player shots (mint-white bolts), enemy shots (warm-danger rings and diamonds with dark outlines), pickups and mines render into a separate low-res target in reserved tones that never pass through the palette. Colorblind variants swap the reserved tones.
- **Telegraphs are native-res additive lines** drawn after the post pass (lines, closing rings, spheres), never dithered.
- **Shimmer fix: sky-anchored dither.** Background pixels (alpha 0) take their dither coordinate from the view direction mapped to a cube, so the pattern travels with the nebula on slow pans; foreground (alpha 1) uses screen space.
- **Nebula = two layers of brushed-stroke billboards** following a swirl flow field: a far shell that follows the camera, and local dust strokes in world space for parallax that are lit by explosion lights.
- **16 dynamic point lights** shared by every lit material via one uniform rig; explosions, muzzle flashes, Flare and boss deaths spawn lights that visibly light hulls and dust.
- **Hull shader:** dark albedo, rim light only on edges facing the star, emissive mask per vertex, per-instance hit flash, dissolve (Hush deaths dither into static) and cloak.
- **GPU particles are stateless and analytic** (position = p0 + v·(1−e^(−kt))/k − ½gt²) in a 64k ring buffer; the CPU only uploads the slots spawned this frame.
- **Shader prewarm** at boot renders one frame containing every effect so the first explosion never compiles a program mid-fight.
- Fixed: the engine light originally sat inside the ship and blew it out to white; moved it behind the hull and cut muzzle-light intensity 6×. Rim light now requires star-facing normals. Bloom up-chain weights halved to keep glows tight.
- Fixed: engine ribbon trail stacked dozens of additive segments when stationary; trail now samples by distance travelled.
- **Palette as atmosphere:** each sector has a base "hush" (chroma drain + palette desaturation) that recedes as you harvest Light and vanishes when the boss dies and the star relights. The Last Dark boss drains it back during its Colorless phase.

## Art direction v2: Chroma Dither (three styles, one rule each)

The style brief evolved into a fusion of three explored directions. Each owns one job so they never fight:

- **Dithered Cosmos owns the world.** Painterly brushed-stroke nebula, explosion light, per-sector OKLab palettes, ordered dither. Unchanged base layer.
- **Dither-bloom vector owns energy.** Ships, enemies, drones, halos and afterimages draw their `EdgesGeometry` twice from the *same instance buffers as the hulls*: a halo into the low-res HDR scene (bloom + dither make it part of the painting) and a crisp 1px core at native resolution after the post pass. A native-res depth prepass of the hulls (layer 1, override material) gives the cores proper hidden-line occlusion. Player bolts became crisp vector cores with dithered HDR halos; kills spawn a yellow/cyan double vector shock ring and vector sparks; speed lines and the arena wall (a magenta lat/long grid that materializes near the boundary) are vectors too. Asteroids and debris stay pure silhouettes — dead rock has no energy.
- **Dithered brutalism owns information and the absence of light.** Swiss grotesk (Archivo 900, tight tracking, flush-left), hard rules, giant background numerals (stars relit on the title, sector number on the map), card index numerals, mono readouts (coordinates, mission clock, kill counter), TGT-xx target brackets and `DESTROYED / 042` kill confirmations. **Signal orange (#ff4f00) is the only UI accent and is never dithered.** Its 3-tone ink print (ink / warm gray / paper) appears where light dies: the death screen dissolves into it, and the Hush sector / Last Dark boss drown the palette in it via a *dithered dissolve between the two posterizations* (a second, offset Bayer threshold picks cosmos or ink per pixel). Hot light (fire, stars, explosions) prints as undithered signal orange inside ink scenes.
- **No paper-white backgrounds** (direction from the user): the brutalist style contributes its accents and ink tones only; menus stay on the dark cosmos and UI focus states use dark fills with signal-orange bars instead of inverted paper blocks.
- **Reserved tones re-cut for the fusion:** player fire cyan-white, enemy fire hot crimson (#ff2e63) rings/diamonds, pickups pale gold; signal orange is reserved for UI so it can never be confused with enemy fire.
- Fonts changed to Archivo + JetBrains Mono (both OFL); the previous faces were removed.

## Feel and juice

- **Trauma-based shake** (trauma², smooth value noise) plus separate recoil micro-kick, FOV kicks on boost/dodge.
- **Kills:** hit-stop 30–80 ms by size (rate-limited to one per 120 ms so swarms don't stutter), layered flash/fireball/ring/embers/faction flavor, dynamic light, escalating pitch on chains, music duck on big blasts.
- **Every event has ≥3 channels**: e.g. graze = sparkle ring + rising chime + Lumen gain (UI); hurt = glitch post + shake + hit-stop + crunch.
- **Flare:** slow-mo on activation (0.45 s), palette brightening in OKLab, ship glow, music filter fully open, doubled fire rate, ×1.5 damage.
- **Aim assist + hit padding.** Playtesting the first build showed 3D aiming at fast orbiters was miserable (11° tracking error, zero hits in 12 s). Added hit padding (radius×1.15 + 0.9), a wider assist cone (mouse 0.1 rad, pad 0.17 rad) and slowed orbiters ~25%.

## Gameplay systems

- **Flight:** strong drag (λ=7), local yaw/pitch with auto-level roll, boost with energy, dodge with i-frames and afterimages, soft spherical arena boundary with on-screen warning rings.
- **Abilities Q/E** became *Shockwave* (damage + knockback + clears nearby enemy bullets into motes) and *Stasis* (slows enemies and bullets around you). Both readable, both defensive "panic buttons".
- **Weapon slots:** primary (LMB), secondary (RMB), up to 3 autonomous systems (drones, halos, pulses). Picking a weapon of an occupied slot replaces it; duplicates level up.
- **Evolutions:** every one of the 33 weapons has a unique evolution at level 5 when the build carries its evolution tag. Evolutions always surface as the first draft card.
- **Synergies (18) + reactions (6).** Synergies activate from tag counts. Reactions (Shatter, Overload, Melt, Implosion, Glint, Static Rot) are always on and enter the codex when first triggered.
- **Trigger recursion guard** (depth ≤ 3, explosions depth ≤ 6) keeps on-kill chains finite; *Chain Reaction* synergy lets explosions trigger more explosions. Verified by `tests/buildsim.test.ts`.
- **Attack tokens** cap simultaneous telegraphed attacks (3 + sector/2); every damaging enemy attack has a telegraph (line, closing sphere, ring) or is a visible bullet.
- **Director:** budget-driven with authored formations (cluster, ring, line), paced build-up → peak → breather → peak, adapting to `dpsEstimate()` vs an expected curve and to player hull.
- **Run:** 5 sectors × (4 choice rows + boss). Node types: combat, elite, derelict, shop, event, forge, rest, rift, boss. Rifts appear once *Rift Charts* is unlocked at the Hearth.
- **Derelicts** became "relight the three beacons while ambushed" (fly within 14 units for 2.5 s each): it is the light puzzle the brief asked for and teaches the fantasy.
- **Power curve:** first build sim showed only 3.2× DPS growth vs 2.7× enemy HP growth. Raised damage/rate tiers, weapon level scaling (+20%/level) and cut sector HP scaling to +34%/sector. Median DPS now ~3.5× by the final sector before triggers/statuses (which the estimate under-counts).

## Meta

- **Embers** from progress (sector reached, kills, bosses, Light, win bonus, Heat multiplier).
- **The Hearth** title/hub is a 3D scene: a fire ringed by lanterns that relight as Hearth level (unlocks + wins) grows; the star behind it brightens.
- **Unlocks:** 6 hulls, 26 lockable weapons (7 starters), capped permanent boosts, pool expansions (rarer tiers, rift charts), Armory Access (choose starting primary), cosmetics (trail colors, paint, death bloom).
- **Heat 1–10** unlocks after the first win, one level per win. **Daily** runs use a UTC-date seed with a best-score table and a copyable share line.
- **Saves:** IndexedDB with localStorage mirror, versioned schema (v3) with migrations, export/import as a base64 code.

## Audio

- **SFX synthesized** (no samples): layered transient/body/tail, randomized pitch, per-sound voice limits, stereo pan by screen position, distance attenuation, music ducking, master limiter.
- **Recorded soundtrack (sound-design phase):** seven tracks by digitaldro stream through `audio/soundtrack.ts`, one `<audio>` element per track and each with its own gain on the music bus.
  - **Mixing:** the volume slider, the low-HP low-pass, the Flare filter opening and the explosion ducks all still apply. The procedural stems go silent and stop scheduling while a recorded cue is active.
  - **Cues follow game state:** menu on title/Hearth; exploration on map/shop/event/draft/forge/rest; combat on fights; boss on boss fights, entering after the 2.2 s reveal silence; finale on victory. Pause dips the music to 55% and death to 40%, with the low-pass on top.
  - **Tracks resume rather than restart:** a faded-out track keeps its position, so the exploration song carries on across a 90-second fight. Two-track cues alternate when a song ends; single-track cues loop.
  - **Beat pulse:** a low-band onset detector on the soundtrack bus drives the same UI/world breath pulse the procedural score did.
  - **Fallback:** a missing or blocked file falls back to the procedural score. Settings → Audio → Music switches between the two.
  - **Download:** about 32 MB of audio, streamed lazily per cue. Only the menu track loads at first input; the next likely cue is prefetched.
- **Procedural adaptive score (fallback / option):** pad / bass / drums / arp stems faded by intensity (live enemies, Flare, boss). Each sector has its own root, scale, tempo and timbre. Silence before boss reveals. Pulsar Heart's ring bursts are scheduled from the sector BPM so they land on the beat.

## Camera

- **Only two cameras in a run: 3rd-person chase and 1st-person cockpit.** Bug fixed: every in-run screen except combat/pause/death (draft, shop, event, forge, rest, victory, and warps leaving them) fell back to the title screen's free-drifting camera, parked at a fixed point in the arena — it looked like the camera randomly jumped to a far, free location. The ship camera now persists through all of them; the death orbit cam was removed too. The sector map remains a star-chart screen.
- **Cockpit HUD redesigned** as a minimal instrument cluster around the reticle (hull/shield and Lumen/boost arc gauges with 10% ticks, heading tape, roll/pitch horizon bars, flight-path marker, one systems line, target readout). The old cockpit frame lines, screen-corner brackets and side panels are hidden in 1st person, and target brackets collapse to a single lock diamond on the aimed target.

## Camera v2 and shots

- **Fixed chase camera.** The camera is now rigidly bolted to the ship's frame (offset 0, 3.2, 12 with a slight downward tilt): no spring, no lag, no trauma shake, no FOV kicks. Boost is the only thing that moves it (eases back, widens FOV, faint rumble). Juice that used to shake the camera still lands through flash, glitch, hit-stop, particles and sound.
- **Drift root causes fixed:** (1) the lagging camera spring; (2) unlocked-mouse "virtual joystick" steering turned the ship forever whenever the cursor rested off-centre or pointer lock was lost — removed; the HUD now says *Click to take control* instead; (3) turn input (e.g. gamepad stick noise) accumulated on non-combat screens and was dumped into the first combat frame — now discarded outside combat; (4) radial deadzone on the aim stick. Verified headless: heading and camera offset unchanged after 8 s with the cursor parked off-centre.
- **Projectiles leave the guns.** Per-hull hardpoints matched to each mesh (wingtip/pod guns for primaries, nose for secondaries/beams/arcs), following the visual bank/roll; shots converge on the aim point 90 m out. Rendering never interpolates a fresh shot behind its muzzle, offsets fresh shots by the ship's interpolation delta, and clamps vector tails to the distance flown. Regression test checks every hull's spawn point.

## UI v3: the Lantern interface

- First glass/minimal pass was rejected as generic. The UI is now drawn in the game's own language: chamfered ink plates, vector corner brackets (the same ones that lock onto enemies), **real ordered-dither** fills/fades/glows on the 3px game cell grid (masks baked at boot in `ui/dither.ts`), segmented cell bars, pixel type (Silkscreen) for labels/keys/indices only.
- **Interaction is light:** focusing any control ignites lantern gold that dithers in from its edge; primary actions are solid lantern plates; the selected thing is always the brightest thing on screen.
- **Sector tint:** panels, rules and tabs take their accent from the current sector palette (`PaletteDef.ui`).
- Readability rules: body text is never dithered, never below 12px, always on an ink plate; signal orange stays reserved for alerts.

## Determinism, replays, staged destruction

- **Replays:** `ReplayRecorder` (`game/replay.ts`) captures 18 bytes per tick. That covers movement as int16, yaw/pitch at 1e-6, button bits and the aim-assist values. Controls are quantized *before* the sim reads them, so a live run and its replay see identical inputs. `hashWorld` folds the float bits of every entity into an FNV hash.
- **Two hidden non-determinisms found by the replay test:** a global enemy-id counter (moved to `World.nextEnemyId`) and module-level gun-side alternation in `weapons.ts` (moved to `World.gunSide`). `tests/replay.test.ts` now proves same seed gives same hash, and that a recorded run replays bit-for-bit over 40 s of combat with status, chain, split and seeker upgrades.
- **Staged destruction:** heavy hulls (`threat >= 5`: carriers, bombers, shielders) shed plating at 66% and 33% HP. Each stage spawns seeded debris and fires a `breakup` event: a pop, a ring and sparks fanned out of the breach. From then on the hull vents embers and smoke, more of them at stage 2. On death it goes up in 3–5 staggered secondary detonations. All of this beyond the sim-side debris is visual-only (`fxRng`), so replays are unaffected.

## Draft card previews

- Every draft card has a looping vignette that shows what it does (`ui/preview.ts`). The Lantern sits on the left and Hush targets on the right, with the card's effect between them:
  - **Shots:** fans for multishot, curving homing and missile paths, pierce and ricochet.
  - **Impacts:** blast rings, split shots, chain arcs, crit stars, status flicker.
  - **Kills:** a kill burst, then the upgrade's on-kill trigger (nova, missiles, shards…).
  - **Ship effects:** shield and armor rings, dodge blink, speed streaks, magnet pull, graze sparks, ability pulse.
- What a card shows is derived from its data (behaviour, params, stat mods, triggers, tags). New content gets a preview without extra work, and `tests/preview.test.ts` renders every weapon, evolution and upgrade to prove each one is visible and finite.
- **Rendering:** software, into a 76×44 additive light buffer, resolved with the game's 4×4 ordered dither on the 3 px UI cell grid. Player shots use the reserved player tone and targets the enemy tone, so a preview reads like combat. It steps at 30 fps and stops when the card leaves the DOM. With reduced motion on, a single impact frame is shown instead.

## Readability pass (fresh eyes)

- **Text on plates:** the cause-of-death and victory lines sat directly on the bright dithered world, against the rule that body text always sits on an ink plate. Both now have plates.
- **Dialogue slide-in:** dialogue boxes reused the centred-hint keyframe (`translate(-50%)`) and slid in from outside their panel. They now have their own keyframe.
- **Short screens:** at 720p the death summary overflowed the viewport top. A max-height query tightens it.

## Changes from the brief (and why)

- **Recorded music instead of a procedural-only score**, at the project owner's request. The adaptive behaviour moved from stems to cue switching, resume-on-return, filtering and ducking.
- **No downloaded models or SFX samples.** Procedural assets fit the posterized style better than restyled free packs and keep the code build < 1 MB gzipped.
- **Abilities Q/E defined** as Shockwave/Stasis (brief left them open).
- **Gold Binary palette** is used for endless mode rather than a sector (five sectors, five bosses, six-plus palettes).
- **Vertical movement on R/C** (brief's table had no vertical keys); pad uses d-pad.

## STATUS / honest notes

- **STATUS:** Visual verification has been done in headless SwiftShader (CPU WebGL) at 1280×720; real-GPU frame timing still needs measuring on Iris Xe-class hardware (see PERF.md).
- **STATUS:** Destruction uses debris chunks with physics, not true Voronoi fracture. Bosses lose parts; heavy non-boss hulls break apart in two stages and die in secondary detonations.
- **STATUS:** Replays record and play back bit-for-bit (tested), but there is no replay viewer UI yet.
- **STATUS:** The WebGPU path is not implemented.
- **STATUS:** Damage numbers and threat indicators draw on a 2D canvas; telegraphs and the readability layer are WebGL.
