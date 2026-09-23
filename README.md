# Web Game Template

The template every game produced by the **Web Game Factory** is created from. It carries the
game loop, the platform abstraction, the build, the test layout and seven CI/CD pipelines, so
that a new title starts with all of them rather than an approximation of them.

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit + integration
pnpm build        # packages, then dist/
```

Node 20+, pnpm 9. `corepack enable pnpm`, or `npm i -g pnpm@9` if you would rather not run an
elevated shell on Windows.

- [docs/architecture.md](docs/architecture.md) — how the pieces fit
- [docs/development.md](docs/development.md) — working in it day to day
- [docs/testing.md](docs/testing.md) — the three test layers
- [docs/ci-cd.md](docs/ci-cd.md) — the seven pipelines and the two gates
- [docs/release.md](docs/release.md) — freezing a candidate
- [docs/publishing.md](docs/publishing.md) — what is automated and what cannot be
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

| Location     | Owned by     | A game may          |
| ------------ | ------------ | ------------------- |
| `packages/*` | the template | use it, not edit it |
| `src/*`      | the game     | fill it in          |

Reimplementing in `src/` something `packages/` already provides is the most common scaffolding
mistake, and this split is what makes it visible in review.

```
packages/
  game-core         fixed-timestep loop, scenes, events, pause, the Renderer interface
  platform-sdk      the platform abstraction, ad policy, storage, portal adapters
  analytics-sdk     one batched event vocabulary
  pixi-framework    Renderer for engine.type: pixijs
  three-framework   Renderer for engine.type: threejs

src/
  core/             config, i18n, the verify probe
  game/             the game itself — replace boot-scene.ts
  platform/         wiring between platform signals and Game.pause
  rendering/        engine selection; engine-specific game code
  ui/ audio/ input/ assets/ analytics/     slots, currently empty

config/platforms/   platform profiles vendored from the Factory at the pinned version
scripts/            verify, release and publish tooling (plain ESM, no framework)
tests/              unit, integration, e2e, verify
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

**Game code never imports a portal SDK.** That is what lets one build target several portals,
and release validation checks it: every profile carries a `package.platform_sdk` assertion.

## Engines

PixiJS for 2D, Three.js for 3D, chosen in `game.config.yaml` as `engine.type` and justified in
the title's tech plan. Only the selected engine is bundled — the frameworks are imported
dynamically, because shipping both would put an unused megabyte into every build against caps
as low as GameVui's 50 MB.

## Platforms

Game code calls `@wgf/platform-sdk`. Each platform has a profile in the Factory and an adapter
here.

| Platform     | Profile | Adapter         | Upload automated   |
| ------------ | ------- | --------------- | ------------------ |
| Generic Web  | ✅      | ✅              | n/a — self-hosted  |
| Yandex Games | ✅      | not written     | no — no public API |
| Poki         | ✅      | not written     | yes — `@poki/cli`  |
| CrazyGames   | ✅      | ✅ HTML5 SDK v3 | no — no public API |
| GameVui      | ✅      | not written     | no — no public API |

An id with a profile but no adapter throws at startup. Degrading silently to no-ads would ship
a title that thinks it has a portal SDK and does not, which is a blocking assertion failure at
release validation.

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
| e2e         | Playwright | the built bundle via `pnpm preview`       |
| verify      | Playwright | the built bundle, measuring package facts |

Nothing sleeps waiting for real time to pass: the loop takes an injected scheduler, and
`AdPolicy` and `Analytics` take an injected clock.

## Status

Foundation and pipelines implemented and exercised on real runners.

| Area                                                                         | State       |
| ---------------------------------------------------------------------------- | ----------- |
| `@wgf/game-core` — loop, scenes, events, pause, renderer seam                | done        |
| `@wgf/platform-sdk` — abstraction, ad policy, storage, usage recorder        | done        |
| `@wgf/analytics-sdk`, `@wgf/pixi-framework`, `@wgf/three-framework`          | done        |
| `game.config.yaml` load, validation, virtual module                          | done        |
| Minimal i18n from `public/locales/`                                          | done        |
| Package-fact measurement and the assertion evaluator                         | done        |
| Release packaging, manifest, publication records                             | done        |
| Seven workflows, both gates                                                  | done        |
| CrazyGames adapter, compliance demo, build audit, `crazygames.yml`           | done        |
| Portal adapters — yandex, poki, gamevui                                      | not written |
| `src/{ui,audio,input,assets,analytics}`, `config/{environments,performance}` | empty       |
| `scripts/build`, `scripts/campaign`                                          | empty       |
