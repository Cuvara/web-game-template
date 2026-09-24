# Factory ↔ Template contract (version 2)

The authoritative API between Web Game Factory and a game repository created from this
template. The version is `package.json` → `wgf.template.contract` (`2`); the template version
the Factory records is `wgf.template.version`. Anything not written here is internal and may
change without a contract bump.

Every statement below is checked against the code it names. Where this page and the code
disagree, the code wins and this page is the bug.

## 1. Ownership

| Path                                                                                                                                                                       | Owner                | Who may write it                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `src/game/index.ts`                                                                                                                                                        | game                 | the developer (the one required entry)                          |
| `src/game/**` (except `context.ts`, `integration.ts`), `src/{ui,audio,input,assets,analytics}/`, `src/rendering/{pixijs,threejs}/`, `public/`, `tests/unit/`, `tests/e2e/` | game                 | the developer                                                   |
| `index.html`, `package.json` dependencies, `pnpm-lock.yaml`, `docs/development/`                                                                                           | game                 | the developer (package.json `scripts` must stay the template's) |
| `game.config.yaml`                                                                                                                                                         | Factory              | Factory `init` (from `tech_plan.repo_params.game_config`)       |
| `config/platforms/*.yaml`, `config/platforms/pinned.json`                                                                                                                  | Factory              | Factory `init` (profiles vendored at the pinned versions)       |
| `src/platform/integration-plan.ts`                                                                                                                                         | Factory              | Factory `sdk` step — this file only, whole-file, data only      |
| `docs/development/brief.md`, `brief.json`                                                                                                                                  | Factory              | Factory `develop` step                                          |
| `docs/development/report.json`                                                                                                                                             | game                 | the developer (the development report the Factory checks)       |
| `src/main.ts`, `src/core/`, `src/platform/{gameplay,game-integration,target,bind}.ts`, `src/game/{context,integration}.ts`, `src/rendering/create-renderer.ts`             | template             | nobody downstream — fix the template                            |
| `packages/`, `scripts/`, `.github/`, `tests/{sdk,integration,verify,support,…}`, every `*.config.ts`, `tsconfig*.json`, `eslint.config.js`, `pnpm-workspace.yaml`          | template             | nobody downstream — fix the template                            |
| `examples/`                                                                                                                                                                | template (reference) | nobody downstream; golden ports live here (§10)                 |

The Factory **never patches** a template-owned file. In contract 1 the `sdk` step rewrote
`src/main.ts` and copied `src/platform/gameplay.ts` / `game-integration.ts` in; in contract 2
the template ships them and `pnpm sdk:check` fails if the wiring is gone.

## 2. `game.config.yaml`

Parsed and validated by `validateGameConfig` in `src/core/game-config.ts` — one copy of the
rules, used by the Vite plugin (`scripts/build/game-config-plugin.ts`) and by every Node
script (`scripts/_shared.mjs` → `gameConfigRules()`). An invalid file fails the build and every
script that reads it.

```yaml
game: { id: <slug>, name: <string>, version: <semver> }
engine: { type: pixijs | threejs }
platforms:
  - id: <platform-id>
    profile: <platform-id>@<x.y.z>
    role: required | optional
    game_id: <portal game id> # gamedistribution, gamemonetize, y8 only
    app_id: <portal app id> # y8 only
monetization: { ad_kinds: [interstitial | rewarded | banner, ...], iap: <bool> }
build: { command: pnpm build, output: dist }
verification: { smoke_test: <bool>, performance_test: <bool>, mobile_test: <bool> }
publishing: { enabled: <bool> }
```

### `platforms[]`

- `id` ∈ `generic-web yandex poki crazygames gamevui y8 gamedistribution gamemonetize`
  (`KNOWN_PLATFORM_IDS`). Unknown id → error. An id listed twice → error.
- `profile` must match `^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$` and its id part must equal `id`.
- `role`: `required` or `optional`.
- Bare strings (`- poki`) are refused: every entry is a pinned object.

| Platform           | `game_id`                                                                                                        | `app_id`                                                    | Other                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `gamedistribution` | **required in the file**: 32 hex characters (case-insensitive), not the SDK placeholder `4f3d7d38…dc3a2333`      | refused                                                     | `hosting: gamedistribution` (default) or `self-hosted`; `game_url` (https, required when self-hosted) |
| `gamemonetize`     | **required at build**: `^[A-Za-z0-9_-]{8,64}$`, not a documented placeholder. File or `WGF_GAMEMONETIZE_GAME_ID` | refused                                                     | —                                                                                                     |
| `y8`               | optional (enables ads): `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. File or `WGF_Y8_GAME_ID`                           | **required at build**, same format. File or `WGF_Y8_APP_ID` | —                                                                                                     |
| any other          | refused                                                                                                          | refused                                                     | `hosting`/`game_url` refused                                                                          |

`monetization.ad_kinds` must be a list without repeats (empty = no ads); `iap` a boolean. These
declared kinds are what `package.uses_*_ads` facts report (§7).

### Build environment

| Variable                                                      | Effect                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WGF_GAME_CONFIG=<path>`                                      | Build and every script read that file instead of `game.config.yaml` (relative to the repo root).                                                                                                                                                          |
| `WGF_TARGET_PLATFORM=<id>`                                    | The platform `pnpm build` targets. Must be an `id` in `platforms[]`, else the build fails. Unset: first `role: required` entry, else the first entry. `build:platforms` sets it per entry itself.                                                         |
| `WGF_Y8_APP_ID`, `WGF_Y8_GAME_ID`, `WGF_GAMEMONETIZE_GAME_ID` | Override that platform entry's `app_id` / `game_id`. Win over the file; validated exactly like the file; an empty value counts as unset.                                                                                                                  |
| `WGF_ALLOW_UNCONFIGURED_PORTAL=1`                             | Tests and local development only. A target missing a required portal id (y8 `app_id`, gamemonetize `game_id`, gamedistribution `game_id`) builds anyway with `portal_configured: false`; `release:package` refuses it. Without it such a build **fails**. |
| `WGF_TEST_ENGINES=pixijs,threejs`                             | Engines the engine-matrix suites build (`tests/integration/platform-builds.test.ts`, `test:sdk:browser`). Default: both for the untouched template (`game.id: example-game`), else `engine.type` only.                                                    |
| `SOURCE_DATE_EPOCH`                                           | Zip entry timestamp for `release:package` (default 1980-01-01T00:00:00Z).                                                                                                                                                                                 |
| `GITHUB_SHA`                                                  | Commit `release:manifest` pins (default `git rev-parse HEAD`).                                                                                                                                                                                            |
| `WGF_LIVE=1`                                                  | Opt-in for `pnpm test:sdk:live` (real portal CDNs). Without it the script exits 3 (BLOCKED).                                                                                                                                                              |

## 3. Scripts the Factory calls

All run from the repo root after `pnpm install --frozen-lockfile`. Exit 0 = success unless
stated. Scripts under `scripts/` print one-line errors, never stacks, for expected refusals.

| Script                                                                                                                                                            | Inputs                                                                      | Outputs                                                                                                                                     | Exit codes                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                                                                                                                      | config + env (§2)                                                           | packages' `dist/`, then ONE Vite build for the target platform → `dist/` (dev, e2e, preview)                                                | non-zero on invalid config, unknown target, missing portal id, type/bundle error                                                              |
| `pnpm build:platforms` [`--out <dir>`] [`--skip-packages`]                                                                                                        | config + env                                                                | one Vite build per `platforms[]` entry → `build/platforms/` (§4). All entries resolved before any is built                                  | 1 on any config/portal-id error (nothing built) or build failure                                                                              |
| `pnpm typecheck`                                                                                                                                                  | —                                                                           | `tsc -b --force`, then `scripts/typecheck-examples.mjs`                                                                                     | non-zero on a type error                                                                                                                      |
| `pnpm lint`                                                                                                                                                       | —                                                                           | ESLint over the repo                                                                                                                        | non-zero on an error                                                                                                                          |
| `pnpm format` / `pnpm format:write`                                                                                                                               | —                                                                           | Prettier check / write                                                                                                                      | `format`: non-zero on unformatted files                                                                                                       |
| `pnpm test`                                                                                                                                                       | —                                                                           | Vitest projects `unit`, `integration`, `sdk`                                                                                                | non-zero on a failure                                                                                                                         |
| `pnpm test:e2e`                                                                                                                                                   | a built `dist/` (starts `pnpm preview` on 4173 itself)                      | Playwright projects `desktop`, `mobile` (`tests/e2e/`)                                                                                      | non-zero on a failure                                                                                                                         |
| `pnpm test:verify`                                                                                                                                                | `build/platforms/index.json` + dists, else `dist/`                          | `build/runtime-facts/<id>.json` per artifact; `build/runtime-facts.json` for the target (compat)                                            | non-zero when an artifact fails to boot                                                                                                       |
| `pnpm test:sdk:browser`                                                                                                                                           | —                                                                           | builds its own per-platform smoke bundles (`scripts/verify/sdk-smoke-build.mjs`), then `playwright.sdk.config.ts`                           | non-zero on a failure                                                                                                                         |
| `pnpm sdk:check` [`--root <repo>`]                                                                                                                                | source text of `src/`                                                       | JSON on stdout: `{ ok, root, checks: [{ id, ok, file, detail }], problems: [string] }`                                                      | 0 wiring intact, 1 otherwise                                                                                                                  |
| `pnpm sdk:conformance`                                                                                                                                            | —                                                                           | Vitest `sdk` project; JSON report `build/sdk-conformance.json`                                                                              | non-zero on a failure                                                                                                                         |
| `pnpm sdk:prepare` [`--out build/sdk`] [`--commit <sha>`]                                                                                                         | built `@wgf/platform-sdk` (run `pnpm build` first)                          | `build/sdk/integration.json`, `build/sdk/sdk-report.json`                                                                                   | 2 packages not built; 1 a declared ad kind a targeted adapter cannot show, or gamemonetize without a valid `game_id` / without `interstitial` |
| `pnpm golden:check` [`--example <name>`] [`--skip-e2e`] [`--keep`]                                                                                                | `examples/*/wgf-golden.port.json`                                           | JSON on stdout: `{ ok, ports: [{ example, engine, steps, ok, error? }] }`; writes nothing to the repo                                       | 0 all ports pass (or none exist), 1 a port failed, 2 usage/setup error                                                                        |
| `pnpm facts --platform <id>` [`--runtime <p>`] [`--out <p>`]                                                                                                      | the platform's artifact (§4) + runtime facts                                | `build/facts/<id>.json` (default)                                                                                                           | 2 usage / no artifact; 1 runtime facts from another platform, or an undeclared ad kind requested                                              |
| `pnpm assert --platform <id>` [`--facts <p>`] [`--out <p>`]                                                                                                       | `config/platforms/<id>.yaml` at the pinned version, `build/facts/<id>.json` | results printed; `[{ criterion_id, measured, breached, severity, … }]` written only with `--out` (convention: `build/assertions/<id>.json`) | 0 no blocking breach, 1 a blocking breach, 2 usage / no profile / no facts                                                                    |
| `pnpm release:package --release r<n>` [`--platform <id>`]                                                                                                         | `build/platforms/` (§4)                                                     | `release/r<n>/<id>.zip`, `packages.json`, `checksums.txt`                                                                                   | 2 bad usage, 1 refused (§8) — nothing written on refusal                                                                                      |
| `pnpm release:manifest --release r<n> --version <semver>` [`--kind initial\|content\|hotfix\|rollback`] [`--state draft\|rc`] [`--freeze`] [`--changelog <text>`] | `release/r<n>/packages.json`, config                                        | `release/r<n>/manifest.json`                                                                                                                | 1 refused (§8); a re-run with identical content is a no-op success                                                                            |
| `pnpm publish:prepare --release r<n>` [`--platform <id>`] [`--state submitted`] [`--portal-reference <id>`] [`--submitted-by <name>`]                             | `release/r<n>/manifest.json`, `build/assertions/<id>.json`, profile         | `release/r<n>/publications/<id>.json` (state `validated` / `validation-failed`, human checklist)                                            | 2 bad usage; 1 missing manifest or assertion results, or any platform `validation-failed`                                                     |

Game-independent helpers also exist (`test:sdk:matrix`, `test:sdk:live`, `test:poki`,
`test:crazygames`, `demo:*`, `audit:*`); they exercise the template's adapters and examples.

## 4. Build outputs

`pnpm build` → `dist/` (one target; never packaged for release).

`pnpm build:platforms` → for each `platforms[]` entry, in order:

```
build/platforms/<id>/dist/        the artifact for that platform
build/platforms/<id>/build.json
build/platforms/index.json
```

```jsonc
// build/platforms/<id>/build.json
{
  "schema": "wgf-platform-build/1",
  "platform": "<id>",
  "profile": "<id>@<x.y.z>",
  "role": "required | optional",
  "engine": "pixijs | threejs",
  "game_id": "<game.id>",          // the title id, NOT the portal game_id
  "game_version": "<game.version>",
  "commit_sha": "<40-hex> | null", // null outside a git checkout
  "dist_digest": "sha256:<hex>",
  "portal_configured": true         // false only under WGF_ALLOW_UNCONFIGURED_PORTAL=1
}
// build/platforms/index.json
{
  "schema": "wgf-platform-builds/1",
  "game_id": "<game.id>", "game_version": "…", "engine": "…", "commit_sha": "… | null",
  "platforms": [
    { "id": "<id>", "profile": "…", "role": "…", "dir": "build/platforms/<id>/dist",
      "dist_digest": "sha256:<hex>", "portal_configured": true }
  ]
}
```

`dir` is repo-relative with forward slashes.

**Isolation.** A build bundles only its target's adapter (`virtual:target-platform` imports
one `@wgf/platform-sdk/adapters/<id>` subpath) and only its engine (`import.meta.env.WGF_ENGINE`
removes the other engine's dynamic import). No other portal's SDK signature appears in the
output. `createPlatform(id, …)` in `@wgf/platform-sdk` stays for tests and tools; the app never
calls it (`sdk:check` → `no-registry-boot`).

## 5. Digests

**`dist_digest`** = the Factory's `bundle_digest` (`distDigest` in `scripts/_shared.mjs`, the one
implementation). Walk the dist directory top-down as Python `os.walk` does: a directory's files
in code-point order, then its sub-directories in code-point order, skipping `node_modules`. For
each file, feed `relpath_from_REPO_ROOT` (forward slashes, UTF-8) + `\0` + raw
`sha256(file bytes)` into one outer SHA-256. Result: `"sha256:" + hex`. The path is relative to
the **repository root**, not to the dist, so the same bytes under another directory digest
differently.

