# CrazyGames compliance report

**Subject:** the CrazyGames platform adapter in `@wgf/platform-sdk` and the compliance demo
`examples/crazygames-compliance-demo/` ("Orb Catcher"), branch `cuongnd-work/nursehound`.

**Date:** 2026-09-23. **Docs read:** <https://docs.crazygames.com/> as served on that date
(unversioned). **SDK:** HTML5 v3, `https://sdk.crazygames.com/crazygames-sdk-v3.js`,
observed version 3.8.0 (last-modified 2026-09-14).

> **This is not CrazyGames approval.** Nothing here was uploaded to, run in, or reviewed by
> CrazyGames. Only CrazyGames grants Basic or Full Launch. The CrazyGames QA tool was not run
> (see [QA Tool](#qa-tool)).

## Final status

**`READY_WITH_MANUAL_CHECKS`** — for the SDK integration (adapter + platform contract), as
exercised by the demo.

- The requirements found in the docs that code can satisfy are implemented, and nearly all
  are checked by a unit test, a browser test or the build audit — all passing (numbers
  under [Automated Tests](#automated-tests)). The exceptions are listed under
  [Known Risks](#known-risks) → _Untested or not automated_.
- What remains cannot be decided by code: the CrazyGames QA tool, submission metadata
  (covers, videos, description), real-device and non-Chromium browser checks, and
  editorial judgements (PEGI 12, originality, ad placement feel). Listed under
  [Manual Checks](#manual-checks).
- **The demo itself is an integration fixture, not a game to submit.** Its gameplay is
  deliberately minimal; judged as a game it would likely fail initial QA on quality and
  originality ([Known Risks](#known-risks)). A title built on this adapter must pass the
  manual checks on its own content.

## Basic Launch

`BASIC_LAUNCH` requirements ([requirements intro](https://docs.crazygames.com/requirements/intro/)):
total ≤ 250 MB (≤ 50 MB without SDK), initial download ≤ 50 MB, ≤ 1500 files, basic visual
QA, PEGI 12, no external ads, no external logins; if the SDK is present, `gameplayStart` on
the first playable state; with ads disabled, the game must run smoothly and show no rewarded
buttons without effect.

| Item                                    | Result                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Size / count / initial download         | 0.547 MB, 12 files, ≈ 0.48 MB before `gameplayStart` (APPROXIMATION)                                                                    |
| `gameplayStart` on first playable state | Verified in browser, no click needed                                                                                                    |
| Ads disabled (`adsDisabledBasicLaunch`) | Game continues; no rewarded offer is ever shown once ads are known to be off, and none before the first ad answer of a session — tested |
| No external ads / logins                | Audit: no other ad network or portal SDK; no login code                                                                                 |
| Basic visual QA, PEGI 12                | MANUAL                                                                                                                                  |

**Basic Launch status: automatable parts met; manual parts outstanding.** This is a
separate state from Full Launch and is not reported as it.

## Full Launch

`FULL_LAUNCH` adds: SDK integration (gameplay start/stop, Data/User where applicable), ads
only through the SDK per the ad requirements, works with an ad blocker, land directly in
gameplay (≤ 1 click), full visual QA, account integration where the game has accounts.

| Item                                                                                            | Result                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Gameplay start/stop on every break; not on focus loss                                           | Verified (call sequence asserted)                                |
| Loading start/stop                                                                              | Verified                                                         |
| Ads through SDK; midgame at breaks; pause, input block, mute-on-start                           | Verified                                                         |
| Rewarded rules (optional, occasional, equal-weight decline, alternative, never reward on error) | Verified; editorial feel MANUAL                                  |
| Works with an ad blocker (SDK blocked, or `adblock` answers)                                    | Verified                                                         |
| Land directly in gameplay                                                                       | Verified (0 clicks)                                              |
| Progress saved in the Data module                                                               | Verified (reload, blocked→unblocked migration)                   |
| User module (username/avatar)                                                                   | Implemented in adapter; NOT_APPLICABLE to the demo (no accounts) |
| Full visual QA                                                                                  | MANUAL                                                           |

**Full Launch status: SDK integration requirements met and tested; the manual checks
below are outstanding.** The adapter can only _observe_ the stage at runtime
(`observedLaunchStage`: `basic` after `adsDisabledBasicLaunch`, `full` after an ad starts
on a CrazyGames domain).

## SDK

- v3 script in `<head>` before game code (demo `index.html`; root `vite.config.ts` injects
  it only when the primary platform is `crazygames`). Audit `sdk_version`: PASS.
- `await SDK.init()` before any call; `environment === "disabled"` → no SDK calls at all;
  script blocked → game plays as a plain web game.
- Only documented v3 members are called (`packages/platform-sdk/src/adapters/crazygames/sdk.ts`).
  No SDK call exists outside the adapter.
- Live check: the real v3 SDK on localhost initialises in `local` mode and the demo reaches
  gameplay — 3/3 (desktop, mobile, tablet) in the validator's run.

## Ads

Midgame requested only from "Next level" on the level-complete screen, not before level 3
is done ([pacing guide](https://docs.crazygames.com/resources/midgame-ads-pacing/)), never
twice on one break and never after a rewarded ad on the same break. From request to
`adFinished`/`adError`: loop paused, full-screen input shield, buttons disabled. Audio
muted on `adStarted` only (an unfilled request never mutes). Any ad that starts — even one
arriving after the adapter's 30 s no-start watchdog — pauses whatever is on screen.
`unfilled`, `adCooldown`, `adblock`, `adsDisabledBasicLaunch` and `other` are handled; the
game continues. Rewarded: offered on at most one break in three (counted from the last
_offer_, so declining does not bring it back), 🎬 + "Watch ad" label, same button style as
"Next", coins alternative, reward only on `adFinished`. The level-complete panel ignores
input for 350 ms after appearing so that a tap in flight cannot start an ad the player did
not choose. Banners: not used.

## Data

`platform.storage` is the Data module on CrazyGames; local storage only when the SDK is
disabled or blocked, and those saves are copied into the Data module (never over existing
cloud data) once it is back. One JSON key (≈ 60 bytes, limit 1 MB). Save errors
(`dataLimitExcedeed`, `dataModuleDisabled`) reject with their code, and every confirmation
the demo shows after a save says so when the save failed (browser test with a
`dataModuleDisabled` mock). The fallback copies are removed on the boot after migration
(the cloud sync is debounced), so a later account on the same browser does not inherit
them. **Manual:** select "Progress Save: Data module" in the
submission, or the module is disabled.

## User

`getUser()` checks `isUserAccountAvailable`, returns `null` for guests. Never uses
`__dangerousUserId`. The demo has no accounts (the docs' "games without accounts"
scenario), so username/avatar/auto-login are NOT_APPLICABLE to it; a title with accounts
must implement the account-integration flow itself.

## Gameplay

Lands in gameplay; in-gameplay onboarding hint (keys labelled from the Keyboard Map API —
Q D on AZERTY — arrows only where unavailable); fixed-timestep physics identical at 60, 144
and 165 Hz (unit test); English with `systemInfo.locale` → fallback `en`; no fullscreen
button; no links, no cross-promotion, no iframes; no restricted keys bound; Space still
activates focused buttons.

## Technical

Relative paths (`base: "./"` in both Vite configs — the root template previously emitted
absolute `/assets/...` paths, which CrazyGames says fail to load); `user-select: none`
(all prefixes); safe-area padding; iOS `AudioContext` resume on gesture; browser defaults
(wheel scroll, arrow scroll, context menu) suppressed. `bindPlatform` in the template now
respects `gameplayStopOnHidden` (CrazyGames: don't report focus loss) and exposes the
required mute state; `src/main.ts` prefers the portal locale.

## File Size

|       | Value    | Limit             | Status |
| ----- | -------- | ----------------- | ------ |
| Total | 0.547 MB | 250 MB (with SDK) | PASS   |
| Files | 12       | 1500              | PASS   |

Limits: `config/platforms/crazygames-limits.json`, each with source URL and retrieval date;
1 MB taken as 1,000,000 bytes (the stricter reading; the docs do not define it).

## Initial Download

| Measurement                                                                                                          | Value                                | Status        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------- |
| Static lower bound (index.html + static import graph)                                                                | 0.275 MB                             | APPROXIMATION |
| Runtime, bytes before first `gameplayStart` (decoded; 0.14 MB on the wire), first `gameplayStart` at 0.8–3 s locally | 0.481 MB                             | APPROXIMATION |
| Limits                                                                                                               | 50 MB; 20 MB for the mobile homepage | —             |

APPROXIMATION, not PASS: CrazyGames measures this itself through its CDN, with the real SDK
(the runtime figure used a mock SDK, so the SDK script's own bytes are not included). The
margin is two orders of magnitude, but the authoritative figure is the portal's.

## Mobile

800×450 landscape with touch: full levels played by tapping, ads, rewarded, saves — pass.
Portrait 450×800 layout checked (not an official size; orientation is chosen in the
submission). **Not tested:** real phones, iOS Safari/WebKit, the CrazyGames Android/iOS app
(safe areas, `capacitor://` origin), iOS audio interruption.

## Tablet

1080×607 with touch: same suite as mobile — pass. Real tablets not tested.

## Desktop

1280×720 mouse + keyboard project, plus all eight desktop iframe sizes from the gameplay
requirements (907×510, 1216×684, 1077×606, 821×462, 1366×768, 1920×1080, 1536×864,
1280×720) at DPR 1: canvas fills the frame, no scroll, every HUD/panel element inside the
viewport, no overlaps, text ≥ 14 px. **Not tested:** Edge, Safari, Firefox, Chromebook
(4 GB RAM).

## Performance

First `gameplayStart` 0.8–3.1 s on a local preview (regression guard < 8 s); 0 files loaded
after `gameplayStart`; no uncaught page errors in any browser test. No frame-rate or
low-end-device measurement was taken for this demo. MANUAL on real low-end hardware.

## Metadata

Not produced — the demo is not being submitted. Required for any real submission:
covers 1920×1080, 800×1200, 800×800 (title only; no borders, logos or "Play" text);
preview videos 15–20 s, ≤ 50 MB, 1080p 16:9 and 2:3, no sound; description and controls
([game covers](https://docs.crazygames.com/requirements/game-covers/)).

## QA Tool

**`MANUAL_REVIEW_REQUIRED` — not run.** The QA/preview tool lives in the Developer Portal
(<https://developer.crazygames.com/>, `crazygames.com/preview`), needs a logged-in developer
account and an uploaded build, and has no public API. No account was used and nothing was
uploaded, by instruction. Nothing in this report claims a QA-tool result.

## Automated Tests

Final run on this tree (main agent, 2026-09-23):

| Suite                                                                  | Result                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm format`, `pnpm typecheck` (root + demo)             | pass                                                                                                                       |
| `pnpm test` (Vitest unit + integration)                                | **127 / 127**                                                                                                              |
| `pnpm build:crazygames-demo`                                           | pass                                                                                                                       |
| `pnpm test:crazygames` (desktop, mobile, tablet; mocked SDK)           | **87 passed, 0 failed**, 27 skipped by design (desktop-only size matrix and measurement; live-SDK spec)                    |
| Former touch flakes, `--repeat-each=4`                                 | **36 / 36** (main agent); **96 / 96** (validator, round 2)                                                                 |
| `pnpm audit:crazygames --dir examples/crazygames-compliance-demo/dist` | 16 PASS, 2 APPROXIMATION, 1 WARN (`www.pixijs.com` literal inside PixiJS, never requested), 1 MANUAL (QA tool), **0 FAIL** |

Also: root `pnpm build` and root `pnpm test:e2e` **6 / 6** (the shared changes did not break
the template). The panel input guard test was mutation-checked: with the guard disabled it
fails. Browser runs use a private port (`CG_DEMO_PORT`) and their own output directory, so
concurrent runs in one checkout cannot corrupt each other.

Validator, round 2 (independent, in place, tree unchanged start to end): **PASSED** —
lint, format, typecheck, unit 105/105, integration 18/18, full browser suite 81/0/27, touch
repeat 96/96, live SDK 3/3, the exact CI live-SDK command 1/1, audit 0 FAIL, stale-runtime
rejection, root build + e2e 6/6, workflow YAML parse and command existence; Unity
NOT_TESTABLE (no Unity project — none was faked); QA tool MANUAL_REQUIRED. (Round 2 ran
before the last round of fixes below; the main agent's final run above covers those.)

## CI

`.github/workflows/crazygames.yml`: lint, typecheck, CrazyGames unit + integration tests,
demo build, the browser suite on all three devices, the audit, a step-summary and uploaded
artifacts. Optional `workflow_dispatch` input runs the live-SDK smoke. Read-only
permissions, no secrets, nothing published. **Not yet run on GitHub** — nothing was pushed.

## Claude Review

Two independent Claude sessions ran in Orca terminals in this worktree ("Claude CrazyGames
Reviewer", "Claude CrazyGames Validator"); reports under `build/claude-review/` (gitignored).

**Round 1** found, and this change set fixed:

| Finding                                                              | Source                 | Fix                                                                          |
| -------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Rewarded offer reappeared at every break after a decline             | Reviewer F1            | Count from last offer; declined-offer test                                   |
| Progress saved while the SDK was blocked was lost once it loaded     | Reviewer F2            | Adapter copies fallback saves into the Data module; unit + browser test      |
| Browser suite silently tested another checkout's server on port 4174 | Reviewer F3, Validator | `reuseExistingServer: false`, `CG_DEMO_PORT`, title check; same for root e2e |
| AZERTY hint label wrong                                              | Reviewer F4            | Keyboard Map API labels                                                      |
| Compliance report missing                                            | Reviewer M1            | This file                                                                    |
| Template boot path ignored muteAudio, ad mute, portal locale         | Reviewer M2            | `bindPlatform` mute state + `src/main.ts` locale                             |
| First midgame after ~10 s                                            | Reviewer MA2           | None before level 3                                                          |
| Silent save failure                                                  | Reviewer MA3           | Player-visible notice                                                        |
| Space blocked on focused buttons                                     | Reviewer MA7           | Only prevented off buttons                                                   |
| Late ad after watchdog played over live gameplay                     | Reviewer U2            | Any `ad:start` pauses; browser test                                          |
| Early `adCooldown` kept rewarded hidden until a non-cooldown answer  | Reviewer U3            | Any midgame answer counts                                                    |
| **Stray tap started a rewarded ad** (touch flake root cause)         | Validator F1           | 350 ms panel input guard; tests tap below the panel                          |
| CI live-SDK command never ran the test                               | Validator F2           | Path before variadic `--project`                                             |
| Stale runtime measurement accepted by the audit                      | Validator              | `index_html_sha256` check                                                    |

**Round 2** — reviewer: every round-1 item verified fixed or correctly classed MANUAL;
**no blocking code defect** in the adapter or the demo's integration; six non-blocking
findings, all addressed:

| Finding                                                        | Fix                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 stray-tap guard had no regression test                      | Deterministic test under Playwright's clock (real tap/click during the guard must not press "Next"; control press after it must); mutation-checked          |
| N2 fallback saves never cleared after migration                | Removed on the boot after migration (made deferred after round 3, so the debounced cloud sync cannot lose the only copy); unit test covers a second account |
| N3 `MIDGAME_FROM_LEVEL` counts lifetime levels                 | Kept (docs allow; SDK protects session start); comment corrected                                                                                            |
| N4 shared `test-results/` let concurrent runs delete traces    | Separate `outputDir` per config (`PW_OUTPUT_DIR` override)                                                                                                  |
| N5 report overclaims                                           | Corrected (this revision)                                                                                                                                   |
| N6 template `bindPlatform` did not report a late ad as a break | `gameplayStop`/`gameplayStart` around an ad that lands on live play; unit test                                                                              |
| N8 runtime file without build hash accepted                    | Treated as stale; unit test                                                                                                                                 |
| MA3 gap: "Coins doubled!" hid a failed save                    | Every post-save confirmation reports failure; browser test                                                                                                  |
| F4 label untested                                              | `keyLabels` unit tests (QWERTY, AZERTY, refused, missing)                                                                                                   |

Validator round 2: **PASSED** (details under [Automated Tests](#automated-tests)).

**Round 3** (reviewer, focused on the round-2 fixes, private port and output directory):
**no blocking issue**; all nine fixes verified; vitest 127/127, browser suite 87/0/27,
repeat 36/36, audit 0 FAIL. Its one residual (the fallback save deleted before a logged-in
player's debounced cloud sync is confirmed) was then addressed by deferring the deletion to
the next boot; the main agent's final run above is on that tree.

## Manual Checks

1. Run the build in the CrazyGames QA/preview tool and record its findings.
2. Developer Portal: select Data-module progress save; set orientation; fill description
   and controls.
3. Covers and preview videos to spec.
4. Edge, Safari, Firefox; a 4 GB Chromebook; a real Android phone and an iPhone (incl. iOS
   audio after a phone call); the CrazyGames iOS/Android app (safe areas).
5. PEGI 12, originality, visual quality and ad-placement feel — by a person, on the actual
   title.
6. Confirm the portal's own initial-download figure.

## Known Risks

- **Untested or not automated:** the Space-key fix (focused buttons still activate); WebKit
  and Firefox (automatable, not configured); real devices; iOS audio interruption; the
  CrazyGames app. Everything else claimed as verified has a test or an audit check.
- **A title must wire its own audio** to `bindPlatform(…, { onAudioMutedChange })` (or the
  equivalent events); the template's `src/audio/` is still an empty slot, so `muteAudio`
  compliance of a real title is that title's responsibility.

- **Demo quality.** Minimal gameplay and procedural art: fine for integration, likely a
  quality/originality rejection if submitted as a game.
- **SDK behaviour only observable on the portal**: whether ad blockers block
  `sdk.crazygames.com` on crazygames.com; exact start-of-session and cooldown answers of the
  live SDK; real auction latency against the 30 s no-start watchdog.
- **Undocumented launch stage.** The SDK exposes no documented way to ask whether ads are
  enabled; the demo infers it from the first midgame answer.
- **Mocked SDK in CI.** The mock implements the documented surface; the live-SDK smoke is
  opt-in because it depends on the network and a script outside the repository.
- **Docs are unversioned.** Limits are dated; re-read the source pages before relying on
  them.
- **Factory profile drift.** `crazygames.yaml@1.0.0` lacks the initial-download, file-count
  and relative-path rules and lists 4 screenshots instead of covers/videos — see
  [requirements.md](../docs/platforms/crazygames/requirements.md#where-the-factory-profile-disagrees-with-the-docs).

## Official Sources

Read 2026-09-23:
[requirements intro](https://docs.crazygames.com/requirements/intro/) ·
[technical](https://docs.crazygames.com/requirements/technical/) ·
[gameplay](https://docs.crazygames.com/requirements/gameplay/) ·
[quality](https://docs.crazygames.com/requirements/quality/) ·
[ads](https://docs.crazygames.com/requirements/ads/) ·
[account integration](https://docs.crazygames.com/requirements/account-integration/) ·
[game covers](https://docs.crazygames.com/requirements/game-covers/) ·
[multiplayer](https://docs.crazygames.com/requirements/multiplayer/) ·
[basic launch metrics](https://docs.crazygames.com/resources/basic-launch-metrics/) ·
[SDK intro](https://docs.crazygames.com/sdk/intro/) ·
[game](https://docs.crazygames.com/sdk/game/) ·
[video ads](https://docs.crazygames.com/sdk/video-ads/) ·
[data](https://docs.crazygames.com/sdk/data/) ·
[user](https://docs.crazygames.com/sdk/user/) ·
[banners](https://docs.crazygames.com/sdk/banners/) ·
[FAQ](https://docs.crazygames.com/faq/) ·
[CrazyGames app](https://docs.crazygames.com/resources/crazygames-app/) ·
[sitelock](https://docs.crazygames.com/resources/html5/sitelock/) ·
[midgame pacing](https://docs.crazygames.com/resources/midgame-ads-pacing/) ·
[common fixes](https://docs.crazygames.com/resources/html5/common-fixes/) ·
[getting to the first frame](https://docs.crazygames.com/resources/getting-to-the-first-frame/).
Requirement-by-requirement mapping:
[docs/platforms/crazygames/requirements.md](../docs/platforms/crazygames/requirements.md).
