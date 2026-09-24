# Live portal validation — evidence & how to run

This directory holds **sanitized** evidence from live portal validation. What "live" can and
cannot prove off-portal, and how to raise a cell from BLOCKED to PASS, is spelled out below.
No tokens, cookies, account data or private URLs are ever stored here.

## What lives where

- `tests/live/` — the harness. Real SDKs only; **no mock is imported anywhere under it.**
- `tests/live/<platform>/live.spec.ts` — per-platform live probe.
- `tests/live/manual/index.html` — instrumented tester that loads the real SDK and calls it
  directly (Init / Interstitial / Rewarded, with a reward counter that flags a double reward).
- `docs/audits/live/<platform>/sdk-load.json` — sanitized evidence written by each spec.
- `docs/audits/live/summary.json` — the aggregated SDK-load matrix.

## Running it

```bash
# Opt-in required. Without WGF_LIVE=1 the runner exits BLOCKED (code 3) — it never
# falls back to mocks and never reports a mock as live.
WGF_LIVE=1 pnpm test:sdk:live
```

CI: `.github/workflows/live-portal-validation.yml` (manual `workflow_dispatch` only). It builds,
packages the release artifact, and runs the suite with `WGF_LIVE` from the `WGF_LIVE_OPT_IN`
secret. A missing secret → BLOCKED, never PASS.

## What each result means

- **PASS** — the real portal SDK/runtime was exercised and the required behavior passed.
- **FAIL** — the real portal was reached and behavior failed.
- **UNVERIFIED** — no live path was available.
- **BLOCKED** — a known external prerequisite prevents execution (portal environment, publisher
  account, portal-served SDK, upload to a QA tool).
- **NOT_APPLICABLE** — there is nothing to exercise (GameVui: no public SDK).

## What is provable off-portal, and what needs the portal

| Layer | Off-portal (this harness) | Needs portal / account |
|---|---|---|
| SDK script reachable + global surface | YES (real CDN, real Chromium) | — |
| init handshake | mostly no (env-gated) | CrazyGames QA tool / Poki Inspector / Yandex draft |
| interstitial / rewarded fill | NO | portal ad server |
| reward delivery / exactly-once | NO | portal ad server |
| pause / resume, cloud storage | NO | portal runtime / player account |
| store submission | NO | publisher account + approval |

## Turning BLOCKED into PASS (the manual path)

1. **CrazyGames** — log in to the [Developer Portal](https://developer.crazygames.com/), upload
   the release zip (or point the QA tool at a served build), and run its SDK checks. Or open
   `tests/live/manual/index.html?platform=crazygames` inside the QA tool. Record: env, ad
   started/finished, reward counter (must stay ≤ 1), and the late-reward case if the tool can
   produce it (otherwise **LIVE UNOBSERVED**).
2. **Poki** — open the game / the manual tester in the [Poki Inspector](https://inspector.poki.dev/).
   Verify commercialBreak/rewardedBreak, mute-before-break, resume+unmute. The 60s timeout can
   only be seen against a genuinely stuck break — if the Inspector won't produce one, record
   **UNVERIFIED** for that specific condition (do not fake it).
3. **Yandex** — upload a draft build in the [developer console](https://games.yandex.com/) and
   open it; the portal serves `/sdk.js`. Verify init, interstitial, rewarded (reward exactly
   once across reward/close/error orderings), `game_api_pause`/`resume`, and player storage.
4. **GameDistribution** — off-portal the probe already loads the real `main.min.js`, sees
   `SDK_READY`, and boots the template's GD build against it (`sdk-load.json`,
   `adapter-boot.json`). Ads need a registered Game ID on an approved domain: upload the
   build in the GD developer panel, view the pre-roll in full once (activation), then check
   pause+mute on `SDK_GAME_PAUSE`, resume on `SDK_GAME_START`, and a single reward on
   `SDK_REWARDED_WATCH_COMPLETE`. See `docs/platforms/gamedistribution.md`.
5. **GameVui** — no SDK exists; the generic-web build is the deliverable. Hosting basics
   (localStorage, resize, canvas) are checked here; full boot is covered by `pnpm test:e2e`.
5. **Y8** — the harness proves the real `cdn.y8.com` script loads, re-announces
   `y8sdk.ready` on `emitReadyEvent()` and exposes every method the adapter calls. Everything
   past that needs the game's own App ID / Game ID (from the Developer Portal's SDK
   Initialization tab, supplied as `WGF_Y8_APP_ID` / `WGF_Y8_GAME_ID` at build time — never
   committed). Build with them, upload to the [Y8 Developer Portal](https://developer.y8.com/),
   and while the game is in review Y8 serves Google's test creatives. Verify: pause + mute
   only when an ad appears (a frequency-capped second break must leave the game running),
   reward only after a full view, sign-in from a click, and a Cloud Storage save/load for a
   signed-in player. See `docs/platforms/y8.md`.

Store screenshots + the sanitized JSON under this directory when a cell reaches PASS, and
update `docs/audits/LIVE-PORTAL-VALIDATION-*.md`.