**`content_digest`** (per package, `contentDigest` in `scripts/release/package.mjs`) = the
Factory's archive content digest: for each zip entry in code-point name order, feed
`name` (UTF-8) + `\0` + raw `sha256(entry bytes)` into one outer SHA-256; `"sha256:" + hex`.
Unlike `checksum` (sha256 of the zip bytes) it ignores timestamps and compression.

## 6. Boot and game API

### The one entry a game implements

```ts
// src/game/index.ts — GAME-OWNED
export async function createGame(context: GameContext): Promise<GameHandle>;
```

The template default builds `BootScene` (`src/game/boot-scene.ts`, game code a real game
replaces). Nothing else in `src/game/` is required.

### `src/main.ts` boot order (template-owned)

`bootPlatform` (target adapter via `createTargetPlatform`) → `#hud[data-platform]` → progress
0.2 → `loadLocale` → 0.4 → `createRenderer()` → `#hud[data-engine]` → 0.6 → `renderer.init` →
`new Game()` (+ `scene:changed` → `#hud[data-scene]`) → `bindPlatform` →
`installGameplay(new PlatformGameplay(…))` → **`createGame(context)`** → 0.8 → resize wiring →
1.0 → `signalReady()` → `game.start()` → `binding.armFirstInput()` (gameplayStart on first
input) → `installProbe` → `#hud[data-steps]` publisher → `#hud[data-ready="true"]`. A boot
failure sets `#hud[data-ready="false"]` and writes the error into `#hud`.

