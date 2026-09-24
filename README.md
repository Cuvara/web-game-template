# Web Game Template

The template every game produced by the **Web Game Factory** is created from. It carries the
game loop, the platform abstraction, the build, the test layout and seven CI/CD pipelines, so
that a new title starts with all of them rather than an approximation of them.

```bash
pnpm install --frozen-lockfile
pnpm dev               # http://localhost:5173
pnpm test              # unit, integration, SDK conformance
pnpm build             # packages, then dist/ for the target platform
pnpm build:platforms   # one build per platform → build/platforms/<id>/dist/
```

Node 20+, pnpm 9. `corepack enable pnpm`, or `npm i -g pnpm@9` if you would rather not run an
elevated shell on Windows.

- [docs/factory-contract.md](docs/factory-contract.md) — **the Factory ↔ template API**
  (contract 2): config, scripts, outputs, digests, the game API, QA and release rules
- [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) — instructions for coding agents in a game
  repository
- [docs/architecture.md](docs/architecture.md) — how the pieces fit
- [docs/development.md](docs/development.md) — working in it day to day
- [docs/wgf-integration.md](docs/wgf-integration.md) — the Factory flow end to end
- [docs/sdk.md](docs/sdk.md) — the platform SDK and each adapter's audit
- [docs/production-build.md](docs/production-build.md) — per-platform builds and packages
- [docs/testing.md](docs/testing.md) — the three test layers
- [docs/ci-cd.md](docs/ci-cd.md) — the seven pipelines and the two gates
- [docs/release.md](docs/release.md) — freezing a candidate
- [docs/publishing.md](docs/publishing.md) — what is automated and what cannot be
- [examples/poki-compliance-demo](examples/poki-compliance-demo/README.md) — every Poki SDK
  path, audited and tested
- [compliance/poki-compliance-report.md](compliance/poki-compliance-report.md) — what is
  verified for Poki, and what is still manual
- [docs/platforms/crazygames/requirements.md](docs/platforms/crazygames/requirements.md) —
  CrazyGames requirements, and what answers each one
- [CHANGELOG.md](CHANGELOG.md)

## Where it sits

```
web-game-factory          methodology, schemas, platform profiles, portfolio data
       |
       |  gh repo create --template, at the ref the tech plan pins
       v
web-game-template         this repository
       |
       |  one repository per title
       v
<game>                    game source and release artifacts
```

The Factory holds no game source. This template holds no game. A game repository holds one.

## The split that runs through everything

| Location                                                                         | Owned by     | A game may          |
| -------------------------------------------------------------------------------- | ------------ | ------------------- |
| `packages/*`, `scripts/`, configs                                                | the template | use it, not edit it |
| `src/main.ts`, `src/core/`, `src/platform/`, `src/game/{context,integration}.ts` | the template | use it, not edit it |
| `game.config.yaml`, `config/platforms/`, `src/platform/integration-plan.ts`      | the Factory  | read it             |
| `src/game/index.ts` — `createGame(context)` — and the rest of `src/`             | the game     | fill it in          |

