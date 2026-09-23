# Neon Drift Arena

A real Three.js (`engine.type: threejs`) example game for the web-game-template: an endless
neon-arena dodger. It exists to be the first genuine consumer of `@wgf/three-framework`'s
`ThreeRenderer` and to show a 3D game wired end to end through the platform abstraction.

## Gameplay

Drive a neon craft down an arena. Neon walls spawn ahead and rush toward you; steer between
them. The score climbs the longer you survive and for each wall cleared, and the walls speed
up as the run goes on. Hit one and it is game over — revive once with a rewarded ad, or race
again (an interstitial plays at that break where the portal supports one).

## Controls

- **Arrow keys / A / D** — steer left and right.
- **Pointer** — the craft follows the pointer's horizontal position; release to coast.
- **Space / Enter** — start a run from the menu.

## Running

```bash
# from the repo root, after a workspace install
pnpm --filter @wgf/example-neon-drift-arena dev      # vite dev server
pnpm --filter @wgf/example-neon-drift-arena build    # production build -> dist/
pnpm --filter @wgf/example-neon-drift-arena preview  # serve the build

# tests
pnpm vitest run examples/neon-drift-arena/tests/unit/simulation.test.ts   # pure-sim unit tests
pnpm --filter @wgf/example-neon-drift-arena exec playwright test          # e2e smoke (build first)
```

## Abstraction only

This game never imports a portal SDK. All platform access goes through `@wgf/platform-sdk`
(`createPlatform`) plus the template's `bindPlatform` / `withAdBreak`:

- `platform.gameplayStart()` fires on the player's **first input**, not on load — armed by
  `bindPlatform(...).armFirstInput()`.
- The rewarded revive uses `platform.showRewarded()` and grants the continue **only when
  `rewarded === true`**.
- The restart interstitial uses `platform.showInterstitial()` inside `withAdBreak`, which
  pauses, mutes and reports the game stopped for the ad and restores it afterward.
- Every ad path is graceful when the result is `{ shown: false }` — on `generic-web` (the id
  this example boots with) there is no portal and no ads, so both simply resolve to a skip.

## Determinism and test hooks

All gameplay logic lives in `src/game/simulation.ts`, a **pure** module with no Three.js, no
DOM and no platform. It has **no `Math.random`** — obstacle placement comes from a seeded
`Rng` (mulberry32) — and time only advances through `tick(stepMs)`. Same seed + same input
sequence always produces the same run, which is what makes it unit-testable and
Playwright-drivable without reading pixels.

`src/main.ts` installs a read-only/drive probe on `window.__game`:

| Member | Purpose |
| --- | --- |
| `score`, `best`, `state`, `phase`, `playerX` | Current run state (getters; reading advances nothing). |
| `play()` | Start a run from the menu. |
| `tick(dt)` | Advance the simulation by `dt` ms (fixed-step; routes through the scene update). |
| `steer(dir)` | Steer: `-1` left, `+1` right, `0` coast. |
| `spawnObstacleAt(x, z, halfWidth?)` | Place an obstacle deterministically (no RNG) — used to script a collision or a near miss. |
| `restart()` | Restart after game over (interstitial via the abstraction, then a fresh run). |
| `revive()` | Offer the rewarded revive; resolves `true` only when the portal confirms a reward. |
| `snapshot()` | A plain, cloneable view of the whole run. |

## Layout

```
examples/neon-drift-arena/
  package.json          @wgf/three-framework + three ^0.170.0, workspace:* deps
  vite.config.ts        @wgf/* aliased to package sources; base "./"
  index.html            #game canvas host + DOM HUD/menu/game-over
  playwright.config.ts  desktop + mobile projects, runs against vite preview
  src/
    main.ts             boot: ThreeRenderer + Game + createPlatform + bindPlatform; window.__game probe
    app.ts              the Scene: flow, lifecycle, ad routing (abstraction only)
    input.ts            keyboard + pointer -> steer direction
    game/
      simulation.ts     pure, seeded, deterministic gameplay (the source of truth)
      arena-view.ts     the only file that touches three; mirrors the sim into meshes
  tests/
    unit/simulation.test.ts   vitest: determinism, scoring, collision, clamping
    e2e/smoke.spec.ts         playwright: load, WebGL canvas, first-input start, score, game over, restart
```
