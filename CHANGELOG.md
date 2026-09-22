# Changelog

Notable changes to the template. Games created from it inherit whatever was here at the ref
their tech plan pinned, so entries say what a title would gain by re-pinning.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this repository does
not publish versioned releases of its own, so changes are grouped by date.

## [Unreleased]

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