### `GameContext` / `GameHandle` (`src/game/context.ts`, template-owned)

```ts
interface GameContext {
  readonly game: Game; // @wgf/game-core; loop not started yet
  readonly renderer: Renderer; // initialised on #game, resized by main.ts
  readonly container: HTMLElement; // #game
  readonly hud: HTMLElement; // #hud; main.ts owns data-ready/scene/steps/engine/platform
  readonly ui: HTMLElement; // #ui, created when index.html has none
  readonly i18n: I18n;
  readonly integration: GameIntegration;
  readonly gameplay: PlatformGameplay;
  readonly platform: PlatformInfo; // { id, target, capabilities, language } — facts only
  readonly audio: AudioGate; // { muted, onMutedChange(listener) => unsubscribe }
  readonly config: GameConfig;
  viewport(): ViewportSize; // { width, height, devicePixelRatio } of #game
  onResize(listener: (size: ViewportSize) => void): () => void;
  reportLoadingProgress(fraction: number): void; // [0,1] of the game's own loading → 0.6..0.8
}
interface GameHandle {
  readonly audio?: GameplayAudio; // { mute(); unmute() } — silenced for ads / portal mute
  dispose?(): void; // called on a final pagehide
}
```

### `GameIntegration` (`src/game/integration.ts`, template-owned; = Factory `INTEGRATION_CONTRACT`)

