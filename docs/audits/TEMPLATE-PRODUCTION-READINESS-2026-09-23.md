# Template production-readiness audit — 2026-09-23

Mission: make `web-game-template` ready to produce the first real
WebGameFactory game. Implementation + real-execution verification, not audit
only. All platform behaviour below was exercised against mocks/fakes and local
headless Chromium — **no live portal SDK was contacted** (see Real-portal).

> **Update 2026-09-23 (live validation):** a real-SDK opt-in harness now exists
> (`pnpm test:sdk:live`). Live SDK-script load is **PASS** for CrazyGames and Poki,
> **BLOCKED** for Yandex (portal-served `/sdk.js`), **NOT_APPLICABLE** for GameVui.
> Live init/ads/reward/storage/submission remain **BLOCKED** (no portal accounts).
> See `docs/audits/LIVE-PORTAL-VALIDATION-2026-09-23.md`.

## Commits

- **Baseline:** `5620b37` (post-SDK-conformance-suite merge).
- **Final:** the tip of `main` after this mission (10 topic commits on top of
  baseline; see `git log 5620b37..HEAD`).

## Agents used

Specialists were run as scoped subagents (each owning a disjoint file set), with
the lead owning integration, all regression, the WGF-flow simulation, and the
docs. A tmux session `wgt-template` was created as a monitoring surface.

| Agent | Scope | Files |
|---|---|---|
| lifecycle | foreground-recovery watchdog + `"ad"`-reason guard; later the launch-ad boot-path gap | `src/platform/bind.ts`, `tests/unit/bind.test.ts` |
| crazygames | late rewarded → `ad:late-reward` exactly once; reason normalization | `adapters/crazygames/platform.ts`, `tests/unit/crazygames.test.ts` |
| poki | rewarded/commercial break timeouts + safe recovery | `adapters/poki.ts`, `tests/unit/poki.test.ts` |
| yandex | reason normalization + exactly-once proof | `adapters/yandex.ts`, `tests/unit/yandex.test.ts` |
| sdk-contract | pin normalized `AdResult.reason` in conformance; `stall-open` lever | `tests/sdk/conformance.test.ts`, `tests/sdk/harness.ts` |
| ci | gate SDK conformance + SDK browser matrix | `.github/workflows/ci.yml`, `verify.yml` |
| build-release | sourcemap policy; bundle measurement; tree-shaking evaluation | `vite.config.ts`, `scripts/release/package.mjs` |
| first-game | Tower Merge Rush (PixiJS) | `examples/tower-merge-rush/**` |
| three-game | Neon Drift Arena (Three.js) | `examples/neon-drift-arena/**` |
| adversarial | execute-to-break review (read + execute, no edits) | — (found BUG-1) |

**Branches / worktrees:** integrated directly on `main` as topic commits (single
integrator); no git worktrees were created, so none needed cleanup.

## P1 fixes

1. **CrazyGames late reward** — a rewarded ad that started after the watchdog and
   played to completion emitted only `ad:end` and dropped the reward. Now emits
   `ad:late-reward` exactly once (guarded against duplicate `adFinished`); reward
   is observable via `rewarded:true` **or** one `ad:late-reward`, never both.
2. **Poki break deadlock** — `rewardedBreak`/`commercialBreak` were awaited with
   no deadline; a stuck SDK left the game paused+muted forever. Now raced against
   a 60 s deadline that resolves a failure result so `withAdBreak` resumes and
   unmutes; a late genuine callback cannot double-resolve.
3. **Foreground permanent pause** — `foreground:lost` cleared only by
   `foreground:gained`. Added a bounded recovery watchdog (default 5 s) that
   resumes `"platform"` only when the portal genuinely reports foreground back
   and never while an ad holds the screen. Adversarial review then found the
   launch-ad **boot** path armed no watchdog; both entry points now funnel
   through one `armRecovery()` helper.

## P2 fixes

- **`AdResult.reason` normalized:** unavailable SDK → `not-ready`, concurrent →
  `busy`, no ad kind → `unsupported`, portal-off → `disabled`. Yandex and
  CrazyGames were corrected; conformance now asserts the vocabulary so future
  divergence fails CI.
- **CI gates the SDK suites:** `ci.yml` runs the vitest `sdk` conformance
  project; `verify.yml` runs the SDK browser matrix (`test:sdk:browser`). No
  duplicate pipelines — steps reuse existing jobs and `setup-workspace`.
- **Production sourcemap policy:** `sourcemap: "hidden"` and the release zip
  excludes `*.map`. Submission zip dropped from ~4.5 MB to ~0.27 MB with zero
  sourcemaps; JS output byte-identical.
