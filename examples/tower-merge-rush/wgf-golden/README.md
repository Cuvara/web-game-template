# Tower Merge Rush — golden-run port

This directory is **not** part of the example: the example's build and tests never read it,
and the root typecheck does not include it (the root lint does, and it passes). It is the example adapted to the template's game
layout (`src/`, `tests/e2e/`, `public/locales/`, `index.html` at the repository root), used by
the Web Game Factory's **golden regression runs**.

In a golden run the Factory creates a game repository from a pinned commit of this template,
and its replay developer (`scripts/golden/replay_developer.py` in the Factory — a
deterministic stand-in, **not** an AI developer) copies:

1. the example's portable files (`src/game/rules.ts`, `src/rendering/board-view.ts`, the unit
   test) with import paths adapted — the mapping is the Factory's
   `scripts/golden/fixtures/2d/port.json`;
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

**The art.** The port draws the design's production art, never procedural stand-ins: every
tower, the track frame, the backdrop, the merge burst and streak, the title wordmark, the icon
set, the ui-kit card and both bundled fonts (Rubik Mono One display, Manrope body - Latin and Cyrillic, so the `ru` locale
is set in the design's faces) are loaded through
the runtime asset manifest, `public/assets/assets.json`, which the Factory's `assets` step
writes. `src/game/runtime-assets.ts` fetches it once at boot and resolves each asset by the
design's id, else by its role; `src/rendering/pixijs/art.ts` loads the board's textures and
`src/rendering/pixijs/tower-view.ts` draws them, with the merge feedback (drop bounce, merge
pop, burst, confetti, cascade streak, points). A build with no manifest - the greybox, before
the assets step - draws the same layout in primitives, and the play probe says so: each
entity carries `asset` and `render`, and the snapshot lists `assets_loaded`. The browser spec's
art test fails on any entity drawn as a primitive, with no asset, or by a placeholder, and on
any manifest file the game never fetched.

`library/` is the art itself, as an asset library the Factory reads (`library.json`, mapped by
the drop-merge design's requirement ids and, for any other id, by role): ten tower SVGs (one per level the rules reach) in
the design's riso-arcade identity, the frame, backdrop, effects, ui-kit, wordmark and icons
(CC0-1.0, written by `library/tools/make_art.py`), and the two OFL-1.1 fonts as subset WOFF2
with their licences. A golden run points `factory.assets.libraries` at it.

`baseline/` is the visual regression baseline: desktop (1280x720) and mobile (Pixel 5, touch)
screenshots of the title, play, a merge, pause, a near-full track, game over and a retry,
captured from a production build by `baseline/capture.mjs` through real input, with the play
probe's snapshots and every `/assets/` request the game made. Neither `library/` nor
`baseline/` belongs in a game repository.

## Music and sound

`library/audio/` holds the game's music and sound effects, mapped in `library.json` by the
design's `build_spec.audio` ids and imported by the assets step like the art. They are
composed as code - `library/tools/audio-score.js`, rendered by
`examples/wgf-golden-shared/library/tools/audio/render.mjs` in headless Chromium (Web Audio
offline: synthesized drums, bass, electric piano, marimba, lead, reverb, ducking, a mastering
chain), CC0-1.0 - and two cues layer CC0 Kenney recordings kept in `library/audio/sources/`.

| id              | file                      | what                                                                                |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `music-loop`    | `audio/music-loop.ogg`    | the play loop: swung pop-funk, F major, 120 BPM, 32 bars, 64 s, seamless (Ogg Opus) |
| `music-title`   | `audio/music-title.ogg`   | the title variant, 96 BPM without the kit, 40 s                                     |
| `sfx-drop`      | `audio/sfx-drop.wav`      | a piece landing (Kenney knock + sub thump)                                          |
| `sfx-merge`     | `audio/sfx-merge.wav`     | the merge pop, tuned to F; pitched up the scale per tower level                     |
| `sfx-combo`     | `audio/sfx-combo.wav`     | the cascade stinger                                                                 |
| `sfx-game-over` | `audio/sfx-game-over.wav` | the game-over sting (music ducks under it)                                          |
| `sfx-reward`    | `audio/sfx-reward.wav`    | the reward chime                                                                    |
| `ui-fanfare`    | `audio/ui-fanfare.wav`    | a new best                                                                          |
| `ui-tap`        | `audio/ui-tap.wav`        | buttons (Kenney click + tuned tick)                                                 |

`src/audio/audio.ts` (shared) plays them: nothing before the first input, silent under the
platform mute, an ad, a pause or the sound toggle; title and play music crossfade; stings
duck the music. The play probe reports `audio` - the music playing and the master output's
measured RMS. `library/audio/render-report.json` is each file's measured duration, RMS, peak
and loop seam. Re-render: `node examples/wgf-golden-shared/library/tools/audio/render.mjs
examples/tower-merge-rush/wgf-golden/library` from a checkout with dependencies installed.