```ts
interface GameIntegration {
  gameplayStart(): void;
  gameplayStop(): void;
  canOfferRewarded(placement: string): boolean;
  rewarded(placement: string): Promise<boolean>; // true only when the reward must be granted
  interstitial(placement: string): Promise<void>; // resolves whether or not an ad showed
  track(event: string, properties?: EventProperties): void;
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}
```

Implemented by `PlatformGameIntegration` (`src/platform/game-integration.ts`), which maps each
`placement` id to its moment in `INTEGRATION_PLAN` and hands it to `PlatformGameplay`.
Placement ids are the game-design's placement ids.

### `PlatformGameplay` (`src/platform/gameplay.ts`, template-owned)

```ts
type GameplayMoment = "game-over" | "level-complete" | "pause-menu";
class PlatformGameplay {
  readonly platform: Platform;
  readonly target: string;
  readonly inputEnabled: boolean;
  runStarted(properties?): void;
  runStopped(properties?): void;
  continueFrom(moment: GameplayMoment, properties?): Promise<void>;
  gameOver(properties?): void;
  levelComplete(properties?): void;
  pause(): void;
  resume(): Promise<void>;
  canOfferReward(moment: GameplayMoment): boolean;
  offerReward(moment: GameplayMoment): Promise<RewardOutcome>; // { rewarded, reason }
  naturalBreak(moment: GameplayMoment | null): Promise<void>;
  track(name: string, properties?): void;
  momentOf(placementId: string): GameplayMoment | null;
  save(key: string, data: unknown): Promise<boolean>;
  load<T>(key: string, fallback: T): Promise<T>;
  moments(): readonly GameplayMomentRecord[]; // { name, moment, placement, atMs }
  dispose(): void;
}
function installGameplay(gameplay: PlatformGameplay): PlatformGameplay;
function gameplay(): PlatformGameplay; // throws before main.ts installed one
function bootPlatform(boot: BootOptions): Promise<BootedPlatform>;
// BootOptions  { target, options: CreatePlatformOptions, plan: { adapterSubstitutes }, create?, fallback? }
// BootedPlatform { platform, target, substitutedBy, degraded: { reason: "init-failed", target, detail } | null }
```

