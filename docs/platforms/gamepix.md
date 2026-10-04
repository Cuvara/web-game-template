# GamePix

`GamePixPlatform` (`packages/platform-sdk/src/adapters/gamepix.ts`) connects a template game
to GamePix's JavaScript SDK through the same `Platform` contract as every other portal. Game
code does not change; the build targets GamePix through `game.config.yaml`.

Status on this ref: **implemented; mock-verified in Node and Chromium (PixiJS and Three.js);
live SDK load, ads and review UNVERIFIED** (no request is made to GamePix by any test, and
ads, review and publication need a GamePix account).

## Official documentation audited (2026-10-04)

| Source                                                                            | What it defines                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JavaScript SDK reference](https://partners.gamepix.com/sdk/doc/javascript) (JS)  | `<script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js">` as the **first script in `<head>`** — the only step marked Mandatory; global `GamePix`; `loading(0-100)`, `loaded()`, `interstitialAd()`, `rewardAd()` (beta), `lang()`, `localStorage`, `happyMoment()`, `updateScore(n)`, `updateLevel(n)`; the error messages listed below; pause on a hidden tab |
| [Submission guidelines](https://partners.gamepix.com/guidelines/submission) (SUB) | no external links, no other analytics / ad / social SDKs, relative paths, no `window.alert` / `confirm`, space / arrows / wheel must not scroll the page, resize to the iframe (at least 640x480), both orientations, no "rotate your device" prompt, no quit button; no ads during gameplay or on a timer; an icon and a cover                                             |
| [Developer program](https://partners.gamepix.com/developers) (DEV)                | dashboard account, 45% revenue share; a game is **exclusive to gamepix.com unless "Allow Distribution" is selected**                                                                                                                                                                                                                                                        |

Documented misuse errors, each of which the mock records and every test asserts never happens:
`GAMEPIX_LOADED_NOT_CALLED`, `LOADED_ALREADY_CALLED`, `LOADING_VALUE_IS_NOT_A_NUMBER`,
`INTERSTITIAL_AD_CALLED_TWICE`, `REWARD_AD_CALLED_TWICE`,
`KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING` (also `UPDATE_SCORE_VALUE_IS_NOT_A_NUMBER` and
`UPDATE_LEVEL_VALUE_IS_NOT_A_NUMBER`, for calls the adapter does not make).

The Unity guide (`partners.gamepix.com/sdk/doc/unity-plugin`) names a `GamePix.lifecycle.*`
gameplay API. The JavaScript page does not, so the adapter does not call it.

## API surface implemented

| `Platform`                 | GamePix                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `initialize()`             | resolves `window.GamePix` (the build's `<head>` tag); inserts the script once only where no tag exists (tests, a dev page) |
| `reportLoadingProgress(f)` | `GamePix.loading(Math.round(f * 100))` — integers, never backwards, not repeated, never after `loaded()`                   |
| `signalReady()`            | `GamePix.loading(100)` if not sent, then `GamePix.loaded()` — exactly once                                                 |
| `gameplayStart/Stop()`     | tracked locally (`usage`); the JS SDK has no gameplay call                                                                 |
| `showInterstitial()`       | `GamePix.interstitialAd()` → `{ shown: success }`                                                                          |
| `showRewarded()`           | `GamePix.rewardAd()` → `{ shown, rewarded }` only on `success: true`                                                       |
| `storage`                  | `GamePix.localStorage` after `loaded()`, with every save also in the template's local storage (below)                      |
| `language`                 | `GamePix.lang()` when it is one of the 14 documented codes; else `null` (the game follows the browser)                     |
| `getUser()`                | `null` — no accounts are documented                                                                                        |

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
| `interstitialMinIntervalS`     | null                   | "Not every single interstitialAd() will trigger an ad" — GamePix decides; call at every break       |
| `gameplayStopOnHidden`         | true                   | "When the user switches to a new browser tab, game must pause (including audio)" — the game does it |

## The script and the load order

The build for a `gamepix` target puts the documented tag, synchronous, as the first script in
`<head>` (`scripts/build/game-config-plugin.ts`, `injectTo: "head-prepend"`), and no other
build carries it — `package.platform_sdk` reads `gamepix` from that tag
(`sdk-signatures.json`: `integration.gamepix.com`). It is never bundled.
`tests/integration/platform-builds.test.ts` checks the tag is the first script, without
`async`/`defer`, at the adapter's URL.

No GamePix method but `loading()` and `lang()` is called before `loaded()`:

- `lang()` is read in `initialize()`: the reference says to use it "before game loads to set
  language". A reviewer should note this is the one call made before `loaded()` other than
  `loading()`.
- An ad requested before `signalReady()` resolves `not-ready` without touching the SDK.
- Saves made while the game loads go to the template's local storage and are queued; at
  `loaded()` the queue is replayed into `GamePix.localStorage`. After it, every write goes to
  both, and a read prefers GamePix's value and falls back to the local copy. Values are
  strings, as `PlatformStorage`'s are. Keys are namespaced `<game id>:<key>`.
- `loaded()` throwing (or its promise rejecting) marks the SDK `error`: ads are refused as
  `error` and saves stay local.

## Advertising correctness

- **Pause before the call.** GamePix: pause the game before `interstitialAd()` / `rewardAd()`
  and resume in the callback. The adapter raises `foreground:lost` before calling, which
  `bindPlatform` turns into a pause and silence, and `foreground:gained` when the promise
  settles — whether or not an ad played. A game that uses the seam (`withAdBreak`, the
  gameplay moments) is also paused and muted by the break itself.
- **`ad:start` / `ad:end` only for an ad that played.** GamePix signals no ad start. The
  adapter announces the ad (`ad:start`, the `onStart` hook, `ad:end`) once the SDK resolves
  `success: true`, so an unfilled request announces nothing, as on every other portal. The
  hook therefore runs after the ad, not when it begins; the game was already paused and silent
  for all of it.
- **One at a time.** A second request while one is pending is `busy`, so the SDK never sees
  `INTERSTITIAL_AD_CALLED_TWICE` / `REWARD_AD_CALLED_TWICE`. A promise that never settles is
  given up on after 60 s (`adTimeoutMs`) and the game resumes; the same ad kind stays `busy`
  until GamePix's own promise settles, because calling it again would be the documented error.
- **Rewards** only on `success: true`. A reward confirmed after the deadline is owed as
  `ad:late-reward`.
- **No local interval, no timer.** Every break the game signals is passed on; GamePix decides
  whether it shows an ad. The adapter never requests an ad on its own.
- No ads during gameplay: placements belong at natural breaks
  (`src/platform/integration-plan.ts`, which the Factory generates).

## Degrading

A blocked or missing script (a local run, an ad blocker, a CSP) leaves a plain web game:
`sdkAvailable` false, `sdkState` `unavailable`, both ad kinds `not-ready` and `adAvailability`
`disabled`, saves on the template's local storage, no throw. A script that arrives after the
5 s init deadline still connects, and is told `loaded()` if the game is already ready.

## Publishing (manual; not automated here)

1. Build: `WGF_TARGET_PLATFORM=gamepix pnpm build`, or `pnpm build:platforms` with a `gamepix`
   entry in `platforms[]` (no portal id is needed).
2. Upload the zip from `pnpm release:package` in the GamePix dashboard.
3. Choose exclusivity: the default is gamepix.com only; "Allow Distribution" is a person's
   decision at submission (DEV, SUB).
4. Provide the icon and cover; their sizes are behind the dashboard login.

## Proposed profile

`config/platforms/gamepix.yaml` is a **proposal** in the Factory's platform-profile schema
(validated against `core/artifacts/shared/platform-profile.schema.json`): status
`unverified`, every figure cited, `null` where GamePix does not say (bundle size, listing
sizes, review time). It is not in `pinned.json` and carries no hash: upstreaming it to
`core/reference/platforms/gamepix.yaml` is a Factory change.

## Test evidence (this ref)

| Suite                                                              | What                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/gamepix.test.ts`                                       | every adapter branch against `tests/gamepix/mock-sdk.ts`: load order, loading values, ads, deadlines, concurrency, saves, language, the default loader on a fake DOM |
| `tests/sdk/conformance.test.ts`, `tests/unit/sdk-contract.test.ts` | the cross-portal scenarios                                                                                                                                           |
| `tests/sdk-matrix/` (`pnpm test:sdk:matrix`)                       | PixiJS and Three.js × GamePix, real renderer and `bindPlatform`, SDK ok / missing / failing                                                                          |
| `tests/sdk-browser/platforms.spec.ts` (`pnpm test:sdk:browser`)    | the template build for GamePix: the `<head>` script runs first, `loading` then one `loaded()`, no misuse, hidden-tab pause; boots with the script blocked            |
| `tests/integration/platform-builds.test.ts`                        | the gamepix build carries GamePix's signature and no other portal's, and the tag first in `<head>`                                                                   |

## Known limitations

- **Nothing live.** No test contacts GamePix; the live SDK's behaviour (does `loaded()`
  return a promise, what `lang()` returns off-portal, ad-blocker behaviour) is UNVERIFIED.
- **`onStart` after the ad.** GamePix has no start event (above).
- **Undocumented:** bundle size limit, listing sizes, review time, ad-blocker behaviour.
- **The Unity `lifecycle` API** is not on the JavaScript page and is not used.
- **Game rules the adapter cannot enforce** (SUB): no external links, no `window.alert` /
  `confirm`, no rotate prompt or quit button, resize to the iframe. These are the game's;
  `package.external_links` is asserted by the proposed profile. Page scrolling is already
  held by the template: `index.html` hides overflow and `@wgf/game-core`'s `Input` prevents
  the default for bound space and arrow keys; a game that reads the wheel must prevent it too.
