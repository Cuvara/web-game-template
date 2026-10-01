# Testing

The layers are kept separate because `ci_green` in the Factory's title machine names lint,
typecheck, unit and integration as distinct things — a single `pnpm test` that mixes them
cannot be required independently.

A game created by the Factory is this repository **without `examples/`**. Every suite a game
inherits therefore runs on template sources only: no file under `tests/` imports or reads
anything in `examples/`, and the root `tsconfig.json` does not include it. Tests that exercise
an example live with that example, under `examples/<name>/tests/`, and are picked up by the
same projects when the example is there and simply match nothing when it is not.

## Layers

| Layer           | Command                 | Runner / config                                                   | Lives in                                                            | Runs against                                      | Inherited by a game       |
| --------------- | ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| lint            | `pnpm lint`             | ESLint, `eslint.config.js`                                        | whole repo                                                          | sources                                           | yes                       |
| typecheck       | `pnpm typecheck`        | `tsc -b --force`, then `scripts/typecheck-examples.mjs`           | root `tsconfig.json` + each `examples/*/tsconfig`                   | sources                                           | yes (root half)           |
| unit            | `pnpm test:unit`        | Vitest `unit` project, `vitest.workspace.ts`                      | `tests/unit`, `examples/*/tests/unit`                               | package sources                                   | yes (`tests/unit`)        |
| integration     | `pnpm test:integration` | Vitest `integration` project                                      | `tests/integration`, `examples/*/tests/integration`                 | real files on disk                                | yes (`tests/integration`) |
| sdk             | `pnpm test:sdk`         | Vitest `sdk` project                                              | `tests/sdk`                                                         | every adapter over fake portal SDKs               | yes                       |
| sdk check       | `pnpm sdk:check`        | `scripts/sdk/check-integration.mjs`                               | —                                                                   | the boot wiring in `src/`                         | yes                       |
| e2e             | `pnpm test:e2e`         | Playwright `desktop` + `mobile`, `playwright.config.ts`           | `tests/e2e`                                                         | the built bundle, via `pnpm preview`              | yes                       |
| verify          | `pnpm test:verify`      | Playwright `verify` project, `playwright.config.ts`               | `tests/verify`                                                      | each built platform dist → runtime facts          | yes                       |
| sdk browser     | `pnpm test:sdk:browser` | `scripts/verify/sdk-smoke-build.mjs` + `playwright.sdk.config.ts` | `tests/sdk-browser`                                                 | the template game built per platform, mocked SDKs | yes                       |
| sdk matrix      | `pnpm test:sdk:matrix`  | `playwright.sdk-matrix.config.ts`                                 | `tests/sdk-matrix`                                                  | PixiJS and Three.js × every adapter, mocked SDKs  | yes                       |
| live portals    | `pnpm test:sdk:live`    | `scripts/verify/live-portal.mjs`, `tests/live/live.config.ts`     | `tests/live`                                                        | the real portal SDKs (`WGF_LIVE=1`, manual only)  | yes                       |
| CrazyGames demo | `pnpm test:crazygames`  | `playwright.crazygames.config.ts`                                 | `tests/crazygames`, `examples/crazygames-compliance-demo/tests/e2e` | the demo's build                                  | no — template only        |
| Poki demo       | `pnpm test:poki`        | `playwright.poki.config.ts`                                       | `tests/poki`                                                        | the Poki demo's build                             | no — template only        |
| Yandex demo     | `pnpm demo:yandex:e2e`  | `examples/yandex-compliance-demo/playwright.config.ts`            | `examples/yandex-compliance-demo/tests/e2e`                         | the Yandex demo's build                           | no — template only        |
| other examples  | per example             | `examples/<name>/playwright.config.ts`, `vitest.config.ts`        | `examples/<name>/tests`                                             | that example                                      | no — template only        |

`pnpm test` is unit + integration + sdk. `pnpm test:coverage` runs every Vitest project with
V8 coverage.

The "inherited by a game" column is what matters to the Factory: after `rm -rf examples`,
`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`
all still pass. `tests/crazygames` and `tests/poki` are copied into a game too, but only
`test:crazygames` and `test:poki` run them, and those commands exist to drive the demos; a
game never runs them and no CI job of a game does.

## Unit

`vitest.workspace.ts` aliases `@wgf/*` to package **sources**, not `dist`. Tests fail on the
code as written rather than on a stale build. `.mjs` files are included too: the build and
release scripts under `scripts/` are plain ESM and are tested the same way.

Anything time-dependent takes its clock by injection. `ManualScheduler` drives the game loop
frame by frame, and `AdPolicy` and `Analytics` accept a `now`. No test sleeps to wait for
real time to pass; a test that does is flaky on a loaded CI runner.

Examples' unit tests (`examples/*/tests/unit/**/*.test.ts`) run in the same project. The
GameVui demo's `.mjs` compliance test runs only through its own `vitest.config.ts`
(`gamevui-demo.yml`).

## Integration

Reads the actual `game.config.yaml` and runs it through the validator the build uses. The
Factory overwrites that file at scaffolding — if its shape ever drifts from what the build
expects, this fails before a build does.