### `IntegrationPlan` (`src/platform/integration-plan.ts`, Factory-written data)

```ts
export const INTEGRATION_PLAN: IntegrationPlan = {
  titleId: string,
  placements: [{ id, kind: "interstitial" | "rewarded" | "banner", moment: GameplayMoment,
                 trigger: string, platforms: string[] | null }],
  adapterSubstitutes: Record<string, string>,  // target id -> adapter id (SDK-free only)
  breakOnContinue: string[],                   // targets that want a break on every continue
};
```

Template default: `titleId: "web-game-template"`, everything empty (no ads, rewards hidden).

### Other template-owned modules

- `src/core/config.ts`: `config`, `targetPlatform(): PlatformEntry`,
  `platformOptions(entry): CreatePlatformOptions` (namespace, `gamedistribution`,
  `portalGameId`, `y8`), `primaryPlatform` (deprecated alias of `targetPlatform`).
- `src/platform/target.ts`: `targetPlatformId`, `createTargetPlatform(options): Platform`.
- `src/rendering/create-renderer.ts`: `createRenderer(engine?): Promise<Renderer>`; a passed
  `engine` must equal the built one or it throws.
- `src/platform/bind.ts`: `bindPlatform(game, platform, options)`, `withAdBreak(...)`.

### `pnpm sdk:check` check ids

