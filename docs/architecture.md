# Architecture

## The split that matters

| Location                                                                                                               | Owned by     | A game may          |
| ---------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------- |
| `packages/*`, `scripts/`, build and test configs                                                                       | the template | use it, not edit it |
| `src/main.ts`, `src/core/`, `src/platform/*` (but the plan), `src/game/{context,integration}.ts`, `create-renderer.ts` | the template | use it, not edit it |
| `src/platform/integration-plan.ts`, `game.config.yaml`, `config/platforms/`                                            | the Factory  | read it             |
| `src/game/index.ts` (`createGame`) and the rest of `src/`                                                              | the game     | fill it in          |

The tech plan is required to say, for every system, what is generic, what is game-specific
and what is platform-specific. This tree is that answer made physical. Reimplementing in
`src/` something `packages/` already provides is the most common scaffolding mistake, and
the split is what makes it visible in review. The full list, and what the Factory enforces:
[factory-contract.md §1](factory-contract.md#1-ownership).

## Packages

- **`@wgf/game-core`** — fixed-timestep loop, scene manager, typed event bus, and the
  `Renderer` interface. Knows nothing about an engine or a portal.
- **`@wgf/platform-sdk`** — the platform abstraction plus one adapter per portal. The
  runtime counterpart of a platform profile.
- **`@wgf/analytics-sdk`** — one event vocabulary, batched, backend-agnostic.
- **`@wgf/pixi-framework`** / **`@wgf/three-framework`** — `Renderer` implementations for
  `engine.type: pixijs` and `engine.type: threejs`.

## The loop

Simulation runs in fixed steps; rendering interpolates between them with an `alpha` in
`[0, 1)`. A variable timestep makes gameplay depend on frame rate, which means a title
behaves differently on the low-end Android floor several platform profiles target than it
did on the machine it was built on.

A long frame — a backgrounded tab, an ad break — is clamped to `maxFrameMs` before it
reaches the accumulator. Without the clamp the loop answers one slow frame with hundreds of
catch-up steps and stalls harder.

## Pause has reasons, not a flag

`Game.pause(reason)` and `Game.resume(reason)` take one of `ad | hidden | manual | platform`
and count them. The game runs again only when every reason is released, so an ad that ends
while the tab is still hidden does not resume play. Portals reject for audio and input
leaking through an ad break; a single boolean is how that happens.

Time spent paused is discarded rather than accumulated. `Game.elapsedMs` is simulation time.

## The renderer seam

`engine.type` in `game.config.yaml` picks the engine. `src/rendering/create-renderer.ts`
imports the chosen framework dynamically, and the build defines `import.meta.env.WGF_ENGINE`
so Rollup drops the other engine entirely — bundling both would put an unused megabyte into
every build against caps as low as the 50 MB in the Factory's GameVui profile (unverified —
see [platforms/gamevui](platforms/gamevui/platform-contract.md)).

Game code holds a `Renderer` (`context.renderer`, already initialised on `#game`). It does
not import `pixi.js` or `three` outside `src/rendering/{pixijs,threejs}/`.

## The platform seam

Game code calls `GameIntegration` (`context.integration`) or `PlatformGameplay`
(`context.gameplay`) with the design's placement ids — never a `Platform` method, never a
portal SDK. `PlatformGameplay` (`src/platform/gameplay.ts`) looks the moment up in the
Factory-generated `INTEGRATION_PLAN` and drives `@wgf/platform-sdk`'s `Platform`. That rule is
what lets one game ship to several portals, and release validation checks it: every platform
profile carries a `package.platform_sdk` assertion, measured by scanning the shipped files.

Each build targets one platform and bundles only its adapter (`virtual:target-platform` →
`src/platform/target.ts`); `pnpm build:platforms` makes one build per `platforms[]` entry.

`PlatformCapabilities` is a field-for-field counterpart of the profile's `capabilities` and
the ad parts of `requirements`. `AdPolicy` enforces the profile's rules locally — an
unsupported ad kind or an interstitial inside the minimum interval is refused here rather
than by a reviewer weeks later.

Ads never throw. `AdResult.shown` is false with a reason, because a missing ad must not
break gameplay. Never grant a reward on `shown` alone; use `rewarded`.

## Configuration

`game.config.yaml` is written by the Factory at scaffolding from the tech plan approved at
G3, and is not hand-edited. The Vite plugin (`scripts/build/game-config-plugin.ts`, used by
`vite.config.ts`) validates it with `src/core/game-config.ts` at build time and exposes it as
`virtual:game-config`; `src/core/config.ts` is the only app module that reads it. The Node
scripts load the same validator (`scripts/_shared.mjs`), so build and tooling cannot disagree.

Validation is strict about `platforms`: pinned objects `{id, profile, role}`, never bare
strings, with `profile` matching `<platform-id>@<version>`, plus the per-portal ids
(`game_id`, `app_id`) where a portal needs them. An unpinned platform detaches the build from
the compliance rules that were in force when it was approved.

## Boot order

Portals whose profile sets `loading_api: required` list "does not report loading progress"
as a rejection cause, so the order in `src/main.ts` is part of the contract, and no game edit
can reorder it — the game runs inside step 4:

1. `bootPlatform` → the target's adapter → `initialize()` (a failing adapter degrades to an
   SDK-free one instead of a blank page)
2. `reportLoadingProgress()` 0.2 → strings → 0.4 → `createRenderer()` → 0.6 → `renderer.init`
3. `new Game()`, `bindPlatform`, `installGameplay(new PlatformGameplay(…))`
4. `createGame(context)` — the game's own loading maps to 0.6–0.8
5. 1.0 → `signalReady()` → `game.start()`
6. `gameplayStart()` on the player's first input, not at load — Poki's rule, and the right
   one everywhere: idle page views are not play time
7. the verify probe (`window.__wgf__`) and `#hud[data-ready="true"]`

`pnpm sdk:check` fails when this wiring is gone.
