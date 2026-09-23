# Changelog

Notable changes to the template. Games created from it inherit whatever was here at the ref
their tech plan pinned, so entries say what a title would gain by re-pinning.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this repository does
not publish versioned releases of its own, so changes are grouped by date.

## [Unreleased]

### Added — GameVui

- **`docs/platforms/gamevui/`** — a source matrix classifying every GameVui claim as
  `OFFICIAL`, `THIRD_PARTY`, `INFERRED` or `UNKNOWN`, and a platform contract. GameVui
  publishes no SDK, JavaScript API or publishing API; the documented route is an email to the
  operator or its contact form. So there is still no GameVui adapter, and
  `createPlatform("gamevui")` still throws.
- **`examples/gamevui-compliance-demo/`** — a PixiJS game on the generic-web adapter, with a
  requirement registry, static audit, Playwright suite (desktop, phone portrait and
  landscape, tablet, iframe under a GameVui-style path), a deterministic submission package
  under `release/gamevui/`, and a report generator that never reports an `UNKNOWN`
  requirement as passing. `examples/*` joins the pnpm workspace.
- **`gamevui-demo.yml`** — builds, tests and packages the demo; uploads the package as an
  artifact. Submits nothing.
- **`compliance/gamevui-compliance-report.md`**.

### Changed — GameVui claims

- The README, `docs/architecture.md`, `docs/publishing.md`, `vite.config.ts`,
  `create-renderer.ts` and `build.yml` stated the Factory profile's 50 MB as GameVui's cap.
  GameVui publishes no size limit; they now say it is the profile's unverified figure.

### Added — Yandex Games

- **Yandex adapter** (`createPlatform("yandex")`), written against the current official
  docs. It covers:
  - loading `/sdk.js`;
  - `LoadingAPI.ready()` and `GameplayAPI` transitions;
  - `game_api_pause`/`resume`, including the ad the portal shows at launch;
  - interstitial and rewarded ads, which keep listening past their open-timeout;
  - saves through `player.setData`, with a local mirror and revision reconciliation;
  - the account-selection dialog.

  A missing SDK degrades the game rather than failing boot.

- **`Platform` gains `language`, `foreground` and `on()`**, plus two events, `ad:late-reward`
  and `storage:changed`. A title that implements `Platform` itself must add them. Titles
  that only call it need not change.
- **`src/main.ts` follows the portal's language** when the platform reports one.
- **`examples/yandex-compliance-demo`**: a small PixiJS game that exercises every lifecycle
  moment Yandex moderation checks. It comes with:
  - unit tests;
  - Playwright e2e on desktop, phone and tablet;
  - `scripts/verify/yandex-audit.mjs`, a static audit of the build;
  - `scripts/release/yandex-archive.mjs`, which packages the upload ZIP;
  - the workflow `yandex-demo.yml`.

  Its assessment is `compliance/yandex-compliance-report.md`: READY_WITH_MANUAL_CHECKS, not
  submitted, not Yandex-approved.

- The Vite game-config plugin moved to `scripts/build/game-config-plugin.ts` so examples
  can share it.
- `PixiRenderer` caps resolution at 2×, matching the Three.js renderer.

### Added — Poki

- **`PokiPlatform`**, a portal adapter written against Poki's current HTML5 SDK
  documentation. It loads Poki's documented loader at runtime, and boots without it when an
  ad blocker stops the script or `init()` never settles.
- **`GameplayLifecycle`**, Poki's sequencing rules in one pure class: `gameLoadingFinished`
  once and first, no consecutive `gameplayStart`/`gameplayStop`, nothing during an ad, and a
  `gameplayStop` before any break that interrupts gameplay.
- **`examples/poki-compliance-demo/`** — a PixiJS game exercising every documented path
  (startup, pause/resume, death/restart, rewarded revive) through `Platform` only.
- **`scripts/verify/poki-audit.mjs`** — static audit of a Poki build: external URLs, assets,
  fonts, links, third-party ads and analytics, other portals' names, debug leftovers, storage
  used outside the platform backend. Runs in `verify.yml`.
