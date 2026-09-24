# WGF integration

How a Web Game Factory game uses this template end to end. The exact API — every file, field,
script and exit code — is [factory-contract.md](factory-contract.md); this page is the tour.
Nothing here names a portal SDK in game code — that is the whole point of the abstraction.

## The canonical configuration

There is exactly one source of truth: **`game.config.yaml`** at the repository root, written
by the Factory at `init` from `tech_plan.repo_params.game_config`. `scripts/build/game-config-plugin.ts`
validates it (`src/core/game-config.ts`) and compiles it into `virtual:game-config`; the app
reads it through `src/core/config.ts` (`config`, `targetPlatform()`, `platformOptions()`).

```yaml
engine:
  type: pixijs # pixijs (2D) | threejs (3D) — the only two
platforms:
  - { id: generic-web, profile: generic-web@1.0.0, role: required }
  - { id: gamedistribution, profile: gamedistribution@1.0.0, role: optional, game_id: <32 hex> }
```

- `engine.type` → `createRenderer()` (`src/rendering/create-renderer.ts`) imports only that
  engine; the build define `import.meta.env.WGF_ENGINE` removes the other one from the bundle.
- `platforms[]` → one build per entry. A build targets one entry (`WGF_TARGET_PLATFORM`, else
  the first `role: required`, else the first) and bundles only that adapter, through
  `virtual:target-platform` → `src/platform/target.ts`.
- `profile` pins `<platform-id>@<version>`; release validation judges the build by the
  vendored `config/platforms/<id>.yaml` at that version, and the manifest records it in
  `target_platforms[].profile_version`.
- Portal ids live on the entry (`game_id`, `app_id`) or come from `WGF_Y8_APP_ID`,
  `WGF_Y8_GAME_ID`, `WGF_GAMEMONETIZE_GAME_ID`. A portal build without its required id fails.

To build against another config without editing the committed file:

```bash
WGF_GAME_CONFIG=game.config.yandex.yaml pnpm build
```

The untouched scaffold targets `generic-web`, because CI must be green before any game code
exists and `generic-web` needs no portal SDK.

## The flow

```
Factory init: repo from template (gh), writes game.config.yaml + config/platforms/
        ▼
pnpm install --frozen-lockfile         # CI parity: node from .nvmrc, pnpm from packageManager
        ▼
develop   src/game/index.ts createGame(context) and what it builds (docs/development/brief.md)
        ▼
sdk       Factory regenerates src/platform/integration-plan.ts (data only)
          pnpm sdk:check · pnpm sdk:conformance · pnpm sdk:prepare
        ▼
browser   pnpm build && pnpm test:e2e  # template smoke + game specs, desktop + mobile
          pnpm test:sdk:browser        # template game × platform × engine, mocked portal SDKs
        ▼
verify    pnpm build:platforms         # build/platforms/<id>/dist + build.json + index.json
          pnpm test:verify             # build/runtime-facts/<id>.json
          pnpm facts --platform <id> && pnpm assert --platform <id> --out build/assertions/<id>.json
        ▼
release   pnpm release:package  --release rN
          pnpm release:manifest --release rN --version <semver> --state rc
          pnpm publish:prepare  --release rN
```

CI enforces the same gates: `ci.yml` runs lint, typecheck, unit, integration, the SDK
conformance project and `sdk:check`; `verify.yml` runs build, the e2e smoke, the SDK browser
matrix and the runtime-facts assertions; `release.yml` runs `build:platforms` before
packaging.

## The game seam

Game code calls `GameIntegration` (`context.integration`) or `PlatformGameplay`
(`context.gameplay`). `src/main.ts` constructs both before `createGame`, from the target's
adapter and the Factory's `INTEGRATION_PLAN`. Placement ids are the game-design's ids; the
plan maps each to a moment (`game-over`, `level-complete`, `pause-menu`) and an ad kind.

## The platform abstraction

Underneath, `@wgf/platform-sdk`'s `Platform` interface — used by `src/platform/`, never by
game code. It never touches `window.YaGames`, `window.CrazyGames`, `PokiSDK`, `gdsdk`,
`sdk.showBanner` or `y8` outside its adapters.

