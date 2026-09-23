# Live portal validation — 2026-09-23

Purpose: replace as many `UNVERIFIED` cells as reality allows with **real** evidence, and state
precisely which parts of the pipeline are proven against real portals and which are not. A
passing mock is never reported as a live PASS.

- **Repository:** web-game-template
- **Build SHA:** `80f388e` (live harness added on top of `cbbe83a`)
- **Test date:** 2026-09-23
- **Environment:** local WSL2 (Linux), headless Chromium **153.0.8010.12** (Playwright
  chromium-headless-shell v1243), outbound HTTPS available.
- **Portal accounts / publisher credentials:** none available → all portal-gated flows BLOCKED.
- **How to reproduce:** `WGF_LIVE=1 pnpm test:sdk:live` (see `docs/audits/live/README.md`).

## What was actually exercised

Real portal SDK **scripts** were fetched from their real URLs and run in real Chromium; their
globals and method surfaces were inspected. This is genuine live evidence for the SDK-load
layer. Everything that needs the portal's own backend/iframe/account — init handshake, ad fill,
reward delivery, cloud storage, store submission — was **not** reachable here and is reported
BLOCKED, with the manual path documented to close it.

Docs cross-check (current official docs, fetched 2026-09-23): **no discrepancies** between the
adapters and the current Yandex / CrazyGames / Poki docs; SDK URLs and callback contracts all
match. GameVui confirmed to have **no public JS SDK** today.

## Matrix

Values: PASS · FAIL · UNVERIFIED · BLOCKED · NOT_APPLICABLE.
`SDK` = real SDK **script load + global surface** in Chromium (not ad/reward, which are BLOCKED).
`Browser` = boot/render/lifecycle in Chromium (against **mock** SDKs — see the split below).

```
                SDK            Build   Browser        Portal (init/ads/reward/submit)
Yandex          BLOCKED        PASS    PASS (mock)    BLOCKED
CrazyGames      PASS           PASS    PASS (mock)    BLOCKED
Poki            PASS           PASS    PASS (mock)    BLOCKED
GameVui         NOT_APPLICABLE PASS    PASS (mock)    UNVERIFIED
```

## Per-platform, with the mock/live split spelled out

### Yandex
- **SDK mock:** PASS (conformance + sdk-browser boot against the injected mock).
- **SDK live (script load):** **BLOCKED** — the SDK is portal-relative `/sdk.js`; it does not
  resolve off the portal origin (confirmed: script did not load). Evidence:
  `docs/audits/live/yandex/sdk-load.json`.
- **Live init / interstitial / rewarded / reward-exactly-once / pause / resume / storage:**
  **BLOCKED** — need a Yandex Games draft build opened from the developer console.
- Evidence path to PASS: upload a draft build, exercise via `tests/live/manual/index.html`.

### CrazyGames
- **SDK mock:** PASS.
- **SDK live (script load):** **PASS** — `https://sdk.crazygames.com/crazygames-sdk-v3.js`
  loaded in Chromium, `window.CrazyGames.SDK` present, `init` resolved off-portal (env not a
  CrazyGames domain). Evidence: `docs/audits/live/crazygames/sdk-load.json`.
- **Live ads / rewarded / reward-exactly-once / late-reward / cooldown:** **BLOCKED** — real ad
  fill only on a CrazyGames domain or via the Developer Portal QA tool (login + upload). The
  previously fixed late-reward path cannot be triggered here; classify **LIVE UNOBSERVED** until
  the QA tool produces it.
- Evidence path to PASS: Developer Portal QA tool with the release zip / the manual tester page.

### Poki
- **SDK mock:** PASS.
- **SDK live (script load):** **PASS** — `https://game-cdn.poki.com/scripts/v2/poki-sdk.js`
  loaded, `window.PokiSDK` present with `init`, `gameLoadingFinished`, `commercialBreak`,
  `rewardedBreak`, `gameplayStart`, `gameplayStop`. Evidence: `docs/audits/live/poki/sdk-load.json`.
- **Live commercial/rewarded break, mute-before-break, resume+unmute:** **BLOCKED** — only via
  the Poki Inspector (`inspector.poki.dev`, upload/login).
- **60s break timeout / late callback:** **UNVERIFIED** — needs a genuinely stuck break the
  Inspector may not produce; do not fake it.
- Evidence path to PASS: Poki Inspector with the release build / the manual tester page.

### GameVui
- **SDK:** **NOT_APPLICABLE** — no public GameVui JS SDK exists (confirmed against current
  sources). A GameVui build runs on the `generic-web` adapter (local storage, no ads).
- **Hosting basics (live, Chromium):** localStorage, resize, canvas all **PASS**. Evidence:
  `docs/audits/live/gamevui/sdk-load.json`. Full generic-web boot is covered by `pnpm test:e2e`
  and the generic-web cases of `pnpm test:sdk:browser`.
- **Portal:** **UNVERIFIED** — GameVui submission is a manual email process, not a self-serve
  SDK/test environment.

## Mock vs live vs unverified (explicit, per §21)

- **Yandex** — SDK mock: PASS · live: UNVERIFIED (SDK-load BLOCKED off-portal; init/ads BLOCKED).
- **CrazyGames** — SDK mock: PASS · live SDK-load: PASS · live ads/reward: BLOCKED (LIVE UNOBSERVED).
- **Poki** — SDK mock: PASS · live SDK-load: PASS · live breaks/reward: BLOCKED; 60s-timeout: UNVERIFIED.
- **GameVui** — SDK: NOT_APPLICABLE · hosting basics: PASS · portal: UNVERIFIED.

## Real release artifact

`pnpm release:package` + `release:manifest` produce a schema-valid manifest and a
sourcemap-free zip (0 `.map` entries), index.html at root. The WGF flow was run for
PixiJS×Yandex and Three.js×CrazyGames (build→browser→release). Opening the exact artifact
inside a portal QA tool is the remaining BLOCKED step (needs portal access).

## CI

`live-portal-validation.yml` (manual `workflow_dispatch`): build → package → `pnpm test:sdk:live`
with `WGF_LIVE` from the `WGF_LIVE_OPT_IN` secret → upload sanitized evidence. Absent secret →
BLOCKED (never PASS). It does not publish.

## Issues discovered & fixed this pass

- Pre-existing `prefer-const` lint error in the Tower Merge Rush example would have failed
  `ci.yml` lint — fixed (documented forward-declaration for a ui↔app construction cycle).
- No adapter/behavioral defects found; docs cross-check found no discrepancies.

## Remaining UNVERIFIED / BLOCKED (external)

Live init/ads/reward/pause/storage on Yandex, CrazyGames, Poki, and any GameVui portal
behavior, plus store submission — all require portal environments or publisher accounts not
available here. The harness + manual pages + workflow make each reproducible the moment access
exists.

## Verdict

**READY FOR WGF, WITH EXTERNAL PORTAL BLOCKERS.** The offline pipeline (build, test, browser,
package, release) and the SDK-script layer for CrazyGames and Poki are proven; live
portal-backed behavior is honestly BLOCKED/UNVERIFIED pending portal access.
