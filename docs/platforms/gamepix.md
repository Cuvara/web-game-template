# GamePix

`GamePixPlatform` (`packages/platform-sdk/src/adapters/gamepix.ts`) connects a template game
to GamePix's JavaScript SDK through the same `Platform` contract as every other portal. Game
code does not change; the build targets GamePix through `game.config.yaml`
(`{ id: gamepix, profile: gamepix@1.0.1, role: … }`).

Status on this ref (v1.2.2): **implemented; mock-verified in Node and Chromium (PixiJS and
Three.js); the real SDK inside GamePix's frame, its test tool, ads and review are UNVERIFIED**.
No test contacts GamePix, and ads, the test tool and publication need a GamePix account.

The adapter is the one on the template's `main` (added in `20ad76e`), unchanged; 1.2.2 wires
it into the contract-1 build (below) without any contract-2 piece. A game created from
v1.2.1 takes it by applying `git diff v1.2.1 v1.2.2` to its template-owned files (every file
the diff touches is unchanged in such a game) - never by copying the adapter on its own.

## Official documentation audited

Read 2026-10-04, re-read 2026-10-18 (public pages only, no login).

| Source                                                                            | What it defines                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JavaScript SDK reference](https://partners.gamepix.com/sdk/doc/javascript) (JS)  | `<script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js">` as the **first script in `<head>`** - the only step marked Mandatory; global `GamePix`; `loading(0-100)`, `loaded()`, `interstitialAd()`, `rewardAd()` (beta), `lang()`, `localStorage`, `happyMoment()`, `updateScore(n)`, `updateLevel(n)`; the error messages listed below; pause on a hidden tab                                                   |
| [Submission guidelines](https://partners.gamepix.com/guidelines/submission) (SUB) | no external links, no other analytics / ad / social SDKs (GamePix and Xsolla only), relative paths, no `window.alert` / `confirm`, space / arrows / wheel must not scroll the page, resize to the iframe (at least 640x480), both orientations, no "rotate your device" prompt, no quit button; pause on `visibilitychange` (not on blur); audio paused during ads; no ads during gameplay or on a timer; an icon and a cover |
| [Developer program](https://partners.gamepix.com/developers) (DEV)                | dashboard account; "validate your integration with our toolkit"; a game is exclusive to gamepix.com unless "Allow Distribution" is selected (SUB). The revenue share it states changed between the two reads (45% on 2026-10-04, 50% on 2026-10-18)                                                                                                                                                                           |
| [Engine guides](https://partners.gamepix.com/sdk/doc) (Construct 2/3, Godot, ...) | Construct 3: "GamePix will call these triggers when it wants your game to Pause or to Resume", sound muted on pause; Construct 2: `gameAction`/`gameStop`; the "GamePix Test Tool" at `my.gamepix.com/sdk/toolkit`                                                                                                                                                                                                            |

Documented misuse errors, each of which the mock records and every test asserts never happens:
`GAMEPIX_LOADED_NOT_CALLED`, `LOADED_ALREADY_CALLED`, `LOADING_VALUE_IS_NOT_A_NUMBER`,
`INTERSTITIAL_AD_CALLED_TWICE`, `REWARD_AD_CALLED_TWICE`,
`KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING` (also `UPDATE_SCORE_VALUE_IS_NOT_A_NUMBER` and
`UPDATE_LEVEL_VALUE_IS_NOT_A_NUMBER`, for calls the adapter does not make).

## API surface implemented

| `Platform`                 | GamePix                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `initialize()`             | resolves `window.GamePix` (the build's `<head>` tag); inserts the script once only where no tag exists (tests, a dev page) |
| `reportLoadingProgress(f)` | `GamePix.loading(Math.round(f * 100))` - integers, never backwards, not repeated, never after `loaded()`                   |
| `signalReady()`            | `GamePix.loading(100)` if not sent, then `GamePix.loaded()` - exactly once                                                 |
| `gameplayStart/Stop()`     | tracked locally (`usage`); the JS reference has no gameplay call                                                           |
| `showInterstitial()`       | `GamePix.interstitialAd()` → `{ shown: success }`                                                                          |
| `showRewarded()`           | `GamePix.rewardAd()` → `{ shown, rewarded }` only on `success: true`                                                       |
| `storage`                  | `GamePix.localStorage` after `loaded()`, with every save also in the template's local storage (below)                      |
| `language`                 | `GamePix.lang()` when it is one of the 14 documented codes; else `null` (the game follows the browser)                     |
| `getUser()`                | `null` - no accounts are documented                                                                                        |

`happyMoment()`, `updateScore()` and `updateLevel()` exist but have no counterpart in the
`Platform` contract, so they are not exposed.

## Capabilities

| Field                          | Value                  | Why                                                                                                 |
| ------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `ads`                          | interstitial, rewarded | JS; no banner                                                                                       |
| `iap`                          | false                  | none documented                                                                                     |
| `cloudSaves`                   | false                  | `GamePix.localStorage` is browser storage ("third-party browser restrictions may purge data")       |
| `leaderboards`, `achievements` | false                  | none documented                                                                                     |
| `auth`                         | none                   | no accounts                                                                                         |
| `analytics`                    | platform-provided      | SUB forbids other analytics SDKs                                                                    |
| `loadingApi`                   | required               | `loaded()` gates every other call                                                                   |
| `interstitialMinIntervalS`     | null                   | "Not every single interstitialAd() will trigger an ad" - GamePix decides; call at every break       |
| `gameplayStopOnHidden`         | true                   | "When the user switches to a new browser tab, game must pause (including audio)" - the game does it |

## The build, the script and the load order (contract 1)

- `KNOWN_PLATFORM_IDS` (`packages/platform-sdk/src/registry.ts`) lists `gamepix`, and
  `createPlatform("gamepix")` is guarded by the build's `__WGF_PLATFORM__` like every portal
  adapter: a build whose selected platform (`game.config.yaml`'s first `role: required`
  entry, else the first) is not gamepix carries no GamePix code, and a gamepix build carries
  no other portal's (`tests/integration/platform-build.test.ts`).
- `scripts/build/game-config-plugin.ts` puts the documented tag, synchronous, as the first
  script in `<head>` (`injectTo: "head-prepend"`) of a gamepix build only. Its URL literal must
  equal the adapter's `GAMEPIX_SDK_URL` (the same integration test). It is never bundled.
- A game builds one bundle per platform as on any contract-1 template: the Factory's verify
  step writes `build/platforms/gamepix/game.config.json` (gamepix the only, required entry)
  and builds with `WGF_GAME_CONFIG` pointing at it; by hand,
  `WGF_GAME_CONFIG=<that file> pnpm build`. No portal id is needed.
- `sdk:prepare` records the SDK as `html-head`. `collect-facts` reports
  `package.platform_sdk: gamepix` for a gamepix build; the Factory additionally checks the
  package's `index.html` loads the script (`core/reference/portal-sdks.yaml` `loader`).

No GamePix method but `loading()` and `lang()` is called before `loaded()`:

- `lang()` is read in `initialize()`: the reference says to use it "before game loads to set
  language".
- An ad requested before `signalReady()` resolves `not-ready` without touching the SDK.
- Saves made while the game loads go to the template's local storage and are queued; at
  `loaded()` the queue is replayed into `GamePix.localStorage`. After it, every write goes to
  both, and a read prefers GamePix's value and falls back to the local copy. Keys are
  namespaced `<game id>:<key>`.
- `loaded()` throwing (or its promise rejecting) marks the SDK `error`: ads are refused as
  `error` and saves stay local.

## Advertising correctness

- **Pause before the call.** The adapter raises `foreground:lost` before
  `interstitialAd()` / `rewardAd()`, which `bindPlatform` turns into a pause and silence, and
  `foreground:gained` when the promise settles - whether or not an ad played.
- **`ad:start` / `ad:end` only for an ad that played.** GamePix signals no ad start; the
  adapter announces the ad once the SDK resolves `success: true`.
- **One at a time.** A second request while one is pending is `busy`, so the SDK never sees
  `INTERSTITIAL_AD_CALLED_TWICE` / `REWARD_AD_CALLED_TWICE`. A promise that never settles is
  given up on after 60 s (`adTimeoutMs`) and the game resumes.
- **Rewards** only on `success: true`; a reward confirmed after the deadline is owed as
  `ad:late-reward`.
- **No local interval, no timer.** Every break the game signals is passed on; GamePix decides
  whether it shows an ad.

## Degrading

A blocked or missing script (a local run, an ad blocker, a CSP) leaves a plain web game:
`sdkAvailable` false, both ad kinds `not-ready`, saves on the template's local storage, no
throw. A script that arrives after the 5 s init deadline still connects, and is told
`loaded()` if the game is already ready.

## What the real script does that the reference does not say (2026-10-18)

A static read of the public v3 script (126 293 bytes, `Last-Modified` 2026-10-09; obfuscated,
never executed) and of GamePix's engine guides. Everything marked inference is a reading of
obfuscated code, not a fact; nothing here was observed inside GamePix's frame.

- **Pause, resume and sound hooks.** The script carries `pause`, `resume`, `soundOn`,
  `soundOff` slots and an `on`/`addEventListener` registration, and calls them when a trusted
  GamePix parent frame posts `PAUSE`, `RESUME`, `SOUND_OFF`, `SOUND_ON`; with none declared it
  reports `PAUSE_FUNCTION_HAS_NOT_BEEN_DECLARED` (and the resume/sound equivalents). The
  Construct 3 guide documents the pause/resume triggers ("GamePix will call these triggers
  when it wants your game to Pause or to Resume"); the JavaScript reference does not. **The
  adapter registers none of them** (it follows the JavaScript reference). Inside GamePix's
  frame the game would then not follow a pause or mute GamePix asks for; ads are unaffected,
  because the adapter pauses and mutes around its own ad calls.
- **Automatic `loaded()` (inference).** The script appears to call `loaded()` and a game
  start itself unless a window setting opts out; the adapter calls `loaded()` once at
  `signalReady()`. Run off GamePix's frame, the real script raised no warning
  (2026-10-18 port evidence); whether the frame reports `LOADED_ALREADY_CALLED` is unknown.
- **Off-frame simulation (inference).** Outside a GamePix frame the script simulates ads,
  apparently with a browser dialog for rewards; tests must serve the mock, never the real
  script.
- Other members: `gameAction`, `gameStop`, `start`, `ping`, `user`, `lifecycle`, `events`,
  `sadMoment`, `sendScore`, `sendLevel` - not used.

**Before a GamePix submission a person runs the game in GamePix's test tool
(`my.gamepix.com/sdk/toolkit`, behind the dashboard)** and checks: loading and `loaded()`
recorded once, no `*_HAS_NOT_BEEN_DECLARED` / `LOADED_ALREADY_CALLED` reports, a pause and a
mute from GamePix stop the game and its sound, ads pause and silence it, a hidden tab pauses
it. A gap there is fixed in this adapter on the template's `main` first and released, never
patched in one game.

## Publishing (manual; not automated here)

1. Build the gamepix bundle (above) and package it: `pnpm release:package --platform gamepix`
   with the same `WGF_GAME_CONFIG`.
2. Upload the zip in the GamePix dashboard (a person, logged in; nothing here logs in).
3. Choose exclusivity: gamepix.com only by default; "Allow Distribution" is a person's
   decision at submission.
4. Provide the icon and cover; their sizes are behind the dashboard login.

## Profile

`config/platforms/gamepix.yaml` is a byte-identical copy of the Factory's
`core/reference/platforms/gamepix.yaml` at `1.0.1` (`status: unverified`, `null` where GamePix
does not say). It is not in `pinned.json`: the scaffold targets `generic-web`, and the Factory
vendors (and hashes) the profile a title pins when it creates the game.

## Test evidence (this ref)

| Suite                                                              | What                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/gamepix.test.ts`                                       | every adapter branch against `tests/gamepix/mock-sdk.ts`: load order, loading values, ads, deadlines, concurrency, saves, language, the default loader on a fake DOM |
| `tests/sdk/conformance.test.ts`, `tests/unit/sdk-contract.test.ts` | the cross-portal scenarios                                                                                                                                           |
| `tests/sdk-matrix/` (`pnpm test:sdk:matrix`)                       | PixiJS and Three.js × GamePix, real renderer and `bindPlatform`, SDK ok / missing / failing                                                                          |
| `tests/sdk-browser/platforms.spec.ts` (`pnpm test:sdk:browser`)    | the template build for GamePix: the `<head>` script runs first, `loading` then one `loaded()`, no misuse, hidden-tab pause; boots with the script blocked            |
| `tests/integration/platform-build.test.ts`                         | the gamepix build carries GamePix's signature and no other portal's; the tag is first in `<head>`, synchronous, at the adapter's URL, and in no other build's page   |
| `tests/unit/poki-audit.test.mjs`                                   | the Poki source audit treats `GamePix.localStorage` (the portal's API) as no browser-storage finding, and still flags a bare `localStorage` in the adapter           |

A mock pass is not a live pass: the mock implements the documented surface only.

## Known limitations

- **Nothing live.** The real SDK inside GamePix's frame, its test tool, ads and review are
  UNVERIFIED (above).
- **Undocumented hooks not registered** (pause / resume / sound; above).
- **`onStart` after the ad.** GamePix has no start event.
- **Undocumented:** bundle size limit, listing sizes, review time, ad-blocker behaviour.
- **Game rules the adapter cannot enforce** (SUB): no external links, no `window.alert` /
  `confirm`, no rotate prompt or quit button, resize to the iframe. These are the game's;
  `package.external_links` is asserted by the profile. Page scrolling is already held by the
  template: `index.html` hides overflow and `@wgf/game-core`'s `Input` prevents the default for
  bound space and arrow keys; a game that reads the wheel must prevent it too.
- The template's own `tests/e2e` and `tests/verify` suites, like every portal's at this ref,
  load the build's portal SDK from the network; on a gamepix build that is GamePix's live
  script. Serve `tests/gamepix/mock-sdk.ts` (`MOCK_SDK_SOURCE`) for
  `https://integration.gamepix.com/sdk/v3/gamepix.sdk.js` in a game's e2e before relying on it.