`main-present`, `boot-platform`, `gameplay-installed`, `gameplay-constructed`, `create-game`,
`signal-ready`, `boot-order` (bootPlatform → installGameplay → createGame → signalReady),
`no-registry-boot`, `imports-gameplay`, `imports-plan`, `imports-game`, `integration-plan`,
`gameplay-module`, `game-integration`, `game-entry`. Comments are stripped before matching.

## 7. QA / browser contract

**DOM.** `index.html` has `#game` and `#hud`; `#ui` is optional (created at boot). `main.ts`
maintains, on `#hud`: `data-ready` (`"true"` after boot, `"false"` on boot failure),
`data-scene` (active scene id, from `scene:changed`), `data-steps` (fixed steps run),
`data-engine`, `data-platform`. On `<html>`: `data-audio-muted`. A game may set other `data-*`
attributes and the text of `#hud`; it must not write the five above.

**Probe** `window.__wgf__` (`src/core/probe.ts`), in every build, read-only:
`gameId`, `gameVersion`, `platformId` (adapter running), `target` (build target), `engine`,
`timeToInteractiveMs`, `usage()`, `framesRendered()`, `elapsedMs()`, `steps()`, `scene()`,
`paused()`, `moments()` → `[{ name, moment, placement, atMs }]`.

**Playwright.** `playwright.config.ts` projects: `desktop` + `mobile` (`tests/e2e/`, against
`pnpm preview` on port 4173) and `verify` (`tests/verify/`, own preview servers from 4273). The
Factory maps tests to gameplay aspects by `@aspect` tags in the test title:
`@boot @loading @start @input @core-loop @progression @game-over @restart @pause-resume
@responsive`. Tests in the `mobile` project also count as `@responsive`.

Inherited, game-agnostic specs (every game keeps them green unchanged):
`tests/e2e/smoke.spec.ts` (`@boot @loading @core-loop`), `tests/e2e/pause-resume.spec.ts`
(`@pause-resume`), `tests/e2e/responsive.spec.ts` (`@responsive`), `tests/verify/facts.spec.ts`,
the `sdk` conformance project and the SDK browser smoke. A game adds its own specs under
`tests/e2e/` for `@start @input @progression @game-over @restart`.

**Runtime facts** (`build/runtime-facts/<id>.json`): `platform`, `artifact`, `package`
(`calls_loading_api`, `insecure_requests`, `external_links`, `mobile_supported`,
`perf.time_to_interactive_s`, `perf.lowend_android_fps`), `adsRequested`, `observed`
(`platformId`, `target`, `engine`), `measured_at`. Portal SDK requests are blocked.

