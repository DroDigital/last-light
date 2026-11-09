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

## Balance pass (the Lantern was far too strong)

- **Measured first:** `npm run balance [runs] [good|ok|poor] [hull]` plays complete runs headlessly through the real sim. Each run is 5 sectors × (combat, combat, elite, combat, boss), a random draft pick after every fight, one 50% repair per sector, no meta upgrades and no shop.
- **Before:** the "ok" bot won 6/6 and the "poor" bot 3/3 without losing a single hull point. About 3 raw damage per fight, about 25 per boss.
- **Causes:**
  - Enemy damage never scaled with sector; only Heat 8 added any.
  - Enemy shots were slow (22–60 m/s) and half-led the player.
  - A 0.35 s post-hit grace let a whole volley land as one hit.
  - The director kept only about 3 enemies alive, each dying in about 3 s.
  - Shields fully reset per encounter and regenerated fast.
- **Levers:** all of them live in `src/data/balance.ts`, so tuning is one file.
  - **Enemy fire:** damage ×1.4 and +18% per sector; shot speed ×1.7; lead ×1.6 (capped at full lead); fire cadence ×1.5.
  - **Grace window:** 0.2 s.
  - **Attackers:** 4 + 1 per sector may attack at once.
  - **Density:** live threat 15 + 5 per sector; encounter budget 46 + 26 per sector.
  - **Toughness:** enemy HP ×1.35. Boss HP ×1.3, with bosses getting 60% of the per-sector HP growth so late fights don't turn into sponges. Boss fights deal ×1.5 damage.
  - **Ship:** shield 40, regen 10/s after 3 s.
- **Beams hit once:** lancer and boss beams go through `hurtPlayerBeam`, at most one hit per 0.5 s. With the shorter grace window, a lancer beam had been landing three hits for about 130 damage, a one-shot rather than pressure.
- **After** (10 runs each, random picks, no meta):

  | Bot skill | Wins | Notes |
  | --- | --- | --- |
  | Good | about 55% (8/10 and 3/10 across two batches) | dies in sectors 4–5 |
  | Ok | about 30% | deaths spread across sectors 2–4 |
  | Poor | 0% | dies in sector 2 |

  Sector 1 stays a gentle on-ramp, and bosses now cost 7–14 hull. Human players also have smart picks, shops, the forge and Hearth unlocks, so "hard but winnable" is the intent. Heat levels stack on top.
- **Known shape:** sector 2 (Salvage snipers and gunships) is a sharper step than sector 3. Worth a second look once real players have been through it.

## Dithered 3D props

- Beacons, star-map nodes, Hearth lanterns, gravity wells and decoys were rings or particle blobs. They are now instanced meshes in the same hull material as the ships: dithered by the post pass, vector-edged, lit parts tinted per instance (`View.queueProp`).
  - **Derelict beacons:** lattice lighthouses (hex plinth, three legs, mast, lamp house) with a turning lens crown. They brighten and spin up as they are relit, and throw a real point light once lit. The relight radius stays a crisp ring for the gameplay read.
  - **Star map:** every node type has its own landmark (rock station, spiked elite, ringed dying star, trading post, wreck, lamp post, forge, rift portal). Reachable nodes light up and turn. The player's actual ship is parked at the current node instead of a sprite.
  - **Hearth / title:** the ship rests by the fire, ringed by lamp pylons that light up with Hearth level.
  - **Wells and decoys:** wells get a dark singularity with a spinning accretion disc. Decoys are a flickering, half-dissolved ghost of the ship.
- **HUD fix:** combat HUD marks (target brackets, beacon labels, threat arrows) could stay frozen on the Hearth after leaving a run. The HUD now resets its transform and clears its full backing store every frame. `node scripts/play.mjs <out> props` checks that the Hearth HUD canvas is empty.

## Expansion: pacing, rarities, drops, move sets, the Deep, Endless, co-op

