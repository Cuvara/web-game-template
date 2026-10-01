# Neon Drift Arena — golden-run port

This directory is **not** part of the example: the example's build and tests never read it,
and the root typecheck does not include it (the root lint does, and it passes). It is the example adapted to the template's game
layout (`src/`, `tests/e2e/`, `public/locales/`, `index.html` at the repository root), used by
the Web Game Factory's **golden regression runs**.

In a golden run the Factory creates a game repository from a pinned commit of this template,
and its replay developer (`scripts/golden/replay_developer.py` in the Factory — a
deterministic stand-in, **not** an AI developer) copies:

1. the example's portable files (`src/game/simulation.ts`, `src/game/arena-view.ts`,
   `src/input.ts`, the unit test) with import paths adapted — the mapping is the Factory's
   `scripts/golden/fixtures/3d/port.json`;
2. `examples/wgf-golden-shared/` (the default integration seam implementation, audio);
3. this directory, onto the repository root (this README excepted).

Every file here carries a `GOLDEN-RUN REPLAY` header. The paths and imports are the ones the
files have **after** that copy, which is why they only typecheck inside a generated game
(`examples/wgf-golden-shared` is excluded from the root `tsconfig.json`; this directory is not
matched by its `examples/*/src` include).

Change these files only together with the Factory's golden runs: both must pass on the
template commit the Factory pins.

**The play probe.** `src/game/play-probe.ts` adds `window.__wgf__.play.snapshot()` - the
session state, the design's metrics, the entities a player must see with their screen bounds,
the inputs the player can make now, and (only with `?wgf-probe=1`) the input that succeeds
now. The Factory's `playability` step builds the game and plays it through real pointer and
key input at those positions, on a desktop and a mobile viewport, and holds what it sees to
the design's experience contract. Each port also shows the design's objective on screen
during play.
Neon Drift Arena's port adds an opening grace (`src/game/app.ts`): until the player first
steers in a run, a wall that reaches the craft passes through it, so a first-time player is
never failed for not moving yet.

## Production art: models, not boxes

