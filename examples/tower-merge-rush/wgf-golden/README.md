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