- **Pacing:** sectors are 8 rows long (7 choice rows plus the boss), with a guaranteed shop, rest and elite. Fights get 6% tougher per row: budget and HP for the rank and file, half that in damage, and nothing extra for bosses. The map camera sits steeper and follows the current row.
- **Rarities and affixes** (`data/affixes.ts`): Magic, Rare and Unique enemies carry 1, 2–3 and 3–4 affixes rolled from a 31-entry table. Stat affixes apply on spawn. Behaviour affixes hook into the world (damage, kill, hurt) and into `game/affixai.ts`, and every one telegraphs or shows on screen. Uniques get generated names. Odds rise with sector, Heat and encounter type.
- **Drops** (`data/drops.ts`): each kill rolls every drop kind against its category (swarm, fighter, heavy, support, debris, part, boss), times rarity ×4/×10/×25, Gilded ×2 and Luck. Shards, prisms and caches are banked and paid out as a queue of extra drafts after the fight, so combat never pauses for a menu. Bosses always drop a prism and a cache, and Uniques always drop a shard. A boss core's staged death used to pay its loot twice; it now pays on the final kill only. Tuned to about 15 bonus drafts per run.
- **Move sets** (`game/moves.ts`, `data/subtypes.ts`): 19 signature moves (dash, evade, flank, dive, retreat, blink, ram, burst, fan, feint, snipe, orb, spiral, ring, sweep, artillery, mines, call, bulwark). Every enemy type has 2–3 named variants with distinct move sets, rolled per spawn and gated by sector. Moves share the attack-token limit with the role AI, and their cooldowns are a balance lever.
- **Act II, the Deep:** five sectors, five palettes with backdrop features, and five live hazards.

  | Sector | Backdrop feature | Hazard |
  | --- | --- | --- |
  | VI · The Nebula Forge | gas pillars | ion storms |
  | VII · Event Horizon | black hole and accretion disc | central gravity well |
  | VIII · The Quasar Jets | twin jets | sweeping jets |
  | IX · Shattered Magnetar | magnetic field lines | magnetic pulses |
  | X · The Edge of Night | broken slivers | void rifts |

  Hazards (`game/hazards.ts`) all telegraph, run at 60% pressure during the boss, and act on both co-op ships.
- **The Deep's bosses:** Kiln Mother, Horizon Eater, Quasar Regent, Iron Magnetar and the Endless Night. All five fight in four phases and use the new patterns rain, nova, cross and clones (rare or unique elites).
- **Content:** 44 weapons (+12), 213 upgrades (+41 in 18 families), 30 synergies (+6), 41 enemy types (+12 Deep enemies, each with variants).
- **Endless:** a title-menu mode. Each wave is a finite fight that pays a draft. Every three waves the environment moves on through all ten sectors, and every fifth wave is a boss. The best wave is saved. Going Endless after a victory starts at wave 16 (wave 31 after Act II).
- **Local co-op:** Player 2 drops in with START on a spare controller.
  - **Sharing:** the build and the Light are shared; hull and shield are each ship's own.
  - **Implementation:** the world points `player` at Player 2 while it updates P2's flight, P2's guns and the enemies that chose P2 (nearest living pilot). Projectiles, explosions, hazards, motes and drops check both ships.
  - **Downed and revive:** a downed pilot is revived by the partner hovering close for 3 s, and the run ends only when both are down.
  - **Camera and tether:** the camera stays rigid behind P1 and pulls back to keep P2 in frame, and a soft tether keeps the fight together.
  - **Replays:** these record P1's controls only, so co-op fights are not replayable.
- **Balance after the expansion** (headless bots, random picks, no meta): the "good" bot clears Act I about a third of the time and reaches the Deep. The "poor" bot dies in sectors 2–3. The god-mode autopilot full run reaches victory with boss fights of 50–190 s.