**Facts** (`build/facts/<id>.json`): runtime `package.*` merged with static ones —
`size_mb`, `locales` (from `dist/locales/*.json`), `platform_sdk` (scan of shipped
`.js/.mjs/.cjs/.html/.htm` for `packages/platform-sdk/sdk-signatures.json`: one portal id,
`"none"`, or `"mixed:<a>,<b>"`), `uses_banner_ads` / `uses_rewarded_ads` /
`uses_interstitial_ads` (from `monetization.ad_kinds`, never observation), `portal_configured`,
`runtime_platform(_matches)`; `metadata.screenshots`; `evidence`.

**Assertions** (`build/assertions/<id>.json`): each profile assertion plus `profile_pin` (the
vendored profile's version must equal the pin; its hash must match `pinned.json` when listed).
An assertion that cannot be evaluated counts as breached.

## 8. Release

`release:package` refuses (exit 1, writes nothing) when: the release id is not `^r[0-9]+$`;
`build/platforms/index.json` or a target's `build.json`/dist is missing or empty; `build.json`
names another platform; its `commit_sha` ≠ `HEAD` (stale); `portal_configured` is false; the
dist no longer hashes to the recorded `dist_digest`; no `index.html` at the dist root; Yandex
entry-name or size rules fail; the zip exceeds the vendored profile's
`requirements.max_bundle_mb`; or `release/r<n>/manifest.json` exists and the new
`packages.json` would differ.

Zips are deterministic: entries in code-point order, one fixed timestamp, mode 0644, UNIX
"made by". `*.map` and `.gitkeep` are excluded; dist **contents** at the zip root. A
GameDistribution `hosting: self-hosted` package is the wrapper `index.html` only.

```
release/r<n>/
  <id>.zip
  packages.json     [{ platform_id, filename, size_mb, checksum, content_digest, files,
                       dist_digest, build: { dir, profile, role, engine, game_version,
                       commit_sha, portal_configured } }]
  checksums.txt     "<hex>  <id>.zip" per line
  manifest.json     release-manifest (Factory schema) — release:manifest
  publications/<id>.json                                — publish:prepare
```

`release:manifest` refuses when `--version` ≠ `game.version`, `packages.json` is missing, the
commit is not a full 40-hex sha (no git and no `GITHUB_SHA`), a package was built from another
commit, or an existing `manifest.json` differs in anything but its timestamps. It writes
`template: { repository: "Cuvara/web-game-template", version: <wgf.template.version>, source }`,
`target_platforms[].profile_version` from the pins, and `status: final` + `frozen_at` with
`--state rc` or `--freeze`. The contract number stays in `package.json` (the manifest schema
has no field for it).

## 9. What the Factory writes, and never touches

Writes: `game.config.yaml` and `config/platforms/` (init); `docs/development/brief.{md,json}`
(develop); `src/platform/integration-plan.ts` (sdk). Reads: `docs/development/report.json`,
`build/**`, `release/**`, the script outputs above.

Never: edits `src/main.ts`, `src/core/`, `src/platform/*` other than `integration-plan.ts`,
`src/game/{context,integration}.ts`, `packages/`, `scripts/`, test configs, or `package.json`
`scripts`. A change there is a template change, released as a new template version.

## 10. Golden ports

`examples/<example>/wgf-golden.port.json` (today `neon-drift-arena`, `tower-merge-rush`):
`{ example, engine, overlays: [dir…], copy: [{ from, to, replace?: [[before, after]…] }],
engine_dependencies: [name…] }`. Overlays are copied onto the repo root in order (README.md
skipped), then each `copy` entry with its replacements; `game.config.yaml` gets the port's
`engine.type` and `game.id: golden-<example>`; `engine_dependencies` are added at the
example's pinned versions. `pnpm golden:check` assembles each port in a temp copy and runs
install, typecheck, lint, test, sdk:check, build, build:platforms, test:e2e, test:sdk:browser
and test:verify. The Factory's golden-run replay reads the same file.
