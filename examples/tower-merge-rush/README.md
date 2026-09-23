# Tower Merge Rush

A small, real PixiJS game built as a workspace example. It exercises the template end to end:
the `@wgf/pixi-framework` renderer, the `@wgf/game-core` `Game`/`Scene` loop, and — the point
of the example — the platform abstraction, with **no portal SDK called anywhere in the game
code**.

## How to play

Drop numbered tower pieces onto a single-row track of seven columns. A piece lands in the
column you choose; when two horizontally adjacent cells hold the same level they **merge** into
one cell of the next level up, and the merge cascades. Your score grows with every merge (and
with the level it produces). The piece you are handed ramps up as you merge more, so the track
fills faster over time. When the track is full with no move left, it is **game over**.

### Controls

- **Tap / click** a column to drop there.
- **Keys `1`–`7`** drop into that column.
- **Space / Enter** drop into the first open column.
- The **Play** button (start screen) makes the first move; the first input is also what starts
  the reported gameplay session (see below).

At game over you can:

- **Continue (ad)** — a rewarded ad clears the board but keeps your score, once per run.
- **Double score (ad)** — a rewarded ad doubles the final score.
- **Play again** — a fresh run, with an interstitial at that natural break.

## Everything platform-facing goes through the abstraction

The game never touches `window.YaGames`, `CrazyGames`, `PokiSDK` or `gamevui`. It obtains a
`Platform` from `createPlatform(id, …)` (id from `game.config.yaml`) and uses only the contract
and the template's helpers:

- **First input → gameplay start.** `bindPlatform(game, platform).armFirstInput()` reports
  `gameplayStart()` on the first pointer/key/touch input, **not** on load — the Poki rule the
  template documents. The game also brackets each run with `gameplayStart`/`gameplayStop`.
- **Rewarded (game over).** `platform.showRewarded()` for both Continue and Double score. The
  bonus is granted **only** when `result.rewarded === true`. A `{ shown: false }` answer (with
  a `reason`) is handled gracefully: the score is left untouched and the player is told.
- **Interstitial (restart).** `withAdBreak(game, platform, () => platform.showInterstitial())`
  wraps the restart, so the game is paused, muted and reported stopped around the ad, and an
  unfilled or failed ad never blocks the next run.

This example targets `generic-web`, which needs no external SDK — so ad requests answer
`{ shown: false }` and the graceful-miss path is what runs. Swapping the platform id in
`game.config.yaml` (and wiring the renderer choice) is all it would take to run the same source
against a real portal.

## Code layout

- `src/game/rules.ts` — the whole game as **pure logic**: `MergeGame`, plus pure functions
  (`resolveMerges`, `dropLevelForMerges`, `canDropAt`, `hasLegalMove`, …). No PixiJS, no DOM,
  no platform. This is what the unit tests drive directly.
- `src/rendering/board-view.ts` — the PixiJS view. Draw-only; reads a `Snapshot`, never mutates.
- `src/app.ts` — the `Scene` that owns *when* the platform is called (all the wiring above).
- `src/main.ts` — boot, the DOM HUD/screens, input, and the test hooks.

## Test hooks

`src/main.ts` installs a read-only-ish window probe for the e2e suite. Writes go through the
same `App` a player uses, so a hook can never reach a state real play could not.

```ts
window.__game = {
  state,          // "start" | "playing" | "over"           (getter)
  score,          // number                                  (getter)
  merges,         // number of merges so far                 (getter)
  dropLevel,      // level of the next piece                 (getter)
  board,          // (number | null)[] snapshot of the track (getter)
  levelAt(col),   // level in a column, or null
  dropAt(col),    // make a move (first call also begins the run)
  dropAnywhere(), // drop into the first open column
  continue(),     // rewarded "continue"  -> Promise<boolean>
  doubleScore(),  // rewarded "double"    -> Promise<boolean>
  restart(),      // interstitial + reset -> Promise
  paused(),       // Game.paused
  gameplayActive(),// platform.gameplayActive
};
```

The template's own `window.__wgf__` probe (`installProbe`) is present too, as in every build.

## Tests

- **Unit** (`tests/unit/rules.test.ts`, vitest): the pure rules — merges, cascades, ramp, the
  lose condition, and the `MergeGame` lifecycle (begin, scripted merge scores, refuse occupied
  column, reach game over, reset, continue, double). Picked up by the workspace `unit` project
  (`examples/*/tests/unit/**`), so `pnpm test:unit` runs it.
- **E2E** (`tests/e2e/smoke.spec.ts`, Playwright, desktop + mobile): page loads with a canvas
  and no fatal errors; first input starts gameplay; a scripted merge increases the score; game
  over is reachable; restart resets the score to zero; a rewarded continue is refused
  gracefully with no ad. Run with:

  ```bash
  pnpm exec playwright test -c examples/tower-merge-rush/playwright.config.ts
  ```

  The config builds and previews the production bundle itself, so no root wiring is needed.