The port draws with production assets, and fails when it regresses to cubes. Nothing in the
game builds a mesh for the craft or a wall: `src/rendering/threejs/assets.ts` reads the
Factory's runtime asset manifest (`public/assets/assets.json`), loads every listed GLB with
three.js's `GLTFLoader` and the fonts with `FontFace`, and `src/rendering/threejs/arena-view.ts`
draws the scene from them - the craft, one clone of the wall segment per wall, the track
modules (tiled and scrolled at the simulation's speed), the skyline, hemisphere / key / rim
lights, fog, a gradient sky, additive glow on thrusters, lamps and pylons, a crash burst and
flash, and a "close call" call-out on a near miss. A model missing from the manifest, a
placeholder, or a GLB that fails to load is a visible boot error.

`library/` is the art, as a Factory asset library (`library.json`, docs/assets-module.md in
the Factory), mapped by the role the arena-dodge archetype gives each requirement:

| Role                      | Files                                                                                                                                                                | Licence                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| player (`craft`)          | `models/craft.glb` - hull, nose, keel, canopy, swept wings with trim, wing fins, tail, twin thrusters with emissive nozzles                                          | CC0-1.0                                                    |
| threat (`wall`)           | `models/wall.glb` - posts, beam, sill, feet, a lit amber hazard panel with chevron and bars, neon trim, warning lamps                                                | CC0-1.0                                                    |
| environment (`arena-kit`) | `models/arena-track.glb` (floor, grid, lane lines, edge strips, guard rails, pylons with lights), `models/arena-skyline.glb` (sun, ridges, towers, beacons, horizon) | CC0-1.0                                                    |
| icon (`icons`)            | `icons/*.svg` - play, pause, retry, menu, sound, ad                                                                                                                  | CC0-1.0                                                    |
| font (`fonts`)            | Unbounded 800, Commissioner 500, JetBrains Mono 700 as Latin + Cyrillic subset WOFF2                                                                                 | OFL-1.1 (`fonts/OFL-*.txt`, shipped as `public/licenses/`) |
| `sky`, `crash-vfx`        | `textures/sky.png` (the night gradient, the scene background), `textures/spark.png` (the crash burst's particle), drawn by `textures/make-textures.py`               | CC0-1.0                                                    |
| `wordmark`, ui (`ui-kit`) | `ui/wordmark.svg` (outlined Unbounded glyphs, `ui/make-wordmark.py`), `ui/panel.svg` (9-slice card frame)                                                            | CC0-1.0                                                    |

Each GLB is built from the model spec beside it (`models/*.model.json`) by the Factory's
pinned Blender (4.5) through `scripts/wgf-model.py build --twice` (byte-identical), and held to
the Factory's model quality bars for its role (`wgf-model.py inspect`: craft and wall
`primitive_only: false`, verdict pass). `library/build-models.sh` rebuilds and inspects all
four. The runtime manifest comes from the Factory's asset CLI:

```bash
python3 <factory>/scripts/wgf-assets.py build --design <game-design.json> --root <game> \
  --library <game>/library --dimension 3d
```

**The guard.** The play probe reports, for the craft and every wall, the manifest asset that
draws it and `render` - `"asset"` only when every drawn mesh descends from a loaded GLB's root
(the build stamps `wgf_asset` on it), else `"primitive"` with `asset: null` - and lists
`assets_loaded`. The browser spec's last test fails if the craft or a wall is a primitive or
names no asset, if its manifest entry is a placeholder or box-sized (12 triangles), if a
required GLB was not fetched, or if the bundled faces are not loaded.

`baseline/<desktop|mobile>/` holds screenshots of the built game played with real keyboard,
mouse and touch input (title, playing, steer, close wall, near miss, crash, game over, retry,
pause), the asset requests and probe snapshots behind them (`evidence.json`), and the
Factory's production-quality gate on the same port (`production-gate/`, below).

**The production gate.** `baseline/production-gate/` is the Factory's (integration-2.6) real
`PlayabilityStep` then `ProductionQualityStep` on a golden 3D checkout with this port laid on
and its assets written by the real `AssetsStep` with `library/` configured: playability 24/24,
production quality PASS on desktop and mobile (assets present, loaded, referenced, rendered
and visible; no primitives; UI targets, overlap, text contrast and size, styling, states).
One Factory gap is bridged in that harness and recorded: the assets step leaves a library
GLB's quality `skipped` (it runs no model inspection for library files), so the harness sets
each model item's quality from the Factory's own `model_quality.assess` of the delivered GLB
(all pass, `primitive_only: false`); with the step's manifest as written, the gate fails only
`assets.present` for that reason (`production-quality-report.unassessed-manifest.json`).

## Music and sound

`library/audio/` holds the game's music and sound effects, mapped in `library.json` by the
design's `build_spec.audio` ids and imported by the assets step like the art. They are
composed as code - `library/tools/audio-score.js`, rendered by
`examples/wgf-golden-shared/library/tools/audio/render.mjs` in headless Chromium (Web Audio
offline), CC0-1.0 - and the crash and the UI tap layer CC0 Kenney recordings kept in
`library/audio/sources/`.

| id                  | file                          | what                                                                                   |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `music-drive`       | `audio/music-drive.ogg`       | the driving loop's base stem: synthwave, A minor, 112.5 BPM, 32 bars, 68.3 s, seamless |
| `music-drive-layer` | `audio/music-drive-layer.ogg` | its intensity stem (arpeggio, lead, open hats, claps, risers), same length             |
| `music-title`       | `audio/music-title.ogg`       | the title variant: pads, slow arpeggio, sub, 34.1 s                                    |
| `sfx-engine`        | `audio/sfx-engine.wav`        | a seamless 2 s engine loop                                                             |
| `sfx-pass`          | `audio/sfx-pass.wav`          | a wall going past                                                                      |
| `sfx-near-miss`     | `audio/sfx-near-miss.wav`     | a near miss: hard whoosh and doppler zing                                              |
| `sfx-crash`         | `audio/sfx-crash.wav`         | the crash (Kenney crunch, boom, metal, glass + sub drop)                               |
| `sfx-game-over`     | `audio/sfx-game-over.wav`     | the game-over sting                                                                    |
| `ui-fanfare`        | `audio/ui-fanfare.wav`        | a new best, a revive                                                                   |
| `ui-tap`            | `audio/ui-tap.wav`            | buttons (Kenney select + blip)                                                         |

`src/game/app.ts` drives it: both stems start in lock-step; as the speed rises the base's
low-pass opens and the layer fades in; the engine is re-pitched by speed and filtered and
panned by steering; every wall passing the craft whooshes, harder for a near miss; the crash
and the sting play over ducked music, which then crossfades to the title variant. A sound
toggle sits bottom-left on every screen. The play probe reports `audio` (the music playing
and the master output's measured RMS).