- **Bundle measured; tree-shaking deferred** with a concrete proposal (engines
  are already lazy-split; pruning the 3 unused adapters (~7 KB gzip in the entry)
  would force `createPlatform` async — a dedicated change, not a drive-by).

## Regression (final, real execution)

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS (exit 0) |
| `pnpm test` | **402 passed**, 2 todo, 24 files (baseline 345); conformance 87 (+2 todo) |
| `pnpm test:e2e` (desktop+mobile) | 6 passed |
| `pnpm test:sdk:browser` | 28 passed (pixijs×threejs × 4 platforms × 2 viewports) |
| `pnpm build` | PASS |
| `pnpm release:package` / `release:manifest` | PASS — zip 0.27 MB, **0 sourcemaps**, manifest schema-valid |
| Tower Merge Rush | build PASS · 15 unit · **14 Chromium e2e** |
| Neon Drift Arena | build PASS · 13 unit · **14 Chromium e2e** |

## WGF flow simulation (real scripts, `game.config.yaml` retargeted then restored)

| Target | build | browser | release |
|---|---|---|---|
| PixiJS × Yandex | PASS | 6 e2e PASS | `yandex.zip` 0.27 MB, 0 maps, manifest→yandex |
| Three.js × CrazyGames | PASS | 6 e2e PASS | `crazygames.zip` 0.27 MB, manifest→crazygames |

## Status summary

- **SDK contract:** consistent across adapters; reasons normalized and asserted.
- **Renderers:** PixiJS and Three.js both first-class — proven by two real games
  and the boot matrix, not just config.
- **CI:** typecheck, lint, unit, integration, SDK conformance (ci.yml); build,
  e2e smoke, SDK browser matrix, runtime-facts (verify.yml). Local == CI pins.
- **Release artifact:** consumable by the Factory `release-manifest.schema.json`.
- **WGF compatibility:** single canonical mechanism (`game.config.yaml`),
  documented in `docs/wgf-integration.md`; production policy in
  `docs/production-build.md`.

## Acceptance matrix

Legend: PASS (real, local) · MOCKED (verified against SDK fakes) · UNVERIFIED
(needs a live portal). BUILD/BROWSER are PASS; SDK is MOCKED (no live portal);
PAUSE/RESUME is MOCKED (driven through the abstraction against fakes + Chromium).

```
                     Yandex        CrazyGames     Poki          GameVui(generic-web)
PixiJS   BUILD       PASS          PASS           PASS          PASS
         BROWSER     PASS          PASS           PASS          PASS
         SDK         MOCKED        MOCKED         MOCKED        PASS (no SDK by design)
         PAUSE/RES   MOCKED        MOCKED         MOCKED        PASS
Three.js BUILD       PASS          PASS           PASS          PASS
         BROWSER     PASS          PASS           PASS          PASS
         SDK         MOCKED        MOCKED         MOCKED        PASS (no SDK by design)
         PAUSE/RES   MOCKED        MOCKED         MOCKED        PASS
```

## Mocked / real / unverified

- **MOCKED:** all Yandex/CrazyGames/Poki SDK behaviour — conformance harness
  fakes + unit mocks + the SDK-browser matrix's injected mock SDKs.
- **REAL (local):** every build, both games and the template in headless
  Chromium, the release pipeline, and the WGF flow for two targets.
- **UNVERIFIED:** live portal behaviour on Yandex, CrazyGames, Poki, GameVui. No
  portal credentials/environment are available locally; a passing mock is not
  proof of portal acceptance. A `workflow_dispatch`-gated CrazyGames live-SDK
  smoke exists but was not run.

## Known limitations

- **Poki has no late-reward channel.** A rewarded reward delivered after the
  deadline is forfeited by design (documented in `poki.ts`); Poki exposes no API
  to deliver it late, so no `ad:late-reward` is fabricated.
- **GameVui has no public SDK.** A GameVui build runs on the `generic-web`
  adapter (local storage, no ads); `createPlatform("gamevui")` throws.
- **All four adapters are bundled in every build** (~7 KB gzip in the entry).
  Tree-shaking is deferred; see `docs/production-build.md`.

## Remaining risks

- Real-portal integration is unverified (above) — the first live submission
  should be watched on each portal.
- The `verify.yml` job now also runs the SDK browser matrix; watch its
  `timeout-minutes: 25` budget as suites grow.
- No vendored Yandex/Poki/GameVui profiles under `config/platforms/` yet (only
  `generic-web`); the Factory supplies the pin at repo creation, but vendoring
  them would let a game be judged offline against the rules in force.

## Verdict

**PRODUCTION-READY / READY FOR WGF FIRST-GAME INTEGRATION** — with live-portal
behaviour explicitly UNVERIFIED and to be confirmed on first submission.
