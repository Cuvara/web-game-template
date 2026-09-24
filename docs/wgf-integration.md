# WGF integration contract

How a WebGameFactory-generated game uses this template end to end, and the one
configuration mechanism that drives it. Nothing here duplicates a portal SDK or
names one in game code — that is the whole point of the abstraction.

## The canonical configuration mechanism

There is exactly one source of truth: **`game.config.yaml`** at the repository
root. It is compiled into the virtual module `virtual:game-config` by
`scripts/build/game-config-plugin.ts`, and the runtime reads it through
`src/core/config.ts` (`config`, `primaryPlatform()`). Nothing else selects the
engine or the platform:

```yaml
engine:
  type: pixijs            # pixijs (2D) | threejs (3D) — the only two
platforms:
  - { id: generic-web, profile: generic-web@1.0.0, role: required }
```

- `engine.type` → `src/main.ts` calls `createRenderer(config.engine.type)`, which
  **dynamically imports** `@wgf/pixi-framework` or `@wgf/three-framework`
  (`src/rendering/create-renderer.ts`). The unused engine is code-split into a
  lazy chunk and never enters the initial download.
- `platforms[]` → `createPlatform(primaryPlatform().id, …)` selects the adapter.
  `primaryPlatform()` is the first `role: required` entry (else the first entry).
- `profile` pins `<platform-id>@<version>`; release validation records it in the
  manifest's `target_platforms[].profile_version`.

**There is no `WGF_PLATFORM` variable and no second mechanism.** To build a
variant without editing the committed file, point `WGF_GAME_CONFIG` at an
alternate YAML:

```bash
WGF_GAME_CONFIG=game.config.yandex.yaml pnpm build
```

The Factory overwrites `game.config.yaml`'s `platforms` (and `engine`) from
`tech_plan.repo_params.game_config` when it creates the repository; the scaffold
default targets `generic-web` because CI must be green before any game code
exists and `generic-web` needs no portal SDK.

## The flow

```
WGF creates repo from template (gh)
        │  overwrites game.config.yaml from the tech plan
        ▼
pnpm install --frozen-lockfile        # CI parity: node from .nvmrc, pnpm from packageManager
        ▼
develop  (src/ — the game; packages/* are the template and are not edited)
        ▼
pnpm build                            # vite → dist/, engine + adapter chosen from game.config.yaml
        ▼
browser  pnpm test:e2e                # template smoke (desktop + mobile), real Chromium
         pnpm test:sdk:browser        # engine × platform boot matrix, mocked portal SDKs
        ▼
verify   pnpm test:verify             # runtime facts
         pnpm facts && pnpm assert    # evaluate assertions against the pinned profile
        ▼
release  pnpm release:package  --release rN
         pnpm release:manifest --release rN --version <semver>
```

CI enforces the same gates: `ci.yml` runs lint, typecheck, unit, integration and
the SDK conformance project; `verify.yml` runs build, the e2e smoke, the SDK
browser matrix and the runtime-facts assertions. A game that is green locally is
green in CI (same Node/pnpm pins via `.github/actions/setup-workspace`).

## The platform abstraction contract

Game code imports **only** `@wgf/platform-sdk` and the template's binding helpers
(`bindPlatform`, `withAdBreak` from `src/platform/bind.ts`). It never touches
`window.YaGames`, `window.CrazyGames`, `PokiSDK`, or a GameVui global.

| Method / event | Meaning |
|---|---|
| `createPlatform(id, { namespace })` | Build the adapter for the primary platform |
| `initialize()` | Load and handshake with the portal (idempotent, degrades on failure) |
| `reportLoadingProgress()` / `signalReady()` | Loading API (Game Ready) |
| `gameplayStart()` / `gameplayStop()` / `gameplayActive` | Gameplay lifecycle — start on **first input**, not load |
| `showInterstitial(hooks?)` / `showRewarded(hooks?)` | Ads — resolve whether or not an ad played, never reject |
| `adAvailability?(kind)` | Whether to show an offer at all (CrazyGames) |
| `storage` (`get`/`set`/`remove`, `persistent`) | Cloud saves where the profile allows, local otherwise |
| `language`, `settings`, `environment`, `usage` | Portal-chosen locale, imposed settings, host details, usage snapshot |
| events `ad:start`/`ad:end`/`foreground:lost`/`foreground:gained`/`ad:late-reward`/`settings:change`/`storage:changed` | Signals bound to the Game pause model |

Grant a reward only when `RewardedResult.rewarded === true`, or when
`ad:late-reward` fires (a rewarded ad that opened after the call timed out — the
reward is owed exactly once). See `packages/platform-sdk/src/types.ts`.

### `AdResult.reason` semantics (normalized across adapters)

| Situation | `reason` |
|---|---|
| Portal SDK unavailable / not loaded / no fill | `not-ready` |
| Portal has ads switched off for this title | `disabled` |
| Another ad break already in progress | `busy` |
| Portal has no such ad kind (e.g. generic-web / GameVui) | `unsupported` |
| Ad blocker | `adblock` |
| Minimum interval not elapsed | `too-soon` |
| Portal SDK threw | `error` |

Conformance (`tests/sdk/conformance.test.ts`) asserts these so future divergence
fails CI.

## Adapter status

| Platform | Adapter | Notes |
|---|---|---|
| Yandex | `adapters/yandex.ts` | Full: loading, interstitial, rewarded (exactly-once + `ad:late-reward`), pause/resume, cloud storage, locale |
| CrazyGames | `adapters/crazygames/` | Full: ads with late-reward, local cooldown optimization, storage + fallback migration |
| Poki | `adapters/poki.ts` | Full: breaks with a timeout so the game cannot deadlock; mute/pause via `withAdBreak` |
| GameDistribution | `adapters/gamedistribution/` | Interstitial + rewarded (`SDK_REWARDED_WATCH_COMPLETE` only, exactly once, `ad:late-reward`), `SDK_GAME_PAUSE`/`START` as foreground, ad deadlines so the game cannot deadlock; requires `platforms[].game_id`; self-hosted wrapper packaging. See [platforms/gamedistribution.md](platforms/gamedistribution.md) |
| GameVui | *(none — by design)* | No public SDK exists; a GameVui build uses the `generic-web` adapter (local storage, no ads). `createPlatform("gamevui")` throws — the build never selects it |

## What crosses the boundary out

Release artifacts under `release/<release-id>/`: per-platform `<id>.zip` (dist
contents at the archive root — Yandex requires `index.html` at root), a
`checksums.txt`, and a `manifest.json` conforming to the Factory's
`release-manifest.schema.json` (`provenance`, `packages[].checksum` as
`sha256:…`, `target_platforms[].profile_version`, `changelog`). Sourcemaps are
never included — see [production-build.md](./production-build.md).
