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
4. **GameVui** — no SDK exists; the generic-web build is the deliverable. Hosting basics
   (localStorage, resize, canvas) are checked here; full boot is covered by `pnpm test:e2e`.

Store screenshots + the sanitized JSON under this directory when a cell reaches PASS, and
update `docs/audits/LIVE-PORTAL-VALIDATION-*.md`.
