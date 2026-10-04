# Changelog

Notable changes to the template. Games created from it inherit whatever was here at the ref
their tech plan pinned, so entries say what a title would gain by re-pinning.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/). `v1.0.0` is the first stable production baseline
intended for Web Game Factory to consume by tag; a game created from the template inherits
whatever was here at the ref its tech plan pinned.

## [Unreleased]

### Fixed — Yandex rewarded result, Y8 capped break

- **Yandex rewarded video resolved unshown.** One `callbacks` object served both ad kinds and
  took `shown` from `onClose(wasShown)`. Yandex documents `wasShown` for the fullscreen ad;
  the rewarded video's `onClose` is "Called when the video ad closes" and the real SDK calls
  it with no argument, so every completed rewarded ad resolved `{ shown: false, rewarded:
true, reason: "not-ready" }` and was never counted as shown. A rewarded ad is now shown
  when `onOpen` or `onRewarded` fired; the late reward, the cap, one ad at a time and never
  rejecting are unchanged. Test fakes now close a rewarded video with `onClose()`.
- **Y8 counted a capped break as an ad shown.** The adapter took `breakStatus: "viewed"` or
  `"dismissed"` as proof an ad appeared, and `"viewed"` as a reward, even when `beforeAd` never
  ran. Y8's docs give a frequency-capped break exactly that info, "`{ breakStatus: "viewed" }`",
  and say a capped break runs neither before-ad nor after-ad. Only `beforeAd` now proves an ad
  appeared; such a break resolves unshown, `not-ready`, and grants nothing.

### Added — GamePix

Additive — contract stays `2`; existing platforms and their builds are unchanged. A title
gains GamePix by targeting `gamepix@1.0.0`.