`examples/crazygames-compliance-demo/tests/integration` checks that the demo's SDK script tag
and relative `base` agree with the template's; it lives with the demo because it reads it.

## SDK conformance

`tests/sdk` runs every platform adapter through one scenario matrix against fake portal SDKs
(`tests/sdk/portals.ts`). `pnpm sdk:conformance` writes the same run as
`build/sdk-conformance.json`, which is what the Factory's `sdk` step reads. `pnpm sdk:check`
is the static half: it fails, with a JSON report, when the boot wiring in `src/main.ts`,
`src/platform/integration-plan.ts` or `src/game/index.ts` is no longer intact.

## Typecheck

`tsc -b --force` builds the packages' project references and checks `src`, `tests`,
`scripts/build` and the root `*.config.ts`. `scripts/typecheck-examples.mjs` then runs
`tsc -b --force` on every `examples/<name>/tsconfig.json` that exists, and does nothing when
there are none. Each example's tsconfig includes its own `tests` and config files.

## E2E

Runs against `pnpm preview`, never the dev server: verification asserts things about the
artifact that ships, and a dev-server run proves nothing about the bundle a portal receives.

Two projects, desktop and mobile. Mobile is not optional — several profiles are majority
mobile and CrazyGames lists missing mobile support as a rejection cause.

The smoke test asserts the boot sequence completed _and_ that the step counter keeps rising.
A page that renders once and freezes passes any "did it load" check.

## SDK browser suites

Two Playwright suites drive the adapters in headless Chromium without reaching any portal:

- `test:sdk:browser` builds the template game once per platform into `build/sdk-smoke`
  (`scripts/verify/sdk-smoke-build.mjs`) and runs `tests/sdk-browser` against it.
- `test:sdk:matrix` builds its own harness (`tests/sdk-matrix/vite.config.ts`) and runs
  PixiJS and Three.js games against every adapter on desktop and mobile.

## Poki

A suite for the Poki compliance demo in `examples/poki-compliance-demo/`:

| Command                | What it runs                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm demo:poki:build` | the demo's production build — no source maps                       |
| `pnpm audit:poki`      | `scripts/verify/poki-audit.mjs`: static audit of that build        |
| `pnpm test:poki`       | `playwright.poki.config.ts`: desktop, mobile and tablet end to end |

The Playwright suite never reaches Poki. It serves `tests/poki/mock-poki-sdk.js` in place of
the SDK, and that mock is also a referee: it knows Poki's sequencing rules and records every
breach, and each test fails on any breach, any page error, or any request leaving the origin.
Ad blockers are simulated by aborting the SDK request; private browsing by making every
storage API throw; Poki's CSP by serving the page under a policy without `unsafe-eval`.

The audit and the suite are halves of one check. The audit proves what is in the bundle; only
a run proves what is requested. `verify.yml` runs both.

The suite uses port 4391 (`POKI_DEMO_PORT` to change it) and never reuses a running server:
other worktrees on the same machine preview their own builds on the usual ports.

## CrazyGames

`pnpm build:crazygames-demo`, then `pnpm test:crazygames`: `tests/crazygames` (flow, layout,
live SDK, shared fixtures and mock SDK) plus the initial-download measurement in
`examples/crazygames-compliance-demo/tests/e2e`, which reads the demo's `dist/` and writes
`build/crazygames-runtime.json` for `pnpm audit:crazygames`.

## CI

| Workflow           | Trigger                             | Jobs                                                                                     |
| ------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `ci.yml`           | every push, fork PRs, called        | lint, typecheck, unit, integration, sdk conformance, sdk check; `golden` (template only) |
| `verify.yml`       | push to main, PRs into main, called | build, e2e, sdk browser, runtime facts, platform assertions; sdk matrix; Poki demo       |
| `release.yml`      | `v*` tags, dispatch                 | ci + verify, then `build:platforms`, runtime facts, `release:package`, manifest          |
| `crazygames.yml`   | path-filtered push, PRs             | CrazyGames demo: lint, typecheck, unit, integration, build, browser suite, audit         |
| `yandex-demo.yml`  | path-filtered push and PRs          | Yandex demo: unit, build, audit, e2e, archive                                            |
| `gamevui-demo.yml` | path-filtered push                  | GameVui demo: typecheck, unit, build, e2e, audit, package, compliance                    |

Every job that needs an example is guarded on that example being present
(`hashFiles('examples/<demo>/package.json') != ''`, or `examples/wgf-golden-shared/README.md`
for `golden`). `hashFiles` is not available in a job-level `if`, so the demo workflows detect
presence in a small first job and the demo job skips on its output. In a game created by the
Factory those jobs report as skipped rather than failing.

## What is not here yet

`verification.performance_test` and `verification.mobile_test` in `game.config.yaml` are
declared but not implemented. The assertions they need to satisfy already exist in the
platform profiles — `perf.time_to_interactive_s` on Poki, `perf.lowend_android_fps` on
GameVui — so the measurements have a target to be written against.
