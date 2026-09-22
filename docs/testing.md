# Testing

Three layers, kept separate because `ci_green` in the Factory's title machine names lint,
typecheck, unit and integration as distinct things — a single `pnpm test` that mixes them
cannot be required independently.

| Layer       | Runner                         | Lives in            | Runs against                         |
| ----------- | ------------------------------ | ------------------- | ------------------------------------ |
| unit        | Vitest (`unit` project)        | `tests/unit`        | package sources                      |
| integration | Vitest (`integration` project) | `tests/integration` | real files on disk                   |
| e2e         | Playwright                     | `tests/e2e`         | the built bundle, via `pnpm preview` |

## Unit

`vitest.workspace.ts` aliases `@wgf/*` to package **sources**, not `dist`. Tests fail on the
code as written rather than on a stale build.

Anything time-dependent takes its clock by injection. `ManualScheduler` drives the game loop
frame by frame, and `AdPolicy` and `Analytics` accept a `now`. No test sleeps to wait for
real time to pass; a test that does is flaky on a loaded CI runner.

## Integration

Reads the actual `game.config.yaml` and runs it through the validator the build uses. The
Factory overwrites that file at scaffolding — if its shape ever drifts from what the build
expects, this fails before a build does.

## E2E

Runs against `pnpm preview`, never the dev server: verification asserts things about the
artifact that ships, and a dev-server run proves nothing about the bundle a portal receives.

Two projects, desktop and mobile. Mobile is not optional — several profiles are majority
mobile and CrazyGames lists missing mobile support as a rejection cause.

The smoke test asserts the boot sequence completed _and_ that the step counter keeps rising.
A page that renders once and freezes passes any "did it load" check.

## What is not here yet

`verification.performance_test` and `verification.mobile_test` in `game.config.yaml` are
declared but not implemented. The assertions they need to satisfy already exist in the
platform profiles — `perf.time_to_interactive_s` on Poki, `perf.lowend_android_fps` on
GameVui — so the measurements have a target to be written against.