- **`tests/poki/`** — end-to-end on desktop, mobile and tablet against a mock SDK that
  referees the sequencing, including ad-blocked, no-fill, failing-ad, private-browsing and
  strict-CSP runs.
- **`compliance/poki-compliance-report.md`** — the requirements matrix and the evidence.

### Changed

- **`Platform.gameplayActive`**, **`AdHooks.onStart`** on both ad calls, the `busy` skip
  reason, and the optional `PlatformStorage.persistent`.
- **The template's boot no longer reports `gameplayStart` at load.** It waits for the first
  pointer, touch or key input, as Poki requires; a hidden tab restarts gameplay on return only
  if it had stopped it.
- **Both adapters implement the merged `Platform` contract.** `YandexPlatform` reports
  `gameplayActive` and calls `AdHooks.onStart` from the portal's `onOpen`; `PokiPlatform`
  reports `foreground`, emits `ad:start`/`ad:end` and `foreground:lost`/`foreground:gained`
  around an ad that actually plays, and leaves `language` null because Poki documents no
  language call.
- **`LocalStorageBackend` guards every operation**, not just the probe: storage that fails
  mid-session, or a `localStorage` getter that throws inside an iframe, moves it onto memory
  instead of throwing into the game.

### Added — CrazyGames

- **CrazyGames adapter** (`@wgf/platform-sdk`, HTML5 SDK v3). `createPlatform("crazygames")`
  no longer throws. Gameplay start/stop, loading start/stop, midgame and rewarded ads,
  Data-module storage, `muteAudio`, `language` and device from system info, user. Degrades to a plain web
  game when the SDK is disabled (non-CrazyGames domain) or blocked.
- **Platform contract additions**, all optional so the Yandex and Poki adapters need no
  change: `settings` with a `settings:change` event, `environment` (device, portal app),
  `adAvailability()`, `getUser()`, and `capabilities.gameplayStopOnHidden` (absent = true).
  Ad skip reasons gain `disabled` and `adblock`. Events use the `on()` from the Yandex change.
- **`examples/crazygames-compliance-demo/`** — a PixiJS game that exercises the integration
  end to end, and `tests/crazygames/` driving it on desktop, mobile and tablet.
- **`scripts/crazygames-audit.mjs`** with limits tied to their official source in
  `config/platforms/crazygames-limits.json`; **`crazygames.yml`** runs all of it.
- **`docs/platforms/crazygames/requirements.md`** and
  **`compliance/crazygames-compliance-report.md`**.

### Fixed

- **Builds used absolute asset paths.** The root `vite.config.ts` now sets `base: "./"`, as
  the Yandex demo already did; CrazyGames states absolute paths fail to load.
- **Focus loss was always reported as a gameplay stop.** CrazyGames asks games not to;
  `bindPlatform` now follows `capabilities.gameplayStopOnHidden`. It also exposes the
  required mute state (`onAudioMutedChange`) and holds the game for an ad that starts on
  live play.

### Added — pipelines

- **Seven GitHub Actions workflows**, replacing seven comment-only stubs. `ci.yml` and
  `verify.yml` are what `title.machine.yaml` names as implementing the `ci_green` and
  `verify_suite_green` guards, which until now did not exist.
- **Two build channels.** `develop` deploys to Cloudflare Pages; `release` freezes a candidate
  and never deploys. Same build in both.
- **`publish.yml` and `campaign.yml` as real gates**, held by GitHub environments with required
  reviewers. Both refuse to run when their environment has no reviewers.
- **`bootstrap.yml`**, which runs once in a repository created from the template: grants access
  to the organization's `WGF_*` secrets, copies the `WGF_*` variables down so they can be
  overridden, creates the three environments with a required reviewer, sets the game identity,
  then deletes itself. It authenticates as the organization's existing bot app — the one place
  a game pipeline reads a secret outside the `WGF_*` namespace, because a brand-new repository
  can read nothing scoped to selected repositories until bootstrap adds it to those lists.

### Added — measurement

- **Package-fact collection.** The twelve fact paths that the five platform profiles assert on,
  gathered from the built bundle, from a Playwright run driving it, and from the declaration in
  `game.config.yaml`. Every blocking assertion is measurable on a runner; three warnings use a
  documented proxy.
