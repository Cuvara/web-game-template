# Poki compliance report

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| Subject          | `@wgf/platform-sdk` Poki adapter and `examples/poki-compliance-demo` |
| Branch           | `cuongnd-work/bonnethead`                                            |
| Date             | 2026-09-23                                                           |
| Engine           | PixiJS 8 (2D)                                                        |
| **Final status** | **READY_WITH_MANUAL_CHECKS**                                         |

**This is not a Poki approval.** Poki has not seen this build. The only things verified are
those that could be checked locally. Poki's own steps (Inspector, playtests, Player Fit, Web
Fit and final review) have not run. The demo is a test harness and is not meant to be
submitted as a game.

## How this was established

1. **Docs.** Poki's current documentation was read before any code was written (sources at
   the end).
2. **Implementation.** The main agent wrote the adapter, the lifecycle guard, the demo, the
   audit and the suites.
3. **Independent review.** A separate Claude session in its own Orca terminal ("Claude Poki
   Reviewer") read the docs itself and reviewed the code read-only. It raised 14 items
   (1 UNKNOWN high-risk, 5 FAIL, 3 MISSING, 5 MANUAL) and marked 25 items VERIFIED.
4. **Independent validation.** A second session ("Claude Poki Validator") ran every suite
   and found no failures. It reported one flaky template smoke test, which has since been
   fixed.
5. **Fixes.** Every FAIL was fixed, and the test gaps behind them are now covered (see
   [Claude review](#claude-review)).
6. **Re-run and re-check.** All suites were re-run on the fixed code. The reviewer
   re-checked the fixes twice; the rounds are summarised under [Claude review](#claude-review).

## Requirements matrix

Status key:

- **VERIFIED**: automated evidence, re-run on the final code.
- **MANUAL**: needs a person, a real device or Poki's tools.
- **N/A**: not applicable.

| Requirement                                                                               | Official URL                         | Implementation                                                                                                       | Validation                                                                            | Status                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Load the SDK from Poki's documented URL, in `<head>`                                      | [sdk-html5]                          | `index.html` `<script src=…/v2/poki-sdk.js>`; `loadPokiSdkScript` injects it if absent                               | audit: exactly one SDK URL, no bundled SDK copy; e2e routes that URL                  | VERIFIED                                       |
| `init()`, and load the game anyway on failure                                             | [sdk-html5]                          | `PokiPlatform.#connect`: a rejection continues; a 5 s deadline covers an init that never settles                     | unit: reject, hang, late connect; e2e: blocked, hang, reject                          | VERIFIED                                       |
| `gameLoadingFinished()` after loading, once                                               | [sdk-overview]                       | `signalReady()` → `GameplayLifecycle.loadingFinished()`                                                              | unit; e2e shows `[init, gameLoadingFinished]` before any input                        | VERIFIED                                       |
| `gameplayStart()` on first input, not on load                                             | [requirements]                       | demo: only on Play/Enter/Space, after a break, after a revive; template: `armFirstInput()`                           | e2e idle title shows no gameplayStart; unit `bind.test.ts`                            | VERIFIED                                       |
| No consecutive events; no events during ads                                               | [requirements]                       | `GameplayLifecycle` refuses duplicates, events during an ad, and events before loading                               | unit (8 + 19); the mock referee fails any e2e test with a violation                   | VERIFIED                                       |
| Pause/unpause: stop → commercialBreak → start                                             | [sdk-overview]                       | `pause()` / `resume()` → `session.commercialBreakThen`                                                               | e2e exact call sequence                                                               | VERIFIED                                       |
| Death/restart: stop → commercialBreak → start                                             | [sdk-overview]                       | `die()` / `restart()`                                                                                                | e2e exact call sequence                                                               | VERIFIED                                       |
| Revive: stop → rewardedBreak → start; reward only on success                              | [sdk-overview], [sdk-html5]          | `revive()` grants only when `rewarded === true`                                                                      | e2e reward, no-reward, error and blocked cases                                        | VERIFIED                                       |
| Menu ad needs no stop/start around it                                                     | [sdk-overview]                       | template `withAdBreak` resumes only interrupted gameplay, and still owes the resume when the tab is hidden mid-break | unit `bind.test.ts`                                                                   | VERIFIED                                       |
| Mute audio during ads                                                                     | [sdk-html5], [requirements]          | `GameSession` mutes before the break and in `onStart`; the AudioContext is suspended                                 | e2e snapshot during the ad reads `audio: muted`, then `running` after                 | VERIFIED                                       |
| Disable input during ads, without disabling the ad                                        | [sdk-html5]                          | game nodes are `inert` (not `<body>`); every handler checks `inputEnabled`                                           | e2e: Esc/arrows ignored mid-ad, ad button clickable, `adInert: false`                 | VERIFIED                                       |
| Block Space, arrows and wheel from scrolling the page                                     | [sdk-html5], [requirements]          | `Controls` calls `preventDefault`; CSS sets `overflow`, `overscroll-behavior` and `touch-action`                     | e2e `defaultPrevented`; no scroll overflow                                            | VERIFIED                                       |
| No internal ad timers                                                                     | [requirements]                       | `interstitialMinIntervalS: null`                                                                                     | unit: two breaks in a row both reach the SDK                                          | VERIFIED                                       |
| Rewarded button: not green, 🎬, standard option ≥ it and above it, shown at the same time | [requirements]                       | `.rewarded` purple, smaller, below "Play again"                                                                      | e2e geometry, colour and label                                                        | VERIFIED                                       |
| One video per reward, no double reward                                                    | [requirements]                       | one `rewardedBreak` per revive, one revive per run                                                                   | e2e: offer gone at next death                                                         | VERIFIED                                       |
| Ad blocker: stays playable, no reward, no custom message                                  | [requirements]                       | adapter resolves `not-ready`; demo quietly withdraws the offer; a blocked `<head>` tag is not re-requested           | e2e SDK aborted: play, restart, no "ad block" text, exactly 1 SDK request             | VERIFIED                                       |
| No other ad systems                                                                       | [requirements]                       | none present                                                                                                         | audit third-party-ads rules                                                           | VERIFIED                                       |
| No external requests; assets bundled                                                      | [requirements], [external-resources] | system fonts, WebAudio synth, bundled Pixi                                                                           | e2e: zero off-origin requests; strict-CSP run; audit URL allowlist                    | VERIFIED                                       |
| Incognito: wrap localStorage, stay playable                                               | [requirements]                       | `LocalStorageBackend` guards every call and falls back to memory                                                     | unit (4); e2e: all storage APIs and cookies throw                                     | VERIFIED                                       |
| Save progress, or tell the player it won't persist                                        | [requirements]                       | `save.ts` via `Platform.storage`; notice shown when not persistent                                                   | e2e save → reload → best/runs restored; notice visible in private mode                | VERIFIED                                       |
| 16:9, scale to cover the canvas                                                           | [requirements]                       | world 720 high, width follows aspect ratio (1280×720 at 16:9)                                                        | e2e at 640×360, 836×470, 1031×580, 1280×720, 1920×1080                                | VERIFIED                                       |
| Desktop, mobile and tablet support                                                        | [requirements]                       | touch buttons, pointer drag, keyboard                                                                                | e2e on Desktop Chrome, Pixel 7 and Galaxy Tab S4                                      | VERIFIED (Chromium); MANUAL for iOS Safari     |
| Mobile covers the screen, portrait and landscape                                          | [requirements]                       | `layoutFor` + `ResizeObserver` + `orientationchange`                                                                 | e2e rotation: canvas equals viewport                                                  | VERIFIED                                       |
| Force mobile controls on tablets                                                          | [requirements]                       | `detectScheme`: coarse pointer, or touch without any fine pointer                                                    | e2e tablet shows touch scheme                                                         | VERIFIED                                       |
| ESC/space pause                                                                           | [requirements]                       | Esc/P pause; Space starts from the title                                                                             | e2e Esc pauses                                                                        | VERIFIED                                       |
| Remove splash screens and outgoing links                                                  | [requirements]                       | none; no `<a>` or `window.open`                                                                                      | audit outgoing-link and branding rules                                                | VERIFIED                                       |
| No unrelated platform branding                                                            | [requirements], [working-with-poki]  | demo builds `PokiPlatform` directly so other portals' names are not bundled                                          | audit branding rule: 0 hits                                                           | VERIFIED                                       |
| Clean build: no debug or testing artefacts                                                | [requirements]                       | no source maps, silent adapter, no `debugger`, no `setDebug`                                                         | audit; e2e fails on any console output during play                                    | VERIFIED (see Known risks: HUD `data-*` hooks) |
| Initial download ≤ 5 MB, total ≤ 8 MB                                                     | [web-engine]                         | Pixi only                                                                                                            | audit `auditSize` (initial counts every code chunk): 0.528 MB initial, 0.528 MB total | VERIFIED                                       |
| Loads in under 10 s                                                                       | [requirements]                       | SDK init runs in parallel with loading, 5 s deadline                                                                 | e2e: title < 5 s normally, < 10 s with init hanging                                   | VERIFIED locally; MANUAL on real networks      |
| Content: all ages, no chat, original                                                      | [content-player-safety]              | abstract shapes, no text input                                                                                       | review                                                                                | VERIFIED (demo) / MANUAL (a real title)        |
| Thumbnails, static and animated                                                           | [requirements]                       | none                                                                                                                 | —                                                                                     | MISSING (needed only for a real submission)    |
| Minimal screens before play                                                               | [requirements]                       | one tap-to-play title                                                                                                | —                                                                                     | MANUAL (judgement)                             |
| Privacy policy                                                                            | [requirements]                       | no external links or services, so not triggered                                                                      | —                                                                                     | N/A                                            |
| Web exclusivity                                                                           | [working-with-poki]                  | template also targets other portals                                                                                  | —                                                                                     | MANUAL (business decision per title)           |
| Poki Inspector                                                                            | [inspector]                          | —                                                                                                                    | not run                                                                               | MANUAL_REVIEW_REQUIRED                         |

[requirements]: https://developers.poki.com/guide/requirements-quality
[sdk-html5]: https://developers.poki.com/guide/sdk-html5
[sdk-overview]: https://developers.poki.com/guide/sdk-overview
[external-resources]: https://developers.poki.com/guide/external-resources-policy
[content-player-safety]: https://developers.poki.com/guide/content-player-safety
[inspector]: https://developers.poki.com/guide/inspector
[web-engine]: https://developers.poki.com/guide/web-engine
[working-with-poki]: https://developers.poki.com/guide/working-with-poki

## SDK

- **Loader.** `https://game-cdn.poki.com/scripts/v2/poki-sdk.js` goes in `<head>`, as
  documented. The adapter injects the same URL only when `window.PokiSDK` is absent.
- **Calls.** Only documented methods are used: `init`, `gameLoadingFinished`,
  `gameplayStart`, `gameplayStop`, `commercialBreak(onStart)` and `rewardedBreak(onStart)`.
  Nothing was inferred from the loader's source.
- **Progress.** The current HTML5 docs define no loading-progress call, so
  `reportLoadingProgress` is recorded locally and not sent to Poki.
- **Isolation.** `PokiSDK` appears only in `packages/platform-sdk/src/adapters/poki.ts`. The
  audit's architecture rule fails any other reference.

Architecture:

```
game (examples/poki-compliance-demo/src)
  → Platform interface (@wgf/platform-sdk types)
  → PokiPlatform + GameplayLifecycle
  → window.PokiSDK
```

## Lifecycle

`GameplayLifecycle` (`packages/platform-sdk/src/lifecycle.ts`) is a pure class that holds
Poki's sequencing rules. It does four things:

- sends `gameLoadingFinished` only once, and first
- refuses a duplicate `gameplayStart`/`gameplayStop`
- refuses any event during an ad
- stops running gameplay before a break, and says that it did

It refuses calls silently and keeps a record in `rejectedCalls`.

The mock SDK (`tests/poki/mock-poki-sdk.js`) checks the same rules independently. Any
violation fails the test that caused it.

## Ads

`GameSession` (`examples/poki-compliance-demo/src/session.ts`) is the reference pattern for a
title. For every break it:

- pauses the game with the `"ad"` reason
- takes one mute hold (before the call, and again in `onStart`)
- makes the game's own nodes inert
- releases all of that when the break ends

Ad outcomes covered, each on three devices:

- ad played
- no fill
- SDK error
- rewarded closed early
- SDK blocked
- init rejects
- init hangs

In the ad tests the mock draws its own ad element and waits for a click. That shows the
game does not disable Poki's ad UI.

## Gameplay

Flow: loading → title → playing ⇄ paused → game over → restart or revive. Deaths are made
deterministic in tests by fixing `Math.random`.

## 16:9

The world is 720 units high, and its width follows the aspect ratio: 1280×720 at 16:9. It
covers the canvas edge to edge at every size tested.

## Desktop

The desktop project (1280×720, fine pointer) passes. It covers:

- keyboard movement
- Esc pause
- scroll-key and wheel suppression
- all five of Poki's 16:9 reference sizes

## Mobile

The Pixel 7 project (touch) passes. It covers:

- tapping Play
- hold buttons that move the player
- rotation between portrait and landscape
- audio unlocking on the first tap

## Tablet

The Galaxy Tab S4 project (Chromium, touch) passes. It confirms the touch scheme is forced,
which is Poki's tablet rule. **iPad Safari has not been tested** because only Chromium is
installed.

## Incognito

Simulated by making `localStorage`, `sessionStorage` and `indexedDB` throw `SecurityError`,
and `document.cookie` throw on both read and write. The game boots, plays and restarts, and
shows "Progress will not be saved". Unit tests also cover:

- a `localStorage` getter that throws
- writes that start failing mid-session
- a getter that fails after the initial probe

## External Requests

Three checks:

- **Runtime.** Every e2e test fails if any request leaves the origin other than the SDK URL.
- **CSP.** One test serves the page under `default-src 'self'; script-src 'self'
https://game-cdn.poki.com; connect-src 'self'` (no `unsafe-eval`) and plays a full loop
  with zero CSP violations. A control step proves the policy was actually enforced.
- **Static.** The audit allowlists URLs, each with a reason. The only bundled URLs are the
  SDK and an inert PixiJS banner string.

## Branding

- No logo, splash screen, links or cross-promotion.
- `createPlatform()` would have bundled the names of the other portals (`crazygames`,
  `yandex`, `gamevui`). The demo constructs `PokiPlatform` directly, and the audit now finds
  0 branding hits.

## Ad Block

The e2e test aborts the SDK request with `blockedbyclient`. The game boots with
`data-sdk="unavailable"`, plays, and restarts. The revive offer is withdrawn quietly, with no
reward and no "ad blocked" text.

## Performance

| Measure                                                                   | Result                     | Limit                        |
| ------------------------------------------------------------------------- | -------------------------- | ---------------------------- |
| Initial download (html, plus every code chunk, including dynamic imports) | 0.528 MB                   | 5 MB                         |
| Total download                                                            | 0.528 MB                   | 8 MB                         |
| Title interactive (local)                                                 | under 5 s on every project | —                            |
| Title interactive, SDK init hanging                                       | under 10 s                 | Poki's abandonment threshold |

The template's verify suite (runtime facts) passes. Frame rate has not been measured on
low-end hardware; see Manual checks.

## Content

Abstract shapes. No text entry, no chat, nothing violent or age-sensitive.

## Metadata

Not produced: thumbnails, description, screenshots. These are needed only when a real title
is submitted.

## Build

- `pnpm demo:poki:build`: Vite, `base: "./"`, `sourcemap: false`, `pixi.js/unsafe-eval`
  loaded.
- 11 files, 0.528 MB in total.

## Poki Inspector

**MANUAL_REVIEW_REQUIRED.** Not run.

- `https://inspector.poki.dev` is reachable (HTTP 200, checked by the validator).
- Using it means uploading the build to a third-party service, which has not been approved
  for this task.
- The Poki CLI is not installed and no `auth.json` exists, so nothing was authenticated or
  uploaded.

## Automated Tests

Final run on the fixed code:

| Suite              | Command                | Result                                                         |
| ------------------ | ---------------------- | -------------------------------------------------------------- |
| Lint               | `pnpm lint`            | pass                                                           |
| Typecheck          | `pnpm typecheck`       | pass                                                           |
| Unit + integration | `pnpm test`            | 134 passed (13 files)                                          |
| Poki build         | `pnpm demo:poki:build` | pass                                                           |
| Poki audit         | `pnpm audit:poki`      | PASS: 0 errors, 5 warnings, 3 info                             |
| Poki e2e           | `pnpm test:poki`       | 67 passed, 17 skipped (device-specific), 0 failed              |
| Template build     | `pnpm build`           | pass                                                           |
| Template smoke     | `pnpm test:e2e`        | 6 passed (the previously flaky canvas test now waits for boot) |
| Template verify    | `pnpm test:verify`     | 1 passed                                                       |

All five audit warnings are in PixiJS library code:

- `console.*` calls (4 files' worth). The e2e suite fails on any console output, so these do
  not run in play.
- `new Function` (1). The strict-CSP run proves this is not reached.

## CI

`verify.yml` has a new `poki` job: build the demo, run the audit, then run the three-device
e2e suite. It uploads `build/poki-audit.json` and the Playwright report. Nothing in CI
contacts Poki.

## Claude Review

The independent reviewer's findings and what happened to each:

| #   | Finding                                                                   | Verdict       | Outcome                                                                |
| --- | ------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| 1   | `document.body.inert` could disable Poki's ad UI                          | UNKNOWN, high | Fixed: only game nodes go inert; the mock ad must be clicked to finish |
| 2   | Audit size gate was 150 MB; Poki says 5 MB initial, 8 MB total            | FAIL          | Fixed: `auditSize` plus unit tests                                     |
| 3   | 8 s init deadline ran before loading started                              | FAIL          | Fixed: runs in parallel, 5 s deadline; load-time e2e assertions        |
| 4   | Template `withAdBreak` always started gameplay afterwards and never muted | FAIL          | Fixed, with unit tests                                                 |
| 5   | Template first-input listener was used up while paused                    | FAIL          | Fixed, with a unit test                                                |
| 6   | Template has no ad pattern of its own                                     | MISSING       | Open: `session.ts` is the reference; see Known risks                   |
| 7   | Adapter wrote `console.warn` in production                                | MANUAL        | Fixed: silent by default; e2e fails on console output                  |
| 8   | SDK injected at runtime instead of a `<head>` tag                         | MANUAL        | Fixed: `<head>` tag; audit allows exactly that tag                     |
| 9   | Title screen before play                                                  | MANUAL        | Open (judgement)                                                       |
| 10  | Touchscreen laptops forced into the touch scheme                          | MANUAL        | Fixed: a fine pointer keeps the keyboard scheme                        |
| 11  | Portrait playability; overlap with Poki's pill                            | MANUAL        | Open                                                                   |
| 12  | Thumbnails                                                                | MISSING       | Open (per title)                                                       |
| 13  | iOS / iPad Safari                                                         | MANUAL        | Open                                                                   |
| 14  | Mock could not catch ad-DOM bugs                                          | MISSING       | Fixed (see #1)                                                         |

The re-check is in the section below.

### Re-check rounds

**Round 1.** All 8 fixes were VERIFIED against the code. The reviewer found three new
issues:

- **N1** (template): a tab hidden during a break lost the gameplayStart.
- **N2** (audit): the "initial" size missed chunks loaded by dynamic `import()`, and it
  counted characters instead of bytes.
- **N3**: a blocked SDK was requested twice.

All three were fixed, with unit and e2e tests.

**Round 2.** N1–N3 were VERIFIED. The reviewer found two latent edge cases, neither of which
affects the demo:

- **R1** (template): the owed-resume marker could go stale and send gameplayStart on a menu.
- **R2** (package): an `async` or `defer` SDK tag that was still loading was treated as
  blocked.

Both were fixed with unit tests:

- **R1**: the marker is set only when a break ends while the tab is hidden, and it is cleared
  on every return and at the start of every break.
- **R2**: a non-synchronous tag is waited on, bounded by the init deadline.

These last two fixes were verified by the test suites, not by a third review round.

Open reviewer items, all in Manual Checks or Known Risks: #6, #9, #11, #12, #13, and N4
(the real SDK's ad DOM, which only Poki Inspector can confirm).

## Manual Checks

1. **Poki Inspector.** Upload `examples/poki-compliance-demo/dist` (or a real title's build)
   and play the full loop with the real SDK. Confirm the event log, and that commercial and
   rewarded ads can be completed.
2. **Real SDK.** Every automated run used the mock. Check the real SDK's ad DOM and
   rewarded flow on Poki's test page.
3. **Devices.** iPad Safari, iPhone Safari, a low-end Android phone (frame rate), and a
   desktop with uBlock Origin.
4. **Mobile pill.** On a phone in portrait, check whether Poki's pill overlaps the score or
   the pause button. Use `PokiSDK.movePill` if it does.
5. **Product.** Thumbnails, originality, the title screen, and web exclusivity are
   decisions for each title.

## Known Risks

- **Mock versus real SDK.** Sequencing is proved against a referee built from Poki's
  documentation, not against Poki's runtime.
- **Poki's actual CSP is not published.** The strict-CSP test is a stand-in that is at least
  as strict.
- **HUD `data-*` test hooks ship in the demo.** A title should drop them. The demo is a test
  harness, not a submission.
- **The template's own `src/` has no ad call sites.** A title targeting Poki must follow
  `session.ts` or `withAdBreak`. Nothing yet enforces that a Poki title calls
  `commercialBreak` at all.
- **The Factory's Poki profile disagrees with Poki.** It sets `interstitial_min_interval_s:
120`, which is an internal ad timer and contradicts "Don't implement internal ad timers".
  It sets `max_bundle_mb: 150` against Poki's 5/8 MB. The adapter follows Poki. The profile
  (in the web-game-factory repository, not changed here) should be corrected.
- **Shared ports.** Other worktrees on this machine serve builds on common ports. The Poki
  suite never reuses a server (`POKI_DEMO_PORT`, default 4391).

## Official Sources

All read on 2026-09-23:

- https://developers.poki.com/guide/requirements-quality
- https://developers.poki.com/guide/sdk-html5
- https://developers.poki.com/guide/sdk-overview
- https://developers.poki.com/guide/game-events
- https://developers.poki.com/guide/external-resources-policy
- https://developers.poki.com/guide/content-player-safety
- https://developers.poki.com/guide/inspector
- https://developers.poki.com/guide/how-testing-works
- https://developers.poki.com/guide/working-with-poki
- https://developers.poki.com/guide/final-review
- https://developers.poki.com/guide/web-engine
- https://github.com/poki/poki-cli
- https://app.poki.dev/2024.03.13_Terms_and_Conditions_Poki_for_Developers.pdf (terms,
  found via search; not read in full)

## Final Status

**READY_WITH_MANUAL_CHECKS.** Every requirement that can be checked locally has automated
evidence on the final code. What remains needs Poki's tools, real devices, or product
decisions. None of it has been claimed.
