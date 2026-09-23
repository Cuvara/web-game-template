# Yandex Games Compliance Report

**Subject:** the Yandex adapter in `packages/platform-sdk/src/adapters/yandex*.ts` and the demo
game `examples/yandex-compliance-demo/` ("Starfall Basket").
**Date:** 2026-09-23. **Documentation read:** official Yandex Games docs at
<https://yandex.com/dev/games/doc/en/>. The requirements page said "Last Updated: August 18, 2026".
**Not approved by Yandex.** Nothing here has been submitted to or reviewed by Yandex. Only
Yandex moderation can approve a game. This report says how close the build is to being ready
for submission.

The statuses mean:

| Status                   | Meaning                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `PASS`                   | checked by a test or audit that was run, with the evidence cited    |
| `FAIL`                   | checked and does not meet the requirement                           |
| `MANUAL_REVIEW_REQUIRED` | can only be judged by a person, on a device or in the Console       |
| `NOT_TESTABLE_LOCALLY`   | needs the real portal (draft mode, debug panel, real ads, real CSP) |
| `NOT_APPLICABLE`         | the demo does not use the feature                                   |
| `UNKNOWN`                | the official docs do not settle it                                  |

Every `PASS` was checked against a **mock** `/sdk.js` (`tests/e2e/mock-sdk.js`) or a fake SDK
in unit tests. Both follow the documented API, but neither is Yandex's SDK. What the real portal
does with these calls is covered in **Manual Checks**.

Requirement numbers (1.19.2, 4.7, …) refer to
<https://yandex.com/dev/games/doc/en/concepts/requirements>.

---

## SDK