| Method / event                                                                                                        | Meaning                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `createTargetPlatform(options)` (app) / `createPlatform(id, options)` (tests, tools)                                  | Build the adapter                                                              |
| `initialize()`                                                                                                        | Load and handshake with the portal (idempotent, degrades on failure)           |
| `reportLoadingProgress()` / `signalReady()`                                                                           | Loading API (Game Ready)                                                       |
| `gameplayStart()` / `gameplayStop()` / `gameplayActive`                                                               | Gameplay lifecycle — start on **first input**, not load                        |
| `showInterstitial(hooks?)` / `showRewarded(hooks?)`                                                                   | Ads — resolve whether or not an ad played, never reject                        |
| `adAvailability?(kind)`                                                                                               | Whether to show an offer at all                                                |
| `storage` (`get`/`set`/`remove`, `persistent`)                                                                        | Cloud saves where the profile allows, local otherwise                          |
| `language`, `settings`, `environment`, `usage`                                                                        | Portal-chosen locale, imposed settings, host details, usage snapshot           |
| events `ad:start`/`ad:end`/`foreground:lost`/`foreground:gained`/`ad:late-reward`/`settings:change`/`storage:changed` | Signals bound to the Game pause model by `bindPlatform` and `PlatformGameplay` |

A reward is granted only when `RewardedResult.rewarded === true`, or when `ad:late-reward`
fires (a rewarded ad that opened after the call timed out — owed exactly once). See
`packages/platform-sdk/src/types.ts`.

### `AdResult.reason` semantics (normalized across adapters)

| Situation                                               | `reason`      |
| ------------------------------------------------------- | ------------- |
| Portal SDK unavailable / not loaded / no fill           | `not-ready`   |
| Portal has ads switched off for this title              | `disabled`    |
| Another ad break already in progress                    | `busy`        |
| Portal has no such ad kind (e.g. generic-web / GameVui) | `unsupported` |
| Ad blocker                                              | `adblock`     |
| Minimum interval not elapsed                            | `too-soon`    |
| Portal SDK threw                                        | `error`       |

Conformance (`tests/sdk/conformance.test.ts`) asserts these so future divergence fails CI.

## Adapter status

All eight ids have an adapter, a subpath export (`@wgf/platform-sdk/adapters/<id>`) and a
conformance entry.

| Platform         | Adapter                      | Notes                                                                                                                                                                                                          |
| ---------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic Web      | `adapters/generic-web.ts`    | Self-hosted, no portal: local storage, no ads                                                                                                                                                                  |
| Yandex           | `adapters/yandex.ts`         | Loading, interstitial, rewarded (exactly-once + `ad:late-reward`), pause/resume, cloud storage, locale                                                                                                         |
| Poki             | `adapters/poki.ts`           | Commercial and rewarded breaks with a timeout so the game cannot deadlock; gameplay start/stop                                                                                                                 |
| CrazyGames       | `adapters/crazygames/`       | HTML5 SDK v3: ads with late-reward, local cooldown, storage + fallback migration                                                                                                                               |
| GameVui          | `adapters/gamevui.ts`        | No-SDK adapter by design — GameVui publishes none: local saves, ads `unsupported`, pause on hidden tab                                                                                                         |
| Y8               | `adapters/y8/`               | JS SDK 2-0: interstitial + rewarded, cloud storage for signed-in players; needs `app_id` (build fails without). See [platforms/y8.md](platforms/y8.md)                                                         |
| GameDistribution | `adapters/gamedistribution/` | Interstitial + rewarded (`SDK_REWARDED_WATCH_COMPLETE` only), foreground events, deadlines; needs `game_id`; self-hosted wrapper packaging. See [platforms/gamedistribution.md](platforms/gamedistribution.md) |
| GameMonetize     | `adapters/gamemonetize.ts`   | `sdk.showBanner()` interstitial only; needs `game_id` (build fails without). See [platforms/gamemonetize.md](platforms/gamemonetize.md)                                                                        |

## What crosses the boundary out

Per-platform builds under `build/platforms/` (with `dist_digest`, the Factory's
`bundle_digest`), runtime facts, facts and assertion results under `build/`, and release
artifacts under `release/<release-id>/`: one `<id>.zip` per platform made from that platform's
own build (dist contents at the archive root, no `*.map`), `packages.json` (`checksum`,
`content_digest`, `dist_digest`, build info), `checksums.txt`, and a `manifest.json`
conforming to the Factory's `release-manifest.schema.json`. See
[production-build.md](production-build.md) and [release.md](release.md).
