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
set, the ui-kit card and both bundled fonts (Bungee display, Figtree body) are loaded through
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
the drop-merge design's requirement ids and, for any other id, by role): eight tower SVGs in
the design's riso-arcade identity, the frame, backdrop, effects, ui-kit, wordmark and icons
(CC0-1.0, written by `library/tools/make_art.py`), and the two OFL-1.1 fonts as subset WOFF2
with their licences. A golden run points `factory.assets.libraries` at it.

`baseline/` is the visual regression baseline: desktop (1280x720) and mobile (Pixel 5, touch)
screenshots of the title, play, a merge, pause, a near-full track, game over and a retry,
captured from a production build by `baseline/capture.mjs` through real input, with the play
probe's snapshots and every `/assets/` request the game made. Neither `library/` nor
`baseline/` belongs in a game repository.