| Requirement                                                                                                           | Official URL                                                                                                                              | Implementation                                                                                                                                                                                                                                                                                                                                                                | Validation                                                                                                                                                                                                                                                                | Status                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1.1 / 1.19.1: SDK connected from `/sdk.js`, a relative path for an archive upload, and loaded before `YaGames.init()` | [sdk-about](https://yandex.com/dev/games/doc/en/sdk/sdk-about)                                                                            | `loadSdkScript()` adds `<script async src="/sdk.js">` and waits for `onload` before `init()` (`adapters/yandex.ts`)                                                                                                                                                                                                                                                           | audit `sdk_relative_path`; unit tests                                                                                                                                                                                                                                     | PASS                                                                                         |
| 1.7: no absolute URLs to Yandex S3                                                                                    | [requirements](https://yandex.com/dev/games/doc/en/concepts/requirements)                                                                 | only `/sdk.js` is referenced                                                                                                                                                                                                                                                                                                                                                  | audit `no_absolute_s3`                                                                                                                                                                                                                                                    | PASS                                                                                         |
| `YaGames.init()` called once                                                                                          | sdk-about                                                                                                                                 | `initialize()` is memoised                                                                                                                                                                                                                                                                                                                                                    | unit test "initialises once"; e2e init count = 1                                                                                                                                                                                                                          | PASS                                                                                         |
| The game survives an unavailable SDK: missing script, `init()` hangs, `getPlayer()` fails                             | 1.14                                                                                                                                      | the adapter falls back to local saves, ads report `error`, and boot continues                                                                                                                                                                                                                                                                                                 | unit tests (3); e2e "boots and plays without the SDK"                                                                                                                                                                                                                     | PASS                                                                                         |
| 1.19.2: `LoadingAPI.ready()` called once, when the game can be played, not on a timer                                 | [sdk-game-events](https://yandex.com/dev/games/doc/en/sdk/sdk-game-events), [1.19](https://yandex.com/dev/games/doc/en/requirements/1/19) | `signalReady()` runs after the menu is shown and the boot overlay is removed (`main.ts`)                                                                                                                                                                                                                                                                                      | e2e: the mock records `menuVisible: true, bootGone: true` at `ready()`, exactly once                                                                                                                                                                                      | PASS (mock); portal indicator: NOT_TESTABLE_LOCALLY                                          |
| 1.19.3: `GameplayAPI.start()`/`stop()` called only at the documented moments                                          | sdk-game-events                                                                                                                           | `App.#sync()` derives "running" from state; the adapter sends only transitions                                                                                                                                                                                                                                                                                                | unit test "GameplayAPI follows exactly"; e2e sequence start/stop/start/stop                                                                                                                                                                                               | PASS (mock)                                                                                  |
| 1.19.4: `game_api_pause`/`game_api_resume` handled; the portal's launch ad with no callbacks is handled               | [sdk-events](https://yandex.com/dev/games/doc/en/sdk/sdk-events)                                                                          | subscribed straight after `init()`, before Game Ready; `foreground` state is kept for late subscribers                                                                                                                                                                                                                                                                        | unit tests; e2e "holds the game through the portal's launch ad"                                                                                                                                                                                                           | PASS (mock)                                                                                  |
| The portal restarts GameplayAPI by itself on resume, while the game is still on its pause screen                      | sdk-events ("GameplayAPI.start() is executed")                                                                                            | the adapter sends `stop()` again 0 ms and 500 ms after resume if the game has not restarted (review finding R1)                                                                                                                                                                                                                                                               | unit tests (including the delayed case); e2e with a mock that models the documented auto start/stop synchronously                                                                                                                                                         | PASS (mock); whether the real `start()` is synchronous is UNKNOWN, so the 🎮 check is MANUAL |
| Account-selection dialog: sync paused, player fetched again                                                           | sdk-events                                                                                                                                | `ACCOUNT_SELECTION_DIALOG_OPENED/CLOSED` through `ysdk.EVENTS` → `suspendSync()`; on close, re-`getPlayer()` and `attach(player, "cloud")` → `storage:changed`, and the game returns to the menu                                                                                                                                                                              | unit tests (adapter and app)                                                                                                                                                                                                                                              | PASS (fake SDK)                                                                              |
| Account selection: the chosen progress wins                                                                           | sdk-events; 1.9                                                                                                                           | the chosen player's data replaces the local copy outright, even when the guest save on this device is newer; writes made while the dialog is open are dropped; if the new player cannot be read, the game falls back to local saves rather than writing into the unknown account, and marks the local copy stale so the next boot defers to the account (Reviewer N1, L1, L2) | unit tests                                                                                                                                                                                                                                                                | PASS (fake SDK)                                                                              |
| Call order under Yandex's official dev-mode SDK (Yandex's own mocks, not production)                                  | [local launch](https://yandex.com/dev/games/doc/en/concepts/local-launch)                                                                 | —                                                                                                                                                                                                                                                                                                                                                                             | Validator ran Yandex's official `@yandex-games/sdk-dev-proxy` in `--dev-mode=true` headless. Yandex's dev-mode adapter (mocked calls) logged the full documented lifecycle in order, including both ad types and their callbacks. The sequence is under **Claude Review** | PASS (Yandex dev-mode SDK)                                                                   |
| No undocumented or deprecated API                                                                                     | sdk-adv, sdk-player                                                                                                                       | the typed subset is in `adapters/yandex-sdk.ts`; `onOffline`, `getPlayer({scopes})` and `getMode()` are not used                                                                                                                                                                                                                                                              | code review (main agent and Reviewer V25)                                                                                                                                                                                                                                 | PASS                                                                                         |

## Technical Requirements

| Requirement                                                            | Implementation                                                                                                                                   | Validation                                                                                                                                                                                      | Status                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1.21: at most 100 MB uncompressed                                      | 0.54 MB, 13 files                                                                                                                                | audit `archive_size`; `yandex-archive.mjs` re-reads the ZIP                                                                                                                                     | PASS                                                  |
| 1.22: `index.html` at the archive root; no spaces or Cyrillic in names | `pnpm demo:yandex:package`                                                                                                                       | the archive script checks the written ZIP; audit `file_names`                                                                                                                                   | PASS                                                  |
| Asset paths work under the portal's CDN path                           | `base: "./"`                                                                                                                                     | audit `relative_asset_paths`                                                                                                                                                                    | PASS                                                  |
| 1.14: no errors or freezes; boot failure is visible                    | ads always return control (onClose(false), onError, throw, open-timeout); localized boot-failure text                                            | unit tests; e2e checks no `pageerror` or console errors                                                                                                                                         | PASS (automated); freeze-free play on devices: MANUAL |
| 1.14: no technical text if a locale file fails to load                 | English table compiled in as a fallback                                                                                                          | e2e "a locale file that fails to load shows English"                                                                                                                                            | PASS                                                  |
| 1.15: finished product, no debug or dev leftovers                      | no `debugger`, no dev URLs, no source maps in the archive                                                                                        | audit `no_debugger`, `no_dev_urls`, `no_source_maps`                                                                                                                                            | PASS; "finished look": MANUAL                         |
| 1.18: not tied to the URL it is opened from                            | no host checks anywhere                                                                                                                          | code review                                                                                                                                                                                     | PASS                                                  |
| 1.20: browsers and OS versions (Android 5+, **iOS 9+**)                | ES2020 build target, PixiJS 8                                                                                                                    | not tested                                                                                                                                                                                      | **MANUAL_REVIEW_REQUIRED**, see Known Risks           |
| 1.23: no interactive AI                                                | none                                                                                                                                             | audit (no external requests)                                                                                                                                                                    | PASS                                                  |
| CSP: external hosts must be declared                                   | none are used                                                                                                                                    | audit `external_resources`; e2e "no request outside its own origin"                                                                                                                             | PASS                                                  |
| CSP: the portal's Content-Security-Policy                              | `pixi.js/unsafe-eval` is imported, so Pixi does not need `new Function`; its guarded feature probe is all that remains (audit `no_eval` warning) | Validator: `sdk-dev-proxy --csp` injected its CSP meta tag, which the docs say matches the one the service creates; boot and play produced 0 `securitypolicyviolation` events and 0 page errors | PASS (official proxy)                                 |

## Gameplay Requirements

| Requirement                                                              | Implementation                                                                                                   | Validation                            | Status                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| 1.2 / 1.2.2: playable as a guest, progress kept                          | no login anywhere; player data used without auth                                                                 | e2e (the mock player is unauthorised) | PASS                                            |
| 2.2: controls explained                                                  | menu text for pointer and keyboard                                                                               | e2e, visual in the menu               | PASS                                            |
| 2.4 / 2.8: a mechanic with a difficulty ramp                             | spawn interval and fall speed ramp with score (`catch-game.ts`)                                                  | unit test "gets faster"               | PASS                                            |
| 2.9: more than 10 minutes of content, or replay value                    | a single endless mode with a best score                                                                          | —                                     | **MANUAL_REVIEW_REQUIRED**: a demo, not a title |
| 3.x content: no prohibited topics                                        | stars and a basket                                                                                               | —                                     | MANUAL (low risk)                               |
| 2.3 genre matches the draft category; 2.7 content matches the age rating | chosen in the Console                                                                                            | —                                     | MANUAL                                          |
| 1.24: updates keep the core concept                                      | first version                                                                                                    | —                                     | NOT_APPLICABLE                                  |
| 3.5: copyright                                                           | all graphics are vector shapes drawn in code; all sound is synthesised with WebAudio; no fonts or assets shipped | audit: no external or binary assets   | PASS (MANUAL sign-off)                          |

## UX Requirements

| Requirement                                                                  | Implementation                                                                                                                | Validation                                                              | Status                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1.6.1.8 / 1.6.2.7: no context menu or selection on long press or right click | `contextmenu`/`selectstart`/`dragstart`/`gesturestart` cancelled; `user-select:none`, `-webkit-touch-callout:none`            | e2e dispatches events and checks `defaultPrevented` and computed styles | PASS                                                           |
| 1.10.2: no page scroll or swipe-to-refresh                                   | `overflow:hidden`, `overscroll-behavior:none`, `touch-action:none`, `touchmove` cancelled, arrow and space defaults prevented | e2e "never scrolls the page"                                            | PASS                                                           |
| 1.12: monetization enabled                                                   | ads present in code; the Advertising tab must be on in the Console                                                            | README checklist                                                        | PASS (code) / MANUAL (Console)                                 |
| 1.16: ad units not modified or imitated                                      | only SDK units, no custom ad UI                                                                                               | code review                                                             | PASS                                                           |
| 1.6.1.2: keyboard appears for input fields                                   | the game has no text inputs                                                                                                   | —                                                                       | NOT_APPLICABLE                                                 |
| 1.6.1.7: no WebGL notification on open                                       | PixiJS picks WebGL or WebGPU; no notice shown in any e2e run                                                                  | —                                                                       | MANUAL on devices                                              |
| 1.3: sound stops within 2 s of losing focus                                  | `AudioContext.suspend()` on hidden tab, window blur, portal pause                                                             | e2e: suspended ≤ 2 s after hidden and after `game_api_pause`            | PASS (emulated visibility); real minimise/tab switcher: MANUAL |
| 1.6.1.6 / 1.6.2.5: no system media player                                    | WebAudio only, no `<audio>`/`<video>`                                                                                         | code review                                                             | PASS                                                           |
| 1.6.2.6: no OS-reserved shortcuts                                            | arrows, A/D and P only; Esc dropped because it is the browser's fullscreen-exit key                                           | code review                                                             | PASS                                                           |
| 6.2 sound toggle / 6.3 pause (recommendations)                               | HUD buttons; the sound setting is saved                                                                                       | e2e                                                                     | PASS                                                           |
| 6.9 manual language switch (recommendation)                                  | not implemented                                                                                                               | —                                                                       | NOT IMPLEMENTED (optional recommendation)                      |

## Mobile

| Requirement                                                  | Validation                                                                                     | Status            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------- |
| 1.6.1.5: fully touch-controlled                              | e2e `mobile` (Pixel 5 emulation): tap to play, touch-steer, every button tapped                | PASS (emulated)   |
| 1.8: controls large enough                                   | e2e: every visible button ≥ 44×44 px                                                           | PASS              |
| 1.10 / 1.10.1 / 1.10.3: resize and rotation, nothing cut off | e2e swaps orientation mid-run and while paused; canvas matches viewport; all buttons on screen | PASS (emulated)   |
| 1.6.1.1: fullscreen at launch                                | handled by the portal; the demo does not call `screen.fullscreen`                              | MANUAL on a phone |
| Real iOS Safari / Android Chrome / Yandex app                | —                                                                                              | MANUAL            |

## Desktop

| Requirement                                                 | Validation                                                                                                | Status                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1.6.2.1: fills the available area                           | e2e: canvas = viewport after each resize                                                                  | PASS                                   |
| 1.6.2.2: long side at most 2× the short side                | the playfield is capped at 1.1:1, and the backdrop drawn around it is scene, not black bars (`layout.ts`) | PASS (unit test); portal frame: MANUAL |
| 1.6.2.4: keyboard and mouse, independent of keyboard layout | e2e: mouse steering, `ArrowRight` and `KeyA` by `code`                                                    | PASS                                   |

## Tablet

| Requirement                  | Validation                                                                                                          | Status                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Touch play, layout, rotation | e2e projects `tablet` (iPad gen 7 portrait) and `tablet-landscape`, run in Chromium with an iPad viewport and touch | PASS (emulated); not Safari, not a real iPad: MANUAL |

## Ads

| Requirement                                                                                            | Implementation                                                                                                                        | Validation                                                                    | Status                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| 4.1: SDK ads only                                                                                      | `adv.showFullscreenAdv` / `adv.showRewardedVideo`                                                                                     | audit: no other ad scripts                                                    | PASS                                             |
| 4.4: logical pauses only; within 2 s of the player's action; never mid-run; never before the first run | interstitial only on "Play again", called immediately; local 60 s floor from the Factory profile                                      | unit test and e2e: no ad before the first run, and one after "Play again"     | PASS (mock)                                      |
| 4.7: sound and gameplay paused during ads                                                              | `game.pause("ad")` + GameplayAPI stop + AudioContext suspended before the call                                                        | unit test captures state during the ad; e2e: frames frozen, audio not running | PASS (mock)                                      |
| 4.5 / 4.5.1 / 4.5.2: rewarded is voluntary, labelled, a bonus                                          | "▶ Watch an ad: continue with 1 life", once per run; "Play again" stays free                                                          | e2e                                                                           | PASS                                             |
| Reward only on `onRewarded`                                                                            | `rewarded` is true only when that callback fired                                                                                      | unit and e2e ("skip" → no reward, the player is told)                         | PASS                                             |
| An ad that opens late still pays out, and only one ad is on screen at a time                           | open-timeout 8 s (interstitial) / 20 s (rewarded); a late open takes the ad slot back; a late reward is delivered as `ad:late-reward` | unit tests (adapter and app)                                                  | PASS (fake SDK)                                  |
| An ad fails or has no fill                                                                             | always resolves; the game continues                                                                                                   | unit and e2e                                                                  | PASS                                             |
| 4.2: progress kept if the player clicks the ad                                                         | best score saved before any ad can be requested; pending save flushed on `visibilitychange`/`pagehide`                                | unit test                                                                     | PASS                                             |
| Sticky banner                                                                                          | none in code; a Console switch                                                                                                        | —                                                                             | NOT_APPLICABLE (Console decision)                |
| 4.3: ad orientation matches the game                                                                   | orientation "Any" in the draft                                                                                                        | —                                                                             | MANUAL                                           |
| Real ads, real frequency throttling                                                                    | —                                                                                                                                     | —                                                                             | NOT_TESTABLE_LOCALLY (draft mode shows real ads) |

## Localization

| Requirement                                                    | Implementation                                                                             | Validation                                                             | Status                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| 2.14: language detected from `environment.i18n.lang` at launch | `platform.language` outranks the browser; be/kk/uk/uz fall back to ru, anything else to en | e2e: ru→ru, en→en, kk→ru, tr→en; "follows the portal, not the browser" | PASS                                                  |
| 8.2.3: every declared language fully translated                | `en` and `ru`, 24 keys each                                                                | audit `locale_parity`                                                  | PASS; quality of the Russian: MANUAL (native speaker) |
| Draft "Game translated into" matches the shipped languages     | README "Console draft settings"                                                            | —                                                                      | MANUAL                                                |
| A specific language is mandatory                               | the docs name none; the Factory profile requires `ru`                                      | audit (as Factory policy)                                              | UNKNOWN (Yandex) / PASS (Factory)                     |

## Save / Player

| Requirement                                                                         | Implementation                                                                                                       | Validation                                                                          | Status           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------- |
| 1.9: saved straight after the action; survives reload and rotation; guests included | best score written at game over through `player.setData(…, true)`, mirrored locally; restored before Game Ready      | e2e: game over → clear the local mirror → reload → record restored from player data | PASS (mock)      |
| 1.9: a save still waiting for its write slot when the page reloads                  | revision stamp in both copies; the newer copy wins on attach and a newer local copy is pushed up (review finding F1) | unit test "a newer local save wins…"                                                | PASS             |
| `setData` limits: 200 KB, 100 requests per 5 min (shared with getData)              | size guard; writes coalesced, at least 3.1 s apart; flush on hide                                                    | unit tests                                                                          | PASS             |
| `getPlayer()` fails                                                                 | local saves continue                                                                                                 | unit test; e2e "keeps the record locally"                                           | PASS             |
| 1.11: "cloud save" enabled in the draft                                             | README checklist                                                                                                     | —                                                                                   | MANUAL (Console) |
| 1.2.1 / auth dialog                                                                 | not used                                                                                                             | —                                                                                   | NOT_APPLICABLE   |
| Payments 1.4 / 1.13                                                                 | no purchases (`iap: false`)                                                                                          | —                                                                                   | NOT_APPLICABLE   |

## Metadata

| Item                                                                                                    | Status                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Title (≤ 50 chars, no "free/top/best"), identical in game and draft per language (5.1.3); unique (5.12) | "Starfall Basket" / "Звёздная корзина". Uniqueness: **MANUAL**                 |
| Description and How to play (100–1000 chars each)                                                       | **MANUAL**. The controls text is in the locales; the store copy is not written |
| Icon 512×512, cover 800×470, 16:9 video, ≥ 2 screenshots per platform, ≥ 70 % real gameplay             | **MANUAL**. None are in the repository                                         |
| Age rating, categories                                                                                  | **MANUAL**                                                                     |
| `index.html` `<title>` and viewport meta                                                                | PASS (audit `html_metadata`)                                                   |

## Performance

| Item                                                                                       | Evidence                                                                                                                                                                                | Status                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Archive size                                                                               | 0.54 MB uncompressed, about 0.16 MB zipped                                                                                                                                              | PASS                  |
| Render resolution capped at 2× device pixel ratio (Pixi now matches the Three.js renderer) | `packages/pixi-framework`                                                                                                                                                               | PASS                  |
| Frame rate on real low-end phones (1.15 lag)                                               | Headless software WebGL on the test machine, which was heavily loaded (load average 60–85 on 12 cores from other worktrees), rendered 1–4 fps. That measures the machine, not the game. | **MANUAL** on devices |
| Time to Game Ready                                                                         | Not measured on the portal. The adapter's worst case is about 40 s (four 10 s timeouts), inside the documented 90 s window                                                              | MANUAL (debug panel)  |

## Security / Privacy

| Item                                                                       | Evidence                                                                                                                      | Status                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| No secrets in the bundle                                                   | audit `no_secrets` (AWS, GitHub, Google, Slack, API-key and Yandex OAuth patterns)                                            | PASS                          |
| No external requests, links or redirects (8.4)                             | audit `external_resources`; e2e same-origin check                                                                             | PASS                          |
| No personal data collected; name and photo never read                      | adapter reads only `getData`                                                                                                  | PASS                          |
| `signed: true`                                                             | not used; there is no server                                                                                                  | NOT_APPLICABLE                |
| Read-only probes `window.__wgf__` / `window.__demo__` in the shipped build | template policy: the verify suite measures the build that ships. Not visible to players; lets a console user read their score | MANUAL decision (Reviewer R8) |

## Automated Tests

Everything below was **executed** in this worktree against the uncommitted tree, first by the
main agent and then independently by the Validator. The numbers are from the final runs,
listed under **Claude Review**.

| Suite                                                                                                            | Command                                                                | Result                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Install                                                                                                          | `pnpm install --frozen-lockfile`                                       | pass                                                                                                    |
| Lint                                                                                                             | `pnpm lint`                                                            | pass                                                                                                    |
| Typecheck (packages, template, demo)                                                                             | `pnpm typecheck`                                                       | pass                                                                                                    |
| Format                                                                                                           | `pnpm format`                                                          | pass                                                                                                    |
| Unit + integration (the template; the Yandex adapter; the demo's logic; the demo's flow run on the real adapter) | `pnpm test`                                                            | 127 / 127 pass (final run; the Validator's round 2 saw 126/126 before the L2 test was added)            |
| Template build and template smoke e2e                                                                            | `pnpm build`, `pnpm test:e2e`                                          | pass, 6/6 (Validator)                                                                                   |
| Demo production build                                                                                            | `pnpm demo:yandex:build`                                               | pass                                                                                                    |
| Static audit                                                                                                     | `pnpm demo:yandex:audit`                                               | 20 pass, 4 warnings, 0 errors                                                                           |
| Browser e2e on desktop, mobile, tablet and tablet-landscape (25 tests each)                                      | `pnpm demo:yandex:e2e`                                                 | 97 pass, 3 skipped (the keyboard test on touch devices), 0 fail                                         |
| Archive                                                                                                          | `pnpm demo:yandex:package`                                             | 0.16 MB ZIP, 13 entries, `index.html` at the root, no `.map` files, no non-ASCII names                  |
| Official Yandex tool                                                                                             | `@yandex-games/sdk-dev-proxy` with `--dev-mode=true`, and with `--csp` | boots and plays under Yandex's dev-mode SDK (mocked calls) and the proxy's `--csp` policy; 0 violations |

The four audit warnings all come from PixiJS library code, not game code:

- a `http://www.pixijs.com/` string in the disabled hello banner;
- `console.log` calls in Pixi's debug-only helpers;
- Pixi's guarded `new Function` probe.

None of them fired in any e2e or proxy run.

Two e2e runs failed before the passing ones, and both were fixed.

1. **Test bugs.** A selector matched three elements, because `#ui` also carries `data-screen`. The mock's own `ready()` check was weakened by the same thing, so it now uses `section[data-screen]`.
2. **Timing on the overloaded machine.** A run could end before a pause assertion. Tests now use a non-losing RNG unless they need a game over, and have longer timeouts.

**Known test gap (Reviewer N2, accepted).** These paths have unit tests against a fake SDK but no browser e2e:

- account selection;
- a rewarded ad that opens late;
- a reload within the 3.1 s write window.

## CI Tests

`.github/workflows/yandex-demo.yml` runs unit (adapter and demo), build, static audit,
Playwright e2e on four form factors, and packaging. It uploads the archive and test results.
It triggers on changes to `packages/**`, the example, the audit or archive scripts, or
`src/core/**`. It is **configured but has not run on GitHub**: nothing was pushed.
The existing `ci.yml` also picks up the demo's unit tests through `pnpm test:unit`.

## Claude Review

Two further Claude Code agents ran in Orca terminals **in this same worktree**. They were
started with `orca terminal create --worktree id:<repo>::<this path> --command claude`. No
extra worktree was created.

**Claude Yandex Reviewer.** Before seeing any code, it read the official docs independently
(including `llms-full.txt`) and wrote its own checklist. It did not modify code.

- **Round 1:** 2 FAIL, 5 MISSING, 8 MANUAL, 5 UNKNOWN, 25 VERIFIED.
  - F1: a stale cloud save could win after a reload. Fixed with a revision stamp and reconciliation.
  - F2: a rewarded video that opened late lost its reward. Fixed: late callbacks are honoured, and `ad:late-reward` is delivered.
  - R1: the portal restarts GameplayAPI by itself after resume. **Mitigated**: `stop()` is sent again at 0 ms and 500 ms. Only the 🎮 manual check can confirm it.
  - M1: no flush on hide. Fixed.
  - M2: account-selection events were not handled. Fixed.
  - M3: no `off()`. Fixed with `dispose()`.
  - M4: the draft settings were not documented. Fixed with a README table.
  - M5: raw keys showed if a locale failed to load. Fixed with a bundled English fallback.
  - R3: Esc was bound. Removed.
  - U3: comments made unofficial claims. Corrected.
  - U4: the write interval sat exactly on the rate limit. Raised to 3.1 s.
  - U5: capabilities overclaimed. Fixed.
  - U1: unsafe-eval under CSP. Mitigated, then verified by the Validator.
- **Round 2:** 11 items resolved. New findings:
  - N1: after account selection, the newer local guest copy could overwrite the progress the player chose. **FAIL**, fixed with `attach(player, "cloud")`.
  - N2: no e2e for the new paths. Accepted; unit tests only.
  - N3: this report did not exist yet. Now written.
- **Round 3:** N1 resolved. One LOW finding, L1: a failed re-read after account selection kept the old player. Fixed with `detach()` and a unit test.
  - Report accuracy notes D1–D8, all applied. On D3, the Reviewer said the debug panel has no ▶️ control. The official page lists both ▶️ (pause/resume simulation) and 👁/👀 (focus), so both are in the Manual Checks.
  - **Verdict: "Code: no FAIL remains; no code MISSING remains."** The Reviewer agrees READY_WITH_MANUAL_CHECKS is justified.
- **Round 4**, a final accuracy pass over this report, with 126/126 tests re-run:
  - Code: "no FAIL and no MISSING remain".
  - It withdrew its own D3: the debug panel does have ▶️.
  - One LOW, L2: after a failed re-attach, the next boot could still push the guest copy. Fixed with a stale-mirror marker and a unit test; 127/127 now pass.
  - Three wording overclaims, all corrected here:
    - Yandex's dev-mode proxy is Yandex's own mock SDK, not the production SDK.
    - R1 is mitigated, not fixed.
    - The docs describe `--csp` as matching the service's policy, not as a live copy of it.
  - **Verdict: "Final Status READY_WITH_MANUAL_CHECKS: AGREED."**

**Claude Yandex Validator.** It executed the project itself; it did not only read the code.

- **Round 1:** every check PASSED; the table is in Automated Tests.
  - It ran Yandex's official `@yandex-games/sdk-dev-proxy` 0.0.2 headless.
  - In `--dev-mode=true`, Yandex's dev-mode adapter, which mocks every SDK call, logged the documented call sequence.
  - With `--csp`, the proxy's CSP meta tag (documented as matching the service's) was applied: 0 violations.
  - When the proxy failed to fetch the SDK (a WSL network issue), the game fell back and stayed playable. That confirmed graceful degradation against a real failure.
  - Findings, all non-blocking:
    - **Fixed:** fixed ports plus server reuse are unsafe across parallel worktrees. The demo suite now uses `YANDEX_DEMO_PORT` and never reuses a server.
    - **Recorded:** `window.__demo__` ships in production.
    - **Kept by choice:** the SDK loads dynamically rather than from a static tag. The docs allow both.
    - **Noted, not changed here:** the template's own smoke spec can flake under load. That spec is outside this change.
- **Round 2**, a full re-run on the post-review code:
  - install, lint, typecheck, format, 126/126 unit and integration tests, build, audit (0 errors), and e2e (97 pass, 3 skipped, 0 fail) all PASSED;
  - the ZIP is byte-identical to `dist/`.
  - **Yandex's dev-mode adapter logged the full lifecycle**. It is Yandex's own mock SDK, not the production SDK, the same in dev mode and with `--csp`:

    ```
    on game_api_pause · on game_api_resume · getPlayer() · getData · LoadingAPI.ready()
    GameplayAPI.start()                ← Play
    GameplayAPI.stop()                 ← game over
    showRewardedVideo → onOpen → onRewarded → onClose
    GameplayAPI.start()                ← revived with 1 life
    GameplayAPI.stop()                 ← game over; the revive button is hidden (once per run)
    showFullscreenAdv → onOpen → onClose(wasShown: true)
    GameplayAPI.start()                ← next run
    ```

  - During both ads the audio was `suspended` and the phase was `ad`; audio resumed within 1 s after the ad closed.
  - Each run had 0 page errors, 0 console errors, 0 off-origin requests and 0 CSP violations.
  - Two paths the dev adapter does not exercise:
    - It never fires `game_api_pause`/`game_api_resume` itself, so the `stop()` re-assert was covered only by the mock and unit tests.
    - The probe scored 0, so no `setData` was seen; the save round-trip is covered by the mocked e2e.
  - Both are among the Manual Checks.
  - Its only finding was a Prettier failure on this report's table padding. The report was reformatted, and the re-run passed.

## Manual Checks

Before submitting a title built on this adapter, a person must check each of these:

1. **Draft mode with the debug panel** (`&debug-mode=16`), both "Open draft" and "Open draft with debug panel":
   1. The loader indicator shows `IT`.
   2. The Game Ready indicator turns green only once the menu can be played. Test with the Yandex loading screen left to dismiss itself, and again tapped away early.
   3. The 🎮 indicator is red on the menu, on the pause screen and on game over, and green only during a run.
   4. Switch tabs mid-run and come back: the indicator stays red until "Continue".
   5. The ▶️ pause/resume simulation mutes the game and holds it.
   6. ⚒️ → 👁 "remove focus" mutes the game and holds it; 👀 returns focus, the game stays paused until "Continue", and 🎮 stays red.
   7. The ⚒️ language mocks switch between en and ru, and every string changes.
   8. ☁️ "Clear cloud data" followed by a reload starts from zero without errors.
2. **Real ads:**
   1. Interstitial on "Play again": no sound during it, and the run starts afterwards.
   2. Rewarded continue: the reward arrives, and nothing is granted if the ad is closed early.
   3. The launch ad the portal shows on its own: no sound under it.
3. **Devices:**
   1. An Android phone in Chrome and in the Yandex app.
   2. An iPhone in Safari.
   3. An iPad.
   4. A desktop in Chrome, Firefox and Yandex Browser.
   5. On each, check touch and long-press (no menu), rotation, minimising the app (sound off within 2 s), and the tab switcher.
4. **CSP in draft mode.** The Validator's local `--csp` run showed no violations. Confirm once more on the real draft.
5. **Console draft**, as listed in `examples/yandex-compliance-demo/README.md`: cloud save on; languages exactly en and ru; orientation; the ad settings; How to play; title.
6. **Promo materials:** icon, cover, video and screenshots from real gameplay (5.x, 8.3.x). The title must be unique.
7. **Russian text** reviewed by a native speaker (8.2.1).
8. **Content depth (2.9):** a real title needs more than this demo's single endless mode.

## Known Risks

| Risk                                                                                                                                                                          | Severity                                                                                | Why it is not fixed here                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Requirement 1.20 names iOS 9+ and Android 5+. The build targets ES2020 and PixiJS 8, which need modern browsers.                                                              | High if moderators test old devices. The docs do not say how literally 1.20 is applied. | Supporting iOS 9 would mean a different engine version and transpiling. That is a template decision, not a demo fix. |
| The portal CSP could change after the local `--csp` run                                                                                                                       | Low                                                                                     | That run passed. Draft mode is the final check                                                                       |
| Not verified that the real `game_api_resume` auto-restarts GameplayAPI after a stop the game made _after_ the pause                                                           | Medium                                                                                  | Covered defensively: `stop()` is sent again after resume. The debug panel confirms it                                |
| The launch ad's pause may arrive before `init()` resolves; the docs do not say whether a late subscriber is told                                                              | Low                                                                                     | The first sound needs a user gesture on the menu anyway                                                              |
| Timings measured here come from a heavily loaded machine with software WebGL                                                                                                  | Low (for compliance)                                                                    | Performance must be judged on real devices                                                                           |
| Factory profile values (`interstitial_min_interval_s: 60`, `locales_required: [ru]`, `common_rejections`) are marked `status: unverified` and are not stated in Yandex's docs | Low                                                                                     | These are Factory policy; the report labels them as such                                                             |
| The demo is too small to be accepted as a real title (2.9, 1.15)                                                                                                              | n/a                                                                                     | It is a compliance harness, not a product                                                                            |

## Official Sources

All fetched 2026-09-23.

- Requirements: <https://yandex.com/dev/games/doc/en/concepts/requirements>
  - [1.3](https://yandex.com/dev/games/doc/en/requirements/1/3)
  - [1.9](https://yandex.com/dev/games/doc/en/requirements/1/9)
  - [1.10](https://yandex.com/dev/games/doc/en/requirements/1/10)
  - [1.14](https://yandex.com/dev/games/doc/en/requirements/1/14)
  - [1.19](https://yandex.com/dev/games/doc/en/requirements/1/19)
  - [2.14](https://yandex.com/dev/games/doc/en/requirements/2/14)
  - [4.4](https://yandex.com/dev/games/doc/en/requirements/4/4)
- SDK:
  - [connecting](https://yandex.com/dev/games/doc/en/sdk/sdk-about)
  - [environment](https://yandex.com/dev/games/doc/en/sdk/sdk-environment)
  - [game events (LoadingAPI, GameplayAPI)](https://yandex.com/dev/games/doc/en/sdk/sdk-game-events)
  - [events (pause/resume, account selection)](https://yandex.com/dev/games/doc/en/sdk/sdk-events)
  - [ads](https://yandex.com/dev/games/doc/en/sdk/sdk-adv)
  - [player data](https://yandex.com/dev/games/doc/en/sdk/sdk-player)
  - [device info, fullscreen](https://yandex.com/dev/games/doc/en/sdk/sdk-params)
  - [purchases](https://yandex.com/dev/games/doc/en/sdk/sdk-purchases) (not used)
- Process:
  - [local launch and sdk-dev-proxy](https://yandex.com/dev/games/doc/en/concepts/local-launch)
  - [adding a game](https://yandex.com/dev/games/doc/en/console/add-new-game)
  - [draft fields](https://yandex.com/dev/games/doc/en/console/add-new-game/draft)
  - [debug panel](https://yandex.com/dev/games/doc/en/console/debug-panel)
  - [draft mode](https://yandex.com/dev/games/doc/en/console/draft-mode)
  - [moderation](https://yandex.com/dev/games/doc/en/concepts/moderation)
  - [quick start and common rejections](https://yandex.com/dev/games/doc/en/concepts/quick-start)
  - [languages and domains](https://yandex.com/dev/games/doc/en/concepts/languages-and-domains)

## Final Status

**READY_WITH_MANUAL_CHECKS**

The integration meets every requirement that can be checked in code, against the documented
API, on desktop, phone and tablet emulation. It is not `READY_FOR_PLATFORM_SUBMISSION` for
three reasons:

- The Manual Checks above have not been done: draft mode, the debug panel, real ads, real devices, CSP, and the promo materials.
- 1.20's old-device clause is an open risk.
- The demo itself is a harness, not a title with enough content for 2.9.

It has not been submitted to Yandex, and it is not Yandex-approved.