- **`createPlatform("gamepix")`** — `GamePixPlatform` (`@wgf/platform-sdk/adapters/gamepix`),
  written against GamePix's JavaScript SDK reference, submission guidelines and developer
  program as read on 2026-10-04 (<https://partners.gamepix.com/sdk/doc/javascript>,
  <https://partners.gamepix.com/guidelines/submission>,
  <https://partners.gamepix.com/developers>). A `gamepix` build carries the documented
  `https://integration.gamepix.com/sdk/v3/gamepix.sdk.js` as the first, synchronous script in
  `<head>` (the one Mandatory step); no other build does. `loading(0-100)` while loading and
  `loaded()` once at `signalReady()`, with no SDK call but `lang()` before it; interstitial
  (`interstitialAd()`, every break, no local interval) and rewarded (`rewardAd()`, reward only
  on `success: true`), one at a time so the SDK never sees `..._CALLED_TWICE`, the game held
  for the whole request and `ad:start`/`ad:end` only for an ad that played, a 60 s deadline,
  `ad:late-reward`; gameplay tracked locally (the JS SDK has no gameplay call); saves on
  `GamePix.localStorage` after `loaded()`, mirrored in local storage, with saves made while
  loading replayed into it; `language` from `GamePix.lang()`. No id to configure. A blocked
  script boots a plain web game.
- `config/platforms/gamepix.yaml` — a **proposed** profile in the Factory's platform-profile
  schema (`status: unverified`, every figure cited, `null` where undocumented); not in
  `pinned.json`. The Factory has none yet.
- `gamepix` in `KNOWN_PLATFORM_IDS` (registry and `game-config.ts`), `sdk-signatures.json`
  (`integration.gamepix.com`), `sdk:prepare` (`loaded: html-head`), the SDK browser smoke, the
  Poki audit's foreign-portal lists, and the live-portal matrix (UNVERIFIED: no live spec).
- Tests: `tests/gamepix/mock-sdk.ts` (Node and browser forms, recording every documented
  misuse error), `tests/unit/gamepix.test.ts`, GamePix in the conformance suite, the
  cross-portal contract, the SDK matrix, the template build smoke and `build:platforms`.
  Nothing contacts GamePix. See `docs/platforms/gamepix.md`.
- `PortalHarness.forwardsLoading` (tests/sdk/portals.ts): an SDK that takes loading-finished
  but no gameplay call.

### Scaling foundation

Three example games already solve this three incompatible ways, and all three re-derive the
same primitives: guard the zero-sized container, divide to get a scale, centre the remainder,
convert a pointer coordinate back. `layoutViewport` from `@wgf/game-core` is a pure function
from a design size and a viewport to one scale, one world rectangle and the offsets that
centre it. Additive — contract stays `2`, no new dependency, no lifecycle of its own
(`main.ts` already owns resize), and the shipped bundle is byte-identical because the export
is unused and tree-shaken.

#### Added

- **`layoutViewport(options, size, insets?)`** — pure, so a game's geometry at every screen
  shape it claims to support is unit-testable without a browser.
- **`fit: "extend"` is the default**, not letterboxing. Poki asks a game to "scale to cover
  the full canvas", and Yandex 5.9 counts black bars against a submission while 1.6.2.1
  requires the canvas to fill the frame — so `extend` keeps the authored scale, never crops
  the design rectangle, and grows the world on the axis with room to spare, bounded by
  `minAspect` / `maxAspect`. `fit: "contain"` is there for a playfield that genuinely cannot
  change shape.
- **`toWorld` / `toCss` / `containsWorld`** — `toWorld` converts exactly what `Input.pointer`
  reports, so the input and scaling foundations meet without either knowing about the other.
  A press in a margin converts to a point outside the world rather than being clamped to an
  edge the player never touched.
- **`readSafeAreaInsets(host)` and `layout.safeArea`** — `env(safe-area-inset-*)` can only be
  used in a declaration, never read from script, so a canvas-drawn HUD has no way to see a
  notch. This puts the values on a hidden probe's padding and reads them back, removing the
  probe in a `finally` so a read that throws cannot leave a growing pile of hidden divs.
  `safeArea` reports the uncovered region in world units.
- Guards: a zero-sized container (`display: none`, or read before layout) yields a scale of 1
  rather than a division by zero; a design size that is not positive throws when it is passed.

### Input foundation

Every game rewrote the same layer — a held-key set, keydown/keyup on the window, pointer
events on the canvas, a dispose list — and each one re-learned the two details that are only
obvious after a portal rejection. `Input` from `@wgf/game-core` is engine-agnostic: no PixiJS,
no Three.js, no Phaser. What an action _means_ stays game-owned; this reports which are held.
Additive — contract stays `2`, no new dependency, no existing behaviour changes.

#### Added

- **`Input`** — named actions bound to `KeyboardEvent.code` values and/or the pointer.
  `held()`, `axis(negative, positive)`, `consumePressed()`, `onPressed` / `onReleased`,
  `clear()` and an idempotent `dispose()`.
- **Physical keys, not characters.** Yandex 1.6.2.4 requires controls that survive a layout
  change; `KeyA` is under A on QWERTY and under Q on AZERTY, which is what a WASD game means.
- **`consumePressed(action)`** drains a one-shot press from the fixed `update()`, so a jump is
  applied where the loop can reproduce it. `onPressed` fires from the browser event, between
  frames — correct for menus, wrong for the simulation.
- **Pause awareness** — pass `paused: () => game.paused` and gameplay actions stop firing
  while an ad, a hidden tab or the pause menu holds the game. Input leaking through an ad
  break is a listed rejection cause on more than one portal. The physical key stays tracked
  underneath, so a control held across a break needs no fresh press; `whilePaused: true`
  exempts the control that ends the pause.
- **Page-scroll defaults cancelled** for space, the arrows and page up/down when an action
  binds them (Yandex 1.10.2, Poki's HTML5 guide), overridable per binding.
- **Pointer and touch through one path** — `{ down, x, y, fractionX, fractionY }` in the
  surface's CSS pixels. Touch arrives as pointer events; there is no separate touch code.
- **`bindElement(action, element)`** — an on-screen button as an extra press source, which is
  how a keyboard game is played on a phone. Returns its own unsubscribe.
- **Held keys dropped on blur.** A key held while focus leaves never gets its keyup, and the
  player used to come back to a stuck control.

### Phaser as a second 2D engine

Released as [1.2.0] below, and merged back into main. Unchanged since: the engine-matrix
suites (`ALL_ENGINES` in `scripts/_shared.mjs`, the SDK browser matrix) still cover `pixijs`
and `threejs`, and the Factory does not yet offer `phaserjs` in a tech plan.

### Three.js game foundation (`wgf.template.version` 1.2.0)

A 3D title had to write its own asset loading, animation wiring, disposal, lights and camera
before it could write any gameplay: `@wgf/three-framework` was the renderer and nothing else.
It now ships that infrastructure. Additive — contract stays `2`, no game code changes, and 2D
is untouched. Documented in [docs/threejs.md](docs/threejs.md).

#### Added

- **`ThreeAssets`** — one cache for `.glb`/`.gltf` and textures, load progress in `[0,1]` for
  `context.reportLoadingProgress`, `instantiate()` that clones skinned models correctly
  (`SkeletonUtils`), and a `dispose()` that frees what was loaded. Draco, KTX2 and meshopt are
  configured by path and imported dynamically; no decoder ships with the template.
- **`AnimationController`** — `AnimationMixer` driven by the loop's fixed `update(stepMs)`,
  with crossfade, one-shot clips and a `finished` callback.
- **`disposeObject3D(root, { keep })`** — frees geometry, materials, material textures and
  skeletons once each, so a restart does not leak the level onto the GPU.
- **`addDefaultLights(scene, options)`** — key plus hemisphere fill, optional shadow camera.
- **Camera rigs** — `FollowCamera` (third person, frame-rate-independent damping),
  `FirstPersonRig` (pointer lock; the game supplies the movement intent, not the rig),
  `OrbitRig` (damped, no pan, distance-limited).
- **`asThreeRenderer(context.renderer)`** — the narrowing every 3D game wrote by hand, with an
  error that names `engine.type` in `game.config.yaml`.
- **Renderer settings** — `setMaxPixelRatio`, `setShadows`, `setBackground`, `configureCamera`,
  and `webgl` / `contextLost` accessors.
- `docs/threejs.md`, including the Rapier recipe for a tech plan with
  `architecture.physics: rapier` (a **game** dependency; the template ships no physics).

#### Fixed

- The Three.js renderer re-applies its pixel-ratio cap on every resize. Moving the window to a
  screen with a different device pixel ratio previously kept the drawing buffer at the ratio
  the page loaded with.
- `ThreeRenderer.destroy()` disposes the scene graph, not just the `WebGLRenderer`, and forces
  the context loss. Geometries, materials and textures used to survive a teardown.
- A lost WebGL context (backgrounded mobile tab, GPU reset) is now recoverable: the renderer
  prevents the default, pauses drawing, and resumes on `webglcontextrestored`. It previously
  left the canvas black for the rest of the session.

### 2D asset loading

A 2D title had to write its own loading and progress arithmetic before it could draw anything,
and a game that got the arithmetic wrong failed at portal submission rather than in CI.
Additive — contract stays `2`, no game code changes, and 3D is untouched.

#### Added

- **`AssetManifest`** — what the game ships, declared as data in `src/assets/manifest.ts`
  (game-owned) and grouped into bundles by when each is needed, so a build's payload is
  reviewable without reading loader code.
- **`AssetLoader`** from `@wgf/pixi-framework` — loads the named bundles through Pixi's own
  `Assets` cache and reports combined progress in `[0,1]`, weighted by bundle size, never
  decreasing, always ending at exactly 1. Hand `onProgress` straight to
  `context.reportLoadingProgress`; profiles with `loading_api` reject a game that reports none
  and `pnpm facts` counts the calls as `calls_loading_api`.
- Manifest rules are checked when the loader is constructed: a duplicate alias, a repeated
  bundle name or a missing `src` is a startup error naming the file, not a texture that
  silently never appears.
- `get()` / `texture()` throw and say which bundle to load rather than returning `undefined`,
  and `texture()` refuses an alias the manifest declares as something other than an image. A
  failed bundle names the bundle, its aliases and the backend's original message.
- No new dependency: loading goes through the `pixi.js` the binding already carried.

### 2.0.0-contract — Factory ↔ template contract 2

The Factory ↔ template API is now written down and versioned:
[docs/factory-contract.md](docs/factory-contract.md), contract number in `package.json`
`wgf.template.contract` (`2`), template version in `wgf.template.version`. `package.json`
`version` is unchanged until the release is cut. A title gains all of this by re-pinning; a
game written against contract 1 needs its game code moved into `createGame` (below).

#### Changed — breaking for games

- **One entry point.** A game implements `createGame(context: GameContext): Promise<GameHandle>`
  in `src/game/index.ts`. `src/main.ts` is template-owned and boots through `bootPlatform`,
  installs `PlatformGameplay` with `INTEGRATION_PLAN`, and hands the game a wired
  `GameContext`; games no longer build `BootScene` in `main.ts`.
- **The Factory no longer patches the template.** `src/platform/gameplay.ts`,
  `game-integration.ts`, `src/game/{context,integration}.ts` ship with the template; the
  Factory `sdk` step regenerates `src/platform/integration-plan.ts` only. `pnpm sdk:check`
  fails (exit 1, JSON report) when the boot wiring is gone.
- **One build per platform.** `pnpm build:platforms` writes `build/platforms/<id>/dist/`,
  `build.json` and `index.json` (with the Factory-compatible `dist_digest`). Each bundle
  carries only its target's adapter and only its engine. `pnpm build` builds one target:
  `WGF_TARGET_PLATFORM`, else the first required entry.
- **Portal ids fail the build.** A y8 build without `app_id`, or a gamemonetize /
  gamedistribution build without `game_id`, fails. `platforms[].app_id` / `game_id` may live
  in `game.config.yaml` or come from `WGF_Y8_APP_ID`, `WGF_Y8_GAME_ID`,
  `WGF_GAMEMONETIZE_GAME_ID`. `WGF_ALLOW_UNCONFIGURED_PORTAL=1` is the test-only escape
  hatch (`portal_configured: false`, never releasable).
- **Release packages each platform's own build.** `release:package` refuses a build that is
  missing, stale against `HEAD`, unconfigured or edited since it was built; zips are
  deterministic; `packages.json` records `content_digest` and `dist_digest`.
  `release:manifest` never overwrites a manifest with different content and records
  `template`.

#### Added

- `package.platform_sdk` is measured from the shipped files
  (`packages/platform-sdk/sdk-signatures.json`); runtime facts per platform
  (`build/runtime-facts/<id>.json`).
- `window.__wgf__` probe gains `target`, `steps()`, `scene()`, `paused()`, `moments()`;
  `#hud[data-scene|data-steps|data-engine|data-platform]` are published by `main.ts` for any
  game. Inherited game-agnostic e2e specs carry `@aspect` tags.
- `pnpm golden:check` assembles the Factory's golden ports (`examples/*/wgf-golden.port.json`)
  and runs the inherited suites on them.
- `AGENTS.md` and `CLAUDE.md`: the developer contract for coding agents in a game repository.

#### Fixed — docs

- `docs/development.md` no longer tells games to edit `packages/`; the platform docs, release
  and production-build docs describe per-platform builds and packaging; the adapter table
  lists all eight platforms; Y8, GameDistribution and GameMonetize have Factory core profiles
  at `1.0.0` (marked unverified there).

## [1.2.0] — 2026-09-28

Phaser as a second 2D engine. `engine.type` accepts `phaserjs` alongside `pixijs` and
`threejs`; a title gains it by naming it in its tech plan. Nothing about an existing PixiJS or
Three.js game changes — both build, boot and smoke exactly as before — and no game is obliged
to move.

### Added

- **`@wgf/phaser-framework`** (`packages/phaser-framework/`, Phaser 3.90.0): `PhaserRenderer`
  behind the existing `Renderer` seam. Phaser's own TimeStep is stopped the moment it boots
  and the renderer steps Phaser once per drawn frame, so `@wgf/game-core` remains the only
  loop: one `requestAnimationFrame`, one clock, and `Game.pause()` still stops everything
  during an ad break. `destroy()` steps Phaser once after `game.destroy(true)` because Phaser
  defers its teardown to the next step, which a stopped TimeStep would never deliver.
  Gameplay that must be frame-rate independent belongs in game-core's fixed `update(stepMs)`;
  Phaser scene `update(time, delta)` is for presentation.
- `src/rendering/phaserjs/`, the game's own Phaser rendering code, alongside the existing
  `pixijs/` and `threejs/` directories.
- **`pnpm build:engine <engine.type>`** (`scripts/verify/engine-build.mjs`): builds against
  the committed config with only `engine.type` changed, so an engine the config does not name
  is still built and smoke-tested. `verify.yml` runs it for every other engine.
- `tests/e2e/lifecycle.spec.ts`: the built game stops stepping and drawing while the tab is
  hidden and resumes with it — the ad-break requirement every profile states, and the check
  that an engine shipping its own loop has not kept it running.

### Changed

- `import.meta.env.WGF_ENGINE` is defined from `game.config.yaml` at build time
  (`scripts/build/game-config-plugin.ts`), and `createRenderer` compares against it directly.
  Rollup drops the engines a build does not use: a PixiJS build no longer carries the
  Three.js chunk, and carries no Phaser. `createRenderer(engine)` still selects at run time in
  a bundle built without the plugin (the SDK matrix harness), and refuses an engine the build
  was not made for.
- `Renderer.kind` accepts `"phaserjs"`.

## [1.1.0] — 2026-09-24

Three new portal adapters: Y8, GameDistribution and GameMonetize (PRs #9, #17, #18). All eight
platform ids (generic-web, Yandex, Poki, CrazyGames, GameVui, Y8, GameDistribution,
GameMonetize) share one `createPlatform` contract, pass the SDK conformance suite, and run in
the real-browser suites (SDK smoke builds and the SDK matrix) on both PixiJS and Three.js.
Existing platforms are unchanged. Live portal-backed ads, rewards and activation remain
BLOCKED_EXTERNAL / UNVERIFIED_EXTERNAL; see "External portal limitations" below. No breaking
changes: every new configuration field is optional or applies only to its own platform.

### Added — Y8

- **Y8 adapter** (`createPlatform("y8")`, `packages/platform-sdk/src/adapters/y8/`), written
  from <https://docs.y8.com/> as read on 2026-09-24. Loads the CDN script with the documented
  `y8sdk.ready` / `emitReadyEvent()` race handling; interstitial (`next`) and rewarded
  (`reward`) ads that pause and mute only once an ad actually starts, reward only on
  `adViewed`, and never resolve or reward twice; Cloud Storage for signed-in players, local
  saves for guests, `storage:changed` on sign-in/out. App ID / Game ID come from
  `WGF_Y8_APP_ID` / `WGF_Y8_GAME_ID` at build time (`virtual:platform-config`), never from a
  committed file; missing settings run the game without the SDK. A title gains it by
  targeting `y8@1.0.0`; `config/platforms/y8.yaml` is a proposed profile (the Factory has
  none yet). Live: the real script's load and surface PASS; ads, rewards, auth and storage
  are BLOCKED pending a real App ID / Game ID. See `docs/platforms/y8.md`.
- `tests/y8/mock-y8-sdk.js`, one deterministic Y8 mock shared by the unit, conformance,
  matrix and real-bundle browser suites.

### Added — GameDistribution

- **`createPlatform("gamedistribution")`** — `GameDistributionPlatform`, written against the
  GD HTML5 SDK 1.43.58 docs: the documented snippet loaded once at runtime, `SDK_READY` /
  `SDK_ERROR` (late and doubled events honoured), `showAd` interstitial and rewarded, reward
  only on `SDK_REWARDED_WATCH_COMPLETE` (never twice; `ad:late-reward` after a deadline),
  `SDK_GAME_PAUSE`/`SDK_GAME_START` as the foreground, rewarded availability from
  `preloadAd`, and start/hand-back deadlines so a lost event cannot leave the game paused.
- **`platforms[].game_id`** (required for gamedistribution, validated at build time; the SDK's
  placeholder is refused) and **`hosting: self-hosted` + `game_url`**: the GD submission is
  then the official wrapper page (`scripts/release/gamedistribution-wrapper.mjs`) that frames
  the game with `gd_sdk_referrer_url`, computed at run time. `CreatePlatformOptions` gains
  `gamedistribution`.
- A draft template-side profile `config/platforms/gamedistribution.yaml`, a deterministic
  fake and browser mock SDK, GD in conformance, the game-side contract, the SDK matrix, the
  template build smoke and the live SDK-load probe. `docs/platforms/gamedistribution.md`.
- Scripts' `readGameConfig` honours `WGF_GAME_CONFIG`, as the Vite build already did.

### Added — GameMonetize

- **`GameMonetizePlatform`** (`createPlatform("gamemonetize")`), written against GameMonetize's
  HTML5 SDK documentation (audited 2026-09-24): `window.SDK_OPTIONS { gameId, onEvent }`, the
  `api.gamemonetize.com/sdk.js` script loaded at runtime, `SDK_READY` / `SDK_ERROR` /
  `SDK_GAME_PAUSE` / `SDK_GAME_START`, and `sdk.showBanner()` as the interstitial. Rewarded ads
  are not documented and resolve `unsupported`. Every request resolves once; lost, late and
  duplicate SDK callbacks are bounded by deadlines, and the game is never left paused or muted.
- **Game ID configuration**: optional `game_id` on the gamemonetize platform entry, or
  `WGF_GAMEMONETIZE_GAME_ID` at build time; validated at build time. Without one the SDK is
  never requested. `CreatePlatformOptions.portalGameId` carries it; other adapters ignore it.
- `pnpm sdk:prepare` knows the GameMonetize SDK source and fails a missing Game ID or declared
  rewarded ads.
- Tests: `tests/unit/gamemonetize.test.ts`, a deterministic mock (`tests/gamemonetize/`),
  GameMonetize in the conformance suite, the cross-portal contract, the SDK matrix (PixiJS and
  Three.js, plus `gamemonetize.html` through the real script loader), the template-build smoke,
  and an opt-in live SDK-load probe (PASS; ads, Verify Game and activation BLOCKED).
- `docs/platforms/gamemonetize.md`.

### Fixed — GameMonetize audit against the live SDK (2026-09-24)

- The ad-start deadline is 25 s, past the SDK's own 12 s + 8 s cancel; at 10 s a slow but
  real ad was treated as late.
- The script loader refuses at once, and leaves the other `SDK_OPTIONS` alone, when other code
  has already loaded the SDK (one instance that reads its options once); it used to overwrite
  them and wait out the 5 s init deadline for events that could not arrive.
- `pnpm sdk:prepare` fails a GameMonetize title that declares no interstitial:
  `sdk.showBanner()` calls are mandatory.
- The mock reports ad failures the way the live SDK does (`SDK_GAME_START`, no `SDK_ERROR`)
  and models its cooldown on premature calls; `SDK_ERROR` during an ad stays covered as a
  defensive case.

### Changed

- Conformance and contract harnesses state whether a portal's SDK takes gameplay/loading
  reports (`forwardsGameplay`, `forwardsLifecycle` — one name each for the Y8,
  GameDistribution and GameMonetize work) instead of assuming every SDK does.

### External portal limitations (honest status, not implementation failures)

Mocks and local browser tests are not counted as live. Evidence: `docs/audits/live/`.

- **Y8** — live SDK script load PASS (`cdn.y8.com` 2-0, `y8` global present). SDK init with a
  real App ID, ads/rewards and sign-in/Cloud Storage: BLOCKED_EXTERNAL (need a Y8 App ID /
  Game ID; #6, #7, #8).
- **GameDistribution** — live SDK script load PASS and `SDK_READY` received by the template
  build on 127.0.0.1. Live ads/rewards/pause-resume: BLOCKED_EXTERNAL (#10); pre-roll
  activation (#11) and self-hosted wrapper acceptance (#12): UNVERIFIED_EXTERNAL; Factory
  profile (#13) pending.
- **GameMonetize** — live SDK script load PASS (`SDK_READY` with a placeholder Game ID).
  `showBanner()` never called live; ads, Verify Game and activation: BLOCKED_EXTERNAL (need a
  GameMonetize account and Game ID; #14, #15); Factory profile (#16) pending.
- **Yandex / CrazyGames / Poki / GameVui** — unchanged from 1.0.0: Yandex live
  BLOCKED_EXTERNAL (portal-served SDK); CrazyGames and Poki live ads/rewards BLOCKED_EXTERNAL
  (SDK load PASS); GameVui submission UNVERIFIED_EXTERNAL (no public SDK).

## [1.0.0] — 2026-09-23

First stable production baseline for Web Game Factory. Both renderers, the SDK contract and
conformance, the browser matrix, build and release packaging, and the WGF integration contract
are verified. Live portal-backed behaviour is honestly BLOCKED/UNVERIFIED pending portal access
(see "External portal limitations" below and `docs/audits/LIVE-PORTAL-VALIDATION-2026-09-23.md`).

### Added — production hardening (this cycle)

- **CrazyGames late reward** — a rewarded ad that starts after the client watchdog and plays to
  completion now emits `ad:late-reward` exactly once (guarded against duplicate callbacks); the
  reward is observable via `rewarded:true` or one late event, never both.
- **Poki break timeouts** — `rewardedBreak`/`commercialBreak` are raced against a 60s deadline
  that resolves a failure result, so a stuck SDK can no longer leave the game paused and muted;
  a late genuine callback cannot double-resolve. Poki exposes no late-reward channel, so a
  post-deadline reward is forfeited by design.
- **Foreground-recovery watchdog** — `foreground:lost` is cleared not only by
  `foreground:gained` but by a bounded watchdog that resumes only when the portal genuinely
  reports the foreground back, never while an ad holds the screen. Both the mid-session and the
  launch-ad boot paths funnel through it, so a dropped `foreground:gained` cannot deadlock.
- **Normalized `AdResult.reason`** — `not-ready` (SDK unavailable), `busy` (concurrent),
  `unsupported` (no ad kind), `disabled` (portal off); asserted in conformance so divergence
  fails CI.
- **`examples/tower-merge-rush/`** — a real PixiJS game (merge, score, progression, game over,
  restart, rewarded continue) on the platform abstraction only; 15 unit + 14 Chromium e2e.
- **`examples/neon-drift-arena/`** — the first real Three.js game (seeded-deterministic dodger,
  collision, restart, rewarded revive) on `@wgf/three-framework`; 13 unit + 14 Chromium e2e.
- **CI gating** — `ci.yml` runs the SDK conformance project; `verify.yml` runs the SDK browser
  matrix.
- **Production sourcemap policy** — `sourcemap: "hidden"` and the release zip excludes `*.map`,
  so a submission ships no sourcemaps (release zip ~0.27 MB) or source; JS output unchanged.
- **`tests/live/` + `pnpm test:sdk:live`** — an opt-in real-SDK portal validation harness that
  BLOCKS without `WGF_LIVE=1` and never falls back to mocks, plus a manual tester page and the
  `workflow_dispatch` `live-portal-validation.yml` (BLOCKED without the opt-in secret; never
  publishes). Sanitized evidence under `docs/audits/live/`.
- **Docs** — `docs/wgf-integration.md`, `docs/production-build.md`, and the audits under
  `docs/audits/` (production-readiness and live-portal validation).

### External portal limitations (honest status, not implementation failures)

- **Yandex live** — BLOCKED. The SDK is portal-served (`/sdk.js`); real init/ads/rewarded/
  pause/storage require a Yandex Games draft/portal environment.
- **CrazyGames live ads/reward** — BLOCKED. The SDK script loads off-portal (SDK-load PASS), but
  real ad fill/reward require the Developer Portal QA tool.
- **Poki live ads/reward** — BLOCKED; the 60s-timeout condition is UNVERIFIED. Real breaks
  require the Poki Inspector/portal environment.
- **GameVui portal** — UNVERIFIED. No public GameVui JS SDK exists (NOT_APPLICABLE at the SDK
  layer); submission is a manual/email process. A GameVui build uses the `generic-web` adapter.

### Changed — one platform contract, four portals

- **The CrazyGames contract additions are now required, not optional.** Every adapter —
  Yandex, Poki, CrazyGames, GameVui, generic-web — implements `settings`, `environment`,
  `adAvailability()`, `getUser()` and `capabilities.gameplayStopOnHidden`, so game code no
  longer branches on their absence. A title implementing `Platform` itself must add them;
  titles that only call it need not change.
- **`createPlatform("gamevui")` returns `GameVuiPlatform`** instead of throwing: a no-SDK
  adapter (local saves, no requestable ads), because GameVui publishes no SDK.
- **`bindPlatform` reports a mute state** (`onAudioMutedChange`, `audioMuted`): the portal's
  mute setting, a playing ad, the portal holding the screen, and window blur (Yandex 1.3).
- Adapter fixes from an audit against each portal's current docs — see `docs/sdk.md`.

### Added — SDK verification

- **`tests/sdk-matrix/`** — PixiJS and Three.js games × all four portal adapters (mocked SDKs
  from `tests/sdk/portals.ts`) in Chromium, desktop and mobile; `pnpm test:sdk:matrix`.
- **`tests/unit/sdk-contract.test.ts`**, **`sdk-audit-fixes.test.ts`** — the same scenarios
  from the game's side (`withAdBreak`, portal mute, `adAvailability`), and one regression
  test per audit finding.
- **`scripts/sdk/prepare-integration.mjs`** (`pnpm sdk:prepare`) — writes
  `build/sdk/integration.json` and a Factory `sdk-report.json`. Prepares, never publishes.
- **`docs/sdk.md`** — architecture, the audit, known limitations, and Factory profile values
  the portals' docs contradict.

### Added — SDK conformance

- **`tests/sdk/`** — one scenario matrix over every known platform (SDK unavailable, init
  failure, ad unavailable, ad closed early, reward callback, pause/resume, storage, platform
  not configured, and a real `Game` bound to each adapter), against fake portal SDKs.
  `pnpm test` now includes it; `pnpm sdk:conformance` writes `build/sdk-conformance.json`
  for the Factory's `sdk` step. A missing adapter is reported as skipped, never as passing.
- **`tests/sdk-browser/`** and `pnpm test:sdk:browser` — the template game built for PixiJS
  and Three.js × generic-web, Yandex and Poki, booted in Chromium (desktop and mobile) with
  mocked or blocked portal scripts.
- **`WGF_GAME_CONFIG`** — build against another config file without editing
  `game.config.yaml`. Unset, the build is unchanged.
- **`docs/platforms/sdk-conformance.md`** — the matrix, current results and known
  limitations, checked against each portal's current documentation.

### Fixed — portal pause

- `bindPlatform` now pauses the game on `foreground:lost` and resumes it on
  `foreground:gained`. On Yandex the template game previously kept running through
  `game_api_pause`, including the launch ad (requirements 1.19.4, 4.7).

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
  Data-module storage, `muteAudio`, system-info locale/device, user. Degrades to a plain web
  game when the SDK is disabled (non-CrazyGames domain) or blocked.
- **Platform contract additions**: the `settings:change` event, `settings`, `environment`,
  `adAvailability()`, `getUser()`, and `capabilities.gameplayStopOnHidden`. Ad skip reasons
  gain `disabled` and `adblock`. (Merged into the unified contract: events arrive through
  `on()`, not a separate `events` object.)
- **`examples/crazygames-compliance-demo/`** — a PixiJS game that exercises the integration
  end to end, and `tests/crazygames/` driving it on desktop, mobile and tablet.
- **`scripts/crazygames-audit.mjs`** with limits tied to their official source in
  `config/platforms/crazygames-limits.json`; **`crazygames.yml`** runs all of it.
- **`docs/platforms/crazygames/requirements.md`** and
  **`compliance/crazygames-compliance-report.md`**.

### Fixed

- **Builds used absolute asset paths.** `vite.config.ts` now sets `base: "./"`; CrazyGames
  states absolute paths fail to load, and other portals serve from sub-paths too.
- **Focus loss was always reported as a gameplay stop.** CrazyGames asks games not to;
  `bindPlatform` now follows `capabilities.gameplayStopOnHidden`.

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