- **Pilot classes:** every dive now starts on a class screen (title → Dive, Daily Dive, Endless, and the Hearth's Dive). Quick Dive skips it and flies the last pick.
  - **Three classes, all free:** Vanguard (the Aegis gunship: Flak Cannon + Siege Mortar, armored, shields regenerate faster while firing), Striker (the Kestrel interceptor: Coilshot + Cluster Pod, fast, an extra dodge, and each dodge primes +30% damage for 1.5 s) and Conduit (the Loom ring-ship: Arc Caster + Gravity Well + Interceptor Wing, +25% status power, faster abilities). Each has its own procedural model, hardpoints and accent.
  - **Skill trees:** each class has three branches of four tiers (costs 1/1/2/3), and tier 4 is a keystone. Nodes reuse the build vocabulary (stat mods, triggers, flags), so they stack with drafts like upgrades. Four keystone mechanics needed new code: Unbreakable (`vgLastStand`), Iron Will (`vgIronWill`), Deadeye (`stDeadeye`, bonus damage to the lock-on target and a stickier lock), and the Striker passive (`stSlipstream`).
  - **Progression:** class XP comes from every finished dive (kills, sectors, bosses, wins, Endless waves). There is one skill point per level up to level 12, which buys 12 of a tree's 21 points, so a build is a choice. Refunds are free outside a run, top-down per branch. `src/data/classes.ts` holds the data and rules.
  - **Balance** ("ok" bot, 20 full runs each, `npm run balance -- 20 ok <hull>`): the Lantern wins 4/20. Level-1 class ships win 7–8/20, a bit stronger because they start with weapons that otherwise cost Embers. With `CLASS_SKILLS=max` (level 12, points spent tier by tier) the Kestrel wins 11/20, the Aegis 13/20 and the Loom 14/20. The first max-level pass had a level cap of 15 and bigger node values, and won 15–18/20, so the cap and several flat bonuses (armor especially) came down.
  - **Hearth hulls:** the Lantern and the five bought hulls still fly from the class screen, with no tree. Saves migrate v4→v5 (`classes`, `selectedHull`). Returning pilots keep the Lantern selected; new saves start on the Vanguard.
  - **Class ships after the visual upgrade:** the Aegis, Kestrel and Loom were rebuilt in the player livery introduced with the hull overhaul (gunmetal plating, lighter armour, smoked-glass canopy, black intakes). They got the same detail kit as the Lantern: shrouded nozzles with hot inner discs, canted fins, leading-edge armour, livery stripes and running lights, plus class pieces (the Aegis's mortar mantlet and barrel fins, the Kestrel's coilgun coils and burner petals, the Loom's coil clamps and emitter tips). The class-screen turntable uses the hull shader's plating grid, hemispheric ambient and glossy highlight, so the preview matches the ship in flight.
  - **Menu refreshes:** a click that re-renders the same screen (learning a skill, a Hearth or Settings tab) no longer replays the panel and menu entrance animations.
- **Aim assist / lock-on audit:** the earlier implementation had five defects, now fixed and covered by `tests/aimassist.test.ts`.
  - **Mouse range:** a distance penalty was mixed into the cone threshold, so with a mouse nothing beyond ~96 units could be locked, even dead centre (the assist range is 240). Gating (cone + range) and ranking (angular error, mild distance preference) are now separate.
  - **Hitscan lead:** the assist led targets by the primary's projectile speed even for hitscan weapons (Railgun, beams, Arc), so it aimed hitscan shots in front of moving targets. Hitscan primaries now aim at the target itself.
  - **Convergence:** the guns always converged 90 units out, so wing-gun shots at close locked targets passed beside them. They now converge at the locked target's distance, and the reticle follows.
  - **Co-op and the off switch:** wingmen used Player 1's device settings (a weak mouse assist for a controller), and a slider at 0 still gave controllers 35% assist. Wingmen now always get controller assist, and 0 means off.
  - **Flicker and parts:** the lock had no hysteresis and could flicker between neighbours. It now holds within a wider cone unless a clearly better target appears. Locked boss parts now show their bracket.

## Combat feel: linked hardpoints, streaks, parry, shields

Early fights were one gun and one secondary against a few ships, and they dragged. This pass is about more things firing at once while keeping deaths where they were.

- **Linked hardpoints** (`Build.linked`, `linkMuzzle`/`runLinked` in `src/game/weapons.ts`): drafting a primary or secondary no longer replaces the main gun. It mounts outboard and fires on the same trigger, with its own cooldown. Two hardpoints to start; **Auxiliary Hardpoint** (uncommon, 2 stacks) raises it to `MAX_LINKS = 4`. When full, the oldest linked gun is replaced. The main primary keeps the loadout sides and effects. Wingmen fire linked guns with their own cooldowns (`Player.wingCd` now keys by hardpoint). Weapon cards come up more often while a hardpoint is open (24%/36% vs 14%/28%).
- **Opening armory:** every dive opens with a weapons-only draft (`newWeaponsOnly`, no systems). Endless waits for the pick before wave one (`after: 'wave'`).
- **Kill streak** (`World.streak`): kills within 3 s chain, each worth +2% fire rate up to +40%. Tiers SURGE/BLAZE/SUPERNOVA/LAST LIGHT at 8/20/40/80. Any hit halves it. **Momentum Engine**: +60% cap, 4.5 s window. Separate from the existing 0.45 s CHAIN counter, which is about simultaneous kills.
- **Guard and parry** (`GUARD` in `src/game/player.ts`): a new action (X / MMB / pad X), recorded in replays as bit 256. Holding it raises a bubble 1.4 m wider than the hull that leaks 30% of damage, slows you to 65% speed and stops your guns. It lasts up to 1.1 s and then locks out for 0.5 s. A hit inside the first 0.16 s is a perfect parry: no damage, a round is reflected as a homing shot at the lock target (max(40, 6× its damage)), a melee attacker takes a 60-damage counter, +6 Lumen, and the lockout is cleared so timed parries chain. The guard is edge-triggered: holding the key cannot keep the window open. Beams and explosions can be parried too (they go through `hurtPlayer`).
- **Shields:** new flags `overshield` (cap 150%, excess bleeds 6/s), `reflectSkin`, `capBurst`, `shieldRam`, `chargedShield`, `secondWind`, `guardLattice`, `riposte`, plus the Siphon Weave trigger and the **Hardlight Doctrine** synergy (4 shield tags). Shield Capacitor and Fast Recharge values went up.
- **Sustain drops:** a new **Shield Cell** drop (`barrier`), and Hull Patches now scale with max hull (12 + 8%). Odds roughly double for repair and are highest on heavies, supports and debris, so shooting rocks is a deliberate way to patch up.
- **Rebalance** (`npm run balance -- 20 <skill>`, 20 full runs, the Lantern; bots never guard). Linked guns roughly halved kill time and the denser fights paid ~50% more draft drops, which snowballed. Spent it on density and pressure: budget 46+26/sector → 58+32, live threat 15 → 17, `maxPower` 2.4 → 3, boss HP ×1.3 → ×2, enemy fire rate ×1.5 → ×1.75, enemy damage 1.25 (+0.24/sector) → 1.45 (+0.30/sector), and draft-paying drops ×0.5 (`DRAFT_DROP_SCALE`).

  | bot | wins before | wins after | combat fight | boss fight |
  | --- | --- | --- | --- | --- |
  | good | 6/20 | 6/20 | 49 s → 40 s | 34 s → 26 s |
  | ok | 7/20 | 7/20 | 55 s → 38 s | 36 s → 27 s |
  | poor | 1/20 | 0/20 | 52 s → 35 s | 38 s → 25 s |

  Win rates match within bot noise while fights are about 30% shorter and denser. Players who parry will find it easier than the bots do; tune `GUARD.parryWindow` first if it proves too generous.

## Bosses: signature attacks, escalation, Act II pacing

Bosses shared one pattern vocabulary (volley, ring, spiral, sweep...), so they felt alike and the early ones were walkovers. Act II fights turned into flying between far-off turrets.

- **Signature attacks** (`src/game/bossmoves.ts`): 41 attacks, 4–5 per boss (the Endless Night has 3 of its own plus Masks), built from a few hazard primitives (`Zone`: wave, shell, pillar, mortar, dark, snipe, lattice, tractor, polarity, horizon, stream, spokes, chain) and part launches (`Flight`). Each one telegraphs, and each has a counterplay: leave a wave's plane, roll or parry through a shell, slip between Coronation's bars, keep moving across a Molten Pour, find the gap in a Scrap Cage. The Endless Night's Masks borrow moves from earlier bosses.
- **Rendering:** every boss draws its attacks in its own colour on a per-tick vector layer (`BossController.fx`, drawn by the telegraph renderer). Hazards that need volume use four new shell-shader modes, sized each tick from the sim so they match the hitbox (`Shells.put`): shockfront (rim, travelling bands, noise tears), event horizon (empty core, photon ring, swirling accretion), umbra (boiling smoke with burning edges) and crystal (flashing facets). Enemy rounds keep the shared enemy tone for readability. No external assets: the procedural look fits the dither pipeline, so new techniques beat imported art here.
- **Escalation:** per-boss pattern tempo (0.6 for the Act I bosses down to 0.48 for the Endless Night), longer phase rotations, final-phase overlap pressure that grows with the boss's place in the run, contact damage 18 → 22, and boss HP multipliers (Act II ×2.2–3; their builds used to finish them in 10 s). Hazard damage is scaled ×0.75 as a set and `BAL.bossDamage` went 1.5 → 1.3, because there are now far more attacks.
- **Balance** (20 bot runs each; bots never dodge, roll or parry): good 6/20 → 2/20 wins, ok 7/20 → 0–2/20, poor unchanged at 0/20 (it still dies in normal sector 1–2 fights). Deaths now spread across the bosses of sectors 3–7 instead of piling up at the Last Dark. Humans have the counterplay the bots lack; if it is too much, raise `TEMPO` or lower `HP_MUL` in `src/game/bosses.ts` first.
- **Act II pacing** (`src/game/run.ts`): asteroid turret rigs are `optional` (excluded from live threat and the clear check). Director turrets drop in 38–58 m away, at most two at a time. When at most five hostiles remain and all are over 110 m away for 3.5 s, they warp in beside the pilot. Act II fights also get warp ambushes every 14–22 s, paid from the fight's budget, and 30% faster reinforcements.

## Changes from the brief (and why)

- **Recorded music instead of a procedural-only score**, at the project owner's request. The adaptive behaviour moved from stems to cue switching, resume-on-return, filtering and ducking.
- **No downloaded models or SFX samples.** Procedural assets fit the posterized style better than restyled free packs and keep the code build < 1 MB gzipped.
- **Abilities Q/E defined** as Shockwave/Stasis (brief left them open).
- **Gold Binary palette** is used for endless mode rather than a sector (five sectors, five bosses, six-plus palettes).
- **Vertical movement on R/C** (brief's table had no vertical keys); pad uses d-pad.

## STATUS / honest notes

- **STATUS:** Visual verification has been done in headless SwiftShader (CPU WebGL) at 1280×720; real-GPU frame timing still needs measuring on Iris Xe-class hardware (see PERF.md).
- **STATUS:** Destruction uses debris chunks with physics, not true Voronoi fracture. Bosses lose parts; heavy non-boss hulls break apart in two stages and die in secondary detonations.
- **STATUS:** Replays record and play back bit-for-bit (tested) for solo fights, but there is no replay viewer UI yet. Co-op fights are not recorded.
- **STATUS:** Act II difficulty is tuned against bots only; the Deep bosses need human playtesting.
- **STATUS:** The WebGPU path is not implemented.
- **STATUS:** Damage numbers and threat indicators draw on a 2D canvas; telegraphs and the readability layer are WebGL.