Reimplementing in `src/` something `packages/` already provides is the most common scaffolding
mistake, and this split is what makes it visible in review. The exact list is in
[docs/factory-contract.md](docs/factory-contract.md#1-ownership).

```
packages/
  game-core         fixed-timestep loop, scenes, events, pause, the Renderer interface
  platform-sdk      the platform abstraction, ad policy, storage, portal adapters
  analytics-sdk     one batched event vocabulary
  pixi-framework    Renderer for engine.type: pixijs
  three-framework   Renderer for engine.type: threejs

src/
  main.ts           the boot sequence (template-owned); calls createGame(context)
  core/             config, i18n, the verify probe
  game/             index.ts createGame — the game's one entry; boot-scene.ts is the scaffold
  platform/         bootPlatform, PlatformGameplay, the integration plan, pause/mute binding
  rendering/        engine selection; engine-specific game code
  ui/ audio/ input/ assets/ analytics/     slots for the game

config/platforms/   platform profiles vendored from the Factory at the pinned version
scripts/            build, verify, release and publish tooling (plain ESM, no framework)
tests/              unit, integration, sdk, e2e, verify
```

## Three ideas worth knowing before reading the code

**Pause counts reasons.** `Game.pause("ad")` and `Game.pause("hidden")` are separate holds; the
game runs again only when every one is released. An ad that ends while the tab is still hidden
does not resume play. Portals reject for audio and input leaking through an ad break, and a
single boolean is how that happens.

**The platform contract mirrors a profile.** Every field of `PlatformCapabilities` is the
runtime counterpart of a field in `core/reference/platforms/<id>.yaml`. `AdPolicy` enforces the
profile's own rules locally, so an unsupported ad kind or an interstitial inside the minimum
interval fails the first time it runs instead of weeks later in review.

**Game code never imports a portal SDK.** That is what lets one codebase ship to several portals,
and release validation checks it: every profile carries a `package.platform_sdk` assertion.

## Engines

PixiJS for 2D, Three.js for 3D, chosen in `game.config.yaml` as `engine.type` and justified in
the title's tech plan. Only the selected engine is bundled — the frameworks are imported
dynamically, because shipping both would put an unused megabyte into every build against caps
as low as the 50 MB in the Factory's GameVui profile — an unverified figure GameVui itself does
not publish ([docs/platforms/gamevui/](docs/platforms/gamevui/platform-contract.md)).

## Platforms

Game code calls `GameIntegration` / `PlatformGameplay`, which drive `@wgf/platform-sdk`. Each
platform has a profile in the Factory and an adapter here, and each is built separately: a
build carries only its own platform's adapter.

| Platform     | Profile         | Adapter                                                      | Upload automated             |
| ------------ | --------------- | ------------------------------------------------------------ | ---------------------------- |
| Generic Web  | ✅              | ✅                                                           | n/a — self-hosted            |
| Yandex Games | ✅              | ✅                                                           | no — no public API           |
| Poki         | ✅              | ✅                                                           | yes — `@poki/cli`            |
| CrazyGames   | ✅              | ✅ HTML5 SDK v3                                              | no — no public API           |
| GameVui      | ✅ (unverified) | ✅ no-SDK — GameVui publishes no SDK; local saves            | no — email / contact form    |
| GameDist.    | ✅ (unverified) | ✅ GD HTML5 SDK — `docs/platforms/gamedistribution.md`       | no — developer panel         |
| Y8           | ✅ (unverified) | ✅ JS SDK 2-0 ([docs/platforms/y8.md](docs/platforms/y8.md)) | no — Developer Portal upload |
| GameMonetize | ✅ (unverified) | ✅ HTML5 SDK — interstitial only; needs a Game ID            | no — dashboard upload        |

"✅ (unverified)" is a Factory core profile at `1.0.0` marked `status: unverified` there.

The Yandex adapter, and a small game that exercises it through every moment moderation
checks, are described in [examples/yandex-compliance-demo](examples/yandex-compliance-demo/README.md)
and assessed in [compliance/yandex-compliance-report.md](compliance/yandex-compliance-report.md).
The CrazyGames adapter's are [examples/crazygames-compliance-demo](examples/crazygames-compliance-demo/README.md)
and [compliance/crazygames-compliance-report.md](compliance/crazygames-compliance-report.md).

Every portal is reached through one contract; `docs/sdk.md` has the adapter matrix, what was
checked against each portal's current documentation, and each known limitation. An unknown
platform id, or a portal build missing its portal id (Y8 App ID, GameDistribution or
GameMonetize Game ID), fails the build. Degrading silently to no-ads would ship a title that
thinks it has a portal SDK and does not, which is a blocking assertion failure at release
validation.

## Pipelines

| Workflow        | Trigger                      | What it is                           |
| --------------- | ---------------------------- | ------------------------------------ |
| `ci.yml`        | every push, forked PRs       | the `ci_green` guard                 |
| `build.yml`     | push to `develop`, or called | build + Cloudflare Pages preview     |
| `verify.yml`    | PR into `main`, or called    | the `verify_suite_green` guard       |
| `release.yml`   | tag `v*`, or dispatch        | freeze a candidate. Does not publish |
| `publish.yml`   | dispatch only                | gate **G6**                          |
| `campaign.yml`  | dispatch only                | gate **G7**                          |
| `bootstrap.yml` | first push in a new repo     | one-time setup, then deletes itself  |

Outside the seven, `yandex-demo.yml`, `crazygames.yml` and `gamevui-demo.yml` build, audit and
browser-test the compliance examples, and `live-portal-validation.yml` runs the opt-in live SDK
checks. They guard the adapters; none is a gate.

`publish.yml` and `campaign.yml` run in GitHub environments with required reviewers. That is
the gate — and both workflows refuse to run if their environment has none, because an
environment nobody configured is created implicitly with no protection and holds nothing back.

**Required reviewers are unavailable on private repositories under a free plan.** A private
game repository on a free organization cannot enforce G6 or G7 this way.

## Testing

| Layer       | Runner     | Runs against                              |
| ----------- | ---------- | ----------------------------------------- |
| unit        | Vitest     | package sources                           |
| integration | Vitest     | real files on disk                        |
| sdk         | Vitest     | every adapter over fake portal SDKs       |
| e2e         | Playwright | the built bundle via `pnpm preview`       |
| verify      | Playwright | the built bundle, measuring package facts |

Nothing sleeps waiting for real time to pass: the loop takes an injected scheduler, and
`AdPolicy` and `Analytics` take an injected clock.

## Status

Foundation and pipelines implemented and exercised on real runners.

| Area                                                                         | State |
| ---------------------------------------------------------------------------- | ----- |
| `@wgf/game-core` — loop, scenes, events, pause, renderer seam                | done  |
| `@wgf/platform-sdk` — abstraction, ad policy, storage, usage recorder        | done  |
| `@wgf/analytics-sdk`, `@wgf/pixi-framework`, `@wgf/three-framework`          | done  |
| `game.config.yaml` load, validation, virtual module                          | done  |
| Minimal i18n from `public/locales/`                                          | done  |
| Package-fact measurement and the assertion evaluator                         | done  |
| Release packaging, manifest, publication records                             | done  |
| Seven workflows, both gates                                                  | done  |
| Portal adapter — yandex, with `examples/yandex-compliance-demo`              | done  |
| Portal adapter — poki, with `examples/poki-compliance-demo`                  | done  |
| CrazyGames adapter, compliance demo, build audit, `crazygames.yml`           | done  |
| GameVui no-SDK adapter (no portal SDK exists; see `docs/sdk.md`)             | done  |
| Y8 adapter (see `docs/platforms/y8.md`)                                      | done  |
| GameDistribution adapter and self-hosted wrapper                             | done  |
| GameMonetize adapter (see `docs/platforms/gamemonetize.md`)                  | done  |
| Contract 2: per-platform builds, `createGame` game API, `sdk:check`          | done  |
| Contract 2: facts from the artifact, per-platform release, `golden:check`    | done  |
| `src/{ui,audio,input,assets,analytics}`, `config/{environments,performance}` | empty |
| `scripts/campaign`                                                           | empty |