- **An assertion evaluator** implementing `criteria-expression` in full — all ten operators,
  the `all_of`/`any_of`/`not` composites, and `right_path`. Profiles are read from
  `config/platforms/` at the pinned version, never the current one.
- **A read-only probe** (`window.__wgf__`) so the verify suite measures the bundle that ships
  rather than a specially instrumented one, plus `Game.framesRendered` so frame rate is
  observable from CI.
- **Release packaging**: per-platform zips at the archive root Yandex expects, checksums, an
  immutable manifest, and one publication record per platform carrying its assertion results.

### Added — runtime

- **Minimal i18n.** Locales are JSON under `public/locales/`, copied into the build and fetched
  at boot. Without a locale mechanism no title from this template could satisfy the locale
  assertions that are blocking on Yandex, CrazyGames and GameVui.
- **`monetization.ad_kinds` in `game.config.yaml`**, the declaration those profiles'
  `uses_banner_ads` and `uses_rewarded_ads` assertions are evaluated against. Code requesting
  an ad kind the design never declared now fails the build.
- **Platform usage counters**, the cross-check behind that.

### Changed

- The untouched scaffold targets `generic-web` rather than three portals, so CI is green on it
  before any game code exists — which the scaffolding stage requires.
- Playwright split into `desktop`, `mobile` and `verify` projects.
- GitHub Actions bumped to majors that run on Node 24.

### Fixed

- **`.gitignore` swallowed `scripts/release/`.** `release/` unanchored matches a directory of
  that name at any depth, so the release tooling was never committed. Every local check passed;
  the first real release run failed with `MODULE_NOT_FOUND`. Both ignores are now anchored.
- **Publishing erased the record of which rules were checked.** `make-publication.mjs` read
  assertion results only from `build/assertions/`, which the publish job never has — so
  advancing a platform to `submitted` rewrote its publication with `assertion_results: []`.
  Results are now carried forward, and the earlier verdict is re-read rather than re-derived,
  because severity cannot be stored in a `criterionResult` and re-deriving would treat every
  breached warning as a blocking failure.
- **A named environment is not a gate.** GitHub creates an environment implicitly, with no
  protection, the first time a job names one — so `environment: production` held nothing back
  in a repository where nobody had configured it. Both gate workflows now check and refuse.
- `SceneManager.transitioning` never returned to `false`, because the slot was assigned the
  promise derived from `.finally()` rather than the one it compared against.
- `LocalStorageBackend` probed with optional chaining, so it reported "available" under Node
  where `localStorage` does not exist, then threw on first read.

### Known limitations

- `provenance.inputs[]` on a release manifest is empty. The tech plan and game design live in
  the Factory's workspace, so CI has nothing to hash; it pins `commit_sha` and every
  `profile_version` instead.
- `perf.lowend_android_fps` is a CPU-throttled desktop run, not a device measurement. The
  assertion is a warning for that reason.
- `bootstrap.yml` has not been exercised end to end — it only fires in a repository created
  _from_ the template, which needs the organization's bootstrap app to exist first.

## 2026-09-22 — foundation

### Added

- pnpm workspace with five packages, TypeScript strict plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`, Vite build, ESLint and Prettier.
- `@wgf/game-core`: fixed-timestep loop with a clamp on long frames, scene manager with
  serialised async transitions, typed event bus, and a `Game` whose pause counts reasons.
- `@wgf/platform-sdk`: the platform contract mirroring a profile field for field, `AdPolicy`
  enforcing each profile's ad rules locally, storage with an in-memory fallback, the
  `generic-web` adapter, and a registry that fails loudly on an id whose adapter is unwritten.
- `@wgf/analytics-sdk`, `@wgf/pixi-framework`, `@wgf/three-framework`.
- `game.config.yaml` parsed and validated at build time, injected as `virtual:game-config`.
  Platform entries must be pinned objects.
- Unit, integration and e2e suites.

## 2026-09-21 — scaffold

- Directory skeleton, six comment-only workflows, docs stubs, no dependencies.
