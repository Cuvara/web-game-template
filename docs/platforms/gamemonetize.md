# GameMonetize

`GameMonetizePlatform` (`packages/platform-sdk/src/adapters/gamemonetize.ts`) connects a
template game to GameMonetize's HTML5 SDK through the same `Platform` contract as every other
portal. Game code does not change; the build targets GameMonetize through `game.config.yaml`.

Status on this ref: **implemented; mock-verified in Node and Chromium (PixiJS and Three.js);
live SDK load PASS; ads, Verify Game and activation BLOCKED** (they need a GameMonetize account
and an uploaded build).

## Official documentation audited (2026-09-24)

GameMonetize's documentation is short. Everything below is all of it:

| Source                                                                                                                                  | What it defines                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [gamemonetize.com/sdk](https://gamemonetize.com/sdk) ("Last Update: February 2026")                                                     | SDKs for HTML5/JS, Construct 2/3, Unity; Game ID from Dashboard > My games; **"Verify Game"** confirms the integration; then **activation**, reviewed by a content manager; income only for games uploaded to gamemonetize.com                                                                    |
| [GameMonetize.com-SDK README](https://github.com/MonetizeGame/GameMonetize.com-SDK) (the page's HTML5 "Docs" link; last commit 2025-03) | `window.SDK_OPTIONS = { gameId, onEvent }`, the script `https://api.gamemonetize.com/sdk.js` with id `gamemonetize-sdk`, events `SDK_GAME_PAUSE` / `SDK_GAME_START` / `SDK_READY`, `sdk.showBanner()`, mandatory pause **and mute** on `SDK_GAME_PAUSE`, zip upload with `index.html` at the root |
| `HTML5_Games_SDK_GameMonetize.txt` (the page's "Other platforms" download)                                                              | the same snippet plus **`SDK_ERROR`**; call `showBanner()` on "play button", "continue game", "new level", level complete — "as often as you want"                                                                                                                                                |
| Construct 2 / 3 and Unity READMEs and plugin sources (same page)                                                                        | read only to confirm the HTML5 surface: they wrap exactly `SDK_OPTIONS`, the four events and `showBanner()`. Construct 2 passes `advertisementSettings: { autoplay: false }`; Unity's readme: **"First ADS must show on button PLAY and not on loading game"**                                    |
| [gamemonetize.com/faq](https://gamemonetize.com/faq), [/developers](https://gamemonetize.com/developers)                                | business terms only (45% share, Net30, external links allowed); nothing technical                                                                                                                                                                                                                 |

Re-audited 2026-09-24 (second pass): the README, the SDK page, its downloads and the live
`sdk.js` were unchanged (same content, same script hash).

The live SDK script (`api.gamemonetize.com/sdk.js`, obfuscated) was read only to size
timeouts and pick test scenarios where the documentation is silent — never to add API. What it
does:

| Situation                                                   | Live SDK behaviour                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| start-up                                                    | one instance, built from `SDK_OPTIONS` when the script runs; `SDK_READY` when its game data and ad loader are ready        |
| start-up fails                                              | `SDK_ERROR` ("The SDK failed.") — the **only** place it raises `SDK_ERROR`                                                 |
| ad plays                                                    | `SDK_GAME_PAUSE` … `SDK_GAME_START`                                                                                        |
| ad fails or is cancelled                                    | `AD_CANCELED` → `SDK_GAME_START` ("Advertisement error, no worries, start / resume the game"), with or without a pause     |
| `showBanner()` too soon after the last ad                   | `SDK_GAME_START` alone ("Just resume the game…") — 30 s off GameMonetize's domains, 130 s on them                          |
| slow ad                                                     | the SDK cancels it after 12 s, or 8 s after it loaded → `SDK_GAME_START`                                                   |
| `advertisementSettings.autoplay` true, with preroll         | a "Play Game" splash that raises `SDK_GAME_PAUSE` and waits for a click. The adapter passes `autoplay: false`              |
| an ad completes                                             | posts `{ type: "SDK_IMPLEMENTED" }` to the parent frame — probably what "Verify Game" looks for (inferred, not documented) |
| other events (`AD_*`, `SDK_GAME_DATA_READY`, `SDK_BLOCKED`) | undocumented; the adapter ignores them                                                                                     |

## API surface implemented

| Documented                                   | Adapter                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `window.SDK_OPTIONS = { gameId, onEvent }`   | set by `loadGameMonetizeSdk()` before the script is inserted, with `advertisementSettings: { autoplay: false }`          |
| `<script id="gamemonetize-sdk" src=…sdk.js>` | inserted once, at runtime, only by this adapter; a blocked script resolves to "no SDK"                                   |
| `SDK_READY`                                  | `sdkState` → `ready`; `adAvailability("interstitial")` → `available`. Also accepted late (after the init deadline)       |
| `SDK_ERROR`                                  | before ready: `sdkState` → `error`, ads refused as `error`. During an unstarted ad: that ad resolves `error`             |
| `SDK_GAME_PAUSE`                             | during a request: `foreground:lost`, `ad:start`, `hooks.onStart`. Unrequested (preroll, late ad): `foreground:lost` only |
| `SDK_GAME_START`                             | ends the ad: `ad:end`, `foreground:gained`, request resolves `{ shown: true }`. Before any pause: no fill, `not-ready`   |
| `sdk.showBanner()`                           | `showInterstitial()`                                                                                                     |

## Capabilities

```ts
GAMEMONETIZE_CAPABILITIES = {
  ads: ["interstitial"], // showBanner() — a full-screen video ad, despite the name
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "self-hosted",
  loadingApi: "none", // no loading call is documented
  interstitialMinIntervalS: null, // "as often as you want"; the SDK rejects premature calls
  gameplayStopOnHidden: true, // no portal visibility handling is documented
};
```

### Unsupported — clear results, never invented

| Capability                   | Result                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewarded ads                 | `showRewarded()` → `{ shown: false, rewarded: false, reason: "unsupported" }`, without calling the SDK. `adAvailability("rewarded")` → `unsupported`. `pnpm sdk:prepare` fails a title that declares rewarded. |
| Banner (in-game)             | `adAvailability("banner")` → `unsupported`                                                                                                                                                                     |
| Loading / gameplay reporting | recorded locally in `usage` (release validation reads it); nothing is sent to the SDK                                                                                                                          |
| Language, user, cloud saves  | `language: null`, `getUser()` → `null`, local storage                                                                                                                                                          |
| Portal mute setting          | none documented; `settings.muteAudio` is always `false`                                                                                                                                                        |

## Initialization and the Game ID

The Game ID comes from the GameMonetize dashboard: Game Management > My games > the game. It
is public (it ships in the bundle, as the documented snippet puts it in `index.html`) but per
title, so **the template never carries one**, and the tests use placeholders
(`test0000…`, `matrix000…`, `smoke000…`).

Set it on the platform entry:

```yaml
platforms:
  - { id: gamemonetize, profile: gamemonetize@1.0.0, role: required, game_id: <your Game ID> }
monetization:
  ad_kinds: [interstitial]
```

or leave it out of the file and supply it at build time — the release job's route, which
keeps it out of the repository:

```bash
WGF_GAMEMONETIZE_GAME_ID=<your Game ID> pnpm build
```

The environment variable wins over the file, and both are validated identically at build time
(`src/core/game-config.ts`): 8–64 letters, digits, `-` or `_`, and not the documented
placeholder `your_game_id_here`. A malformed ID fails the build. `game_id` on any other
platform fails the build too.

| Condition                         | Behaviour                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Game ID configured                | SDK loaded at `initialize()`, which waits up to 5 s for `SDK_READY`                                                                                                                                          |
| Game ID missing                   | **build fails** (with `WGF_ALLOW_UNCONFIGURED_PORTAL=1`: builds, `portal_configured: false`, not releasable); `sdk:prepare` exits 1; at runtime the SDK is **never requested**, `sdkState: "not-configured"` |
| Game ID malformed (at runtime)    | same as missing; `configProblem` says why (`createPlatform` is also reachable without the build-time check)                                                                                                  |
| SDK delayed                       | `initialize()` returns at the 5 s deadline (`sdkState: "unavailable"`); a later `SDK_READY` makes ads available                                                                                              |
| SDK unavailable (blocked/offline) | `sdkState: "unavailable"`, ads refused `not-ready`, game plays                                                                                                                                               |
| Initialization failure            | `SDK_ERROR` before ready → `sdkState: "error"`, ads refused `error`; the loader throwing → `unavailable`. A later `SDK_READY` recovers either way                                                            |
| SDK already loaded by other code  | refused at once, its `SDK_OPTIONS` untouched: the SDK read its options once, so this adapter's events could never arrive. Do not paste the documented snippet into `index.html` — the adapter owns it        |

## Advertising correctness

The adapter guarantees, whatever the SDK does (all proved in `tests/unit/gamemonetize.test.ts`
and in Chromium in `tests/sdk-matrix/gamemonetize.spec.ts`):

| Case                                   | Result                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ad plays                               | `{ shown: true }`; exactly one `foreground:lost, ad:start, ad:end, foreground:gained`; `onStart` once                                 |
| ad unavailable (`SDK_GAME_START` only) | `{ shown: false, reason: "not-ready" }`, no ad events                                                                                 |
| call too soon (SDK cooldown)           | the SDK answers `SDK_GAME_START` alone → `not-ready`, no ad events, game resumes                                                      |
| ad error (as the live SDK reports it)  | before it showed: `SDK_GAME_START` alone → `not-ready`; while on screen: the bracket closes on `SDK_GAME_START`, `{ shown: true }`    |
| `SDK_ERROR` during a request           | not raised by the live SDK, but allowed by the docs: before start → `reason: "error"`; after start → closes on `SDK_GAME_START`       |
| `showBanner()` throws                  | `reason: "error"`                                                                                                                     |
| callback never arrives                 | resolves `not-ready` after `adStartTimeoutMs` (25 s — past the SDK's own 12 s + 8 s cancel, so its answer normally comes first)       |
| pause without resume                   | the ad ends at `adTimeoutMs` (60 s; GameMonetize's own overlay closes at 31 s): `{ shown: true }`, foreground and sound handed back   |
| callback arrives late                  | inside 25 s it is the request's ad. After: treated as the portal holding the screen — paused and muted until `SDK_GAME_START` or 60 s |
| callback arrives twice                 | the second pause/start is ignored: one resolution, one bracket                                                                        |
| reward / duplicate reward / late one   | impossible: no rewarded path exists; no SDK event reaches `showRewarded()`                                                            |
| resume after failed ad                 | `withAdBreak` resumes, unmutes and restores gameplay                                                                                  |
| repeated requests                      | one at a time: a concurrent second request is `busy`, never queued; sequential ones each reach the SDK, which refuses premature ones  |
| ad while a portal ad holds the screen  | `busy`                                                                                                                                |

Nothing is ever double-resolved: a request resolves through one function that clears itself
first; every timer is cleared when the request settles.

## Lifecycle seam

No game code changes. `src/main.ts` passes the entry's `game_id` as `portalGameId`
(`platformOptions(targetPlatform())`) to `createTargetPlatform`, which constructs
`GameMonetizePlatform` for a `gamemonetize` build; `bindPlatform` maps `ad:start`/`ad:end` and
`foreground:lost`/`foreground:gained` to the game's `ad` and `platform` pause reasons and to
silence. This is exactly GameMonetize's mandatory setting 2 and 3: pause **and** mute on
`SDK_GAME_PAUSE`, resume on `SDK_GAME_START`. Game code calls `context.integration.interstitial(<placement id>)` (or
`context.gameplay.naturalBreak(moment)`) on the documented moments — play button, continue,
new level, level complete — never during loading; the Factory's integration plan maps the
placement to the interstitial.

## Publishing and verification (manual; not automated here)

1. Dashboard > My games > **Add game**; copy its **Game ID**.
2. Place at least one interstitial in the game — `context.integration.interstitial(<placement id>)`
   on the Play button, continue, new level or level complete.
   GameMonetize makes it mandatory ("you must call sdk.showBanner()"), and the untouched
   template places none: its boot scene has no ad. "Verify Game" most likely needs one ad to
   complete (the SDK reports `SDK_IMPLEMENTED` to the portal then — inferred from `sdk.js`).
3. Build with the ID (`game_id` or `WGF_GAMEMONETIZE_GAME_ID`) and `ad_kinds: [interstitial]`;
   `pnpm sdk:prepare` must exit 0 — it fails a missing Game ID, declared rewarded ads, or no
   declared interstitial.
4. `pnpm build:platforms && pnpm release:package --release r<n>` →
   `release/r<n>/gamemonetize.zip`, `index.html` at the
   root, no source maps — the upload format GameMonetize documents.
5. Upload it: Game Management > My games > the game > drop the zip.
6. **Verify Game** in the dashboard — GameMonetize's check that the SDK is integrated.
7. **REQUEST ACTIVATION** — reviewed by GameMonetize's content manager.
8. Self-hosting a GameMonetize-monetized game is by arrangement only (info@gamemonetize.com).

No GameMonetize API exists for upload or verification, so none of this is scripted, and no
credential is used anywhere in this repository.

## Local development

```bash
pnpm vitest run tests/unit/gamemonetize.test.ts              # adapter, adversarial cases
pnpm test:sdk                                                 # conformance incl. gamemonetize
pnpm test:sdk:matrix                                          # Chromium: PixiJS/Three.js × every portal,
                                                              #   + gamemonetize.html (real script loader)
pnpm test:sdk:browser                                         # template build per engine, mocked sdk.js
WGF_LIVE=1 pnpm exec playwright test -c tests/live/live.config.ts gamemonetize   # real SDK load
```

To run the template against GameMonetize by hand, point a copy of `game.config.yaml` at it
(`WGF_GAME_CONFIG=<copy> WGF_GAMEMONETIZE_GAME_ID=<id> pnpm dev`). Off the portal the real SDK
loads and raises `SDK_READY`; whether it fills an ad on localhost is GameMonetize's decision.

## Test evidence (this ref)

| Suite                                                                | GameMonetize result                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/gamemonetize.test.ts`                                    | 62 tests: config, boot, the default script loader (fake DOM), every ad case above, rewarded refusal, pause/resume with a real `Game` and `bindPlatform` |
| `tests/sdk/conformance.test.ts` (`pnpm test:sdk`)                    | every applicable scenario; rewarded scenarios assert `unsupported`; gameplay asserts nothing is sent to the SDK                                         |
| `tests/unit/sdk-contract.test.ts`, `sdk-integration.test.ts`         | the cross-portal contract; `sdk:prepare` source, unserved rewarded, missing Game ID, Game ID never in the artifacts                                     |
| `tests/sdk-matrix/matrix.spec.ts` (Chromium desktop + Pixel 7)       | PixiJS and Three.js × GameMonetize: boot, first-input gameplay, ad break, hidden tab, no fill, SDK missing/failing                                      |
| `tests/sdk-matrix/gamemonetize.spec.ts` (Chromium desktop + Pixel 7) | 25 per device, through the real script loader: all adversarial cases, PixiJS and Three.js                                                               |
| `tests/sdk-browser/platforms.spec.ts` (`pnpm test:sdk:browser`)      | the template game built for GameMonetize, both engines: init with the Game ID, portal pause, blocked SDK, no Game ID                                    |
| `tests/live/gamemonetize/live.spec.ts`                               | live SDK load PASS — see below                                                                                                                          |

## Live verification

**MOCK PASS ≠ LIVE PASS.**

| Layer                                              | Status      | Evidence                                                                                         |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| real `sdk.js` reachable, `window.sdk.showBanner`   | **PASS**    | `docs/audits/live/gamemonetize/sdk-load.json` (2026-09-24, Chromium, placeholder Game ID)        |
| `SDK_READY` off-portal                             | observed    | raised within 8 s **with a placeholder ID** — so `SDK_READY` does not prove the Game ID is valid |
| ad fill, `SDK_GAME_PAUSE`/`START` around a real ad | **BLOCKED** | needs a real Game ID and GameMonetize's ad server; the live probe never calls `showBanner()`     |
| Verify Game                                        | **BLOCKED** | dashboard, against an uploaded build — needs a GameMonetize account                              |
| Activation                                         | **BLOCKED** | GameMonetize's content-manager review                                                            |

## Known limitations

- **Profile unverified.** The Factory carries a core profile `gamemonetize@1.0.0`
  (`status: unverified`), vendored into a game's `config/platforms/` by Factory `init`; the
  template itself has no `config/platforms/gamemonetize.yaml`, so `pnpm assert --platform
gamemonetize` exits 2 here. Values the adapter implies for a profile: `ads: [interstitial]`, `rewarded_available: false`,
  `banner_available: false`, `loading_api: none`, `interstitial_min_interval_s: null`,
  `cloud_saves: false`, `auth: none`, upload = zip with `index.html` at the root, review =
  Verify Game + activation.
- **`SDK_READY` ≠ valid Game ID.** The live SDK raises it for a placeholder. Only Verify Game
  proves the ID.
- **`autoplay: false`** is taken from GameMonetize's own Construct 2 plugin, not the HTML5
  README. In the live SDK it turns off the click-to-play preroll splash. Should the SDK ever
  pause the game by itself anyway (the live script also has a promo path that calls
  `showBanner()` on its own), the adapter handles it as the portal holding the screen
  (paused, muted, bounded by 60 s).
- **A preroll during `initialize()`** holds the foreground; the template's `bindPlatform` reads
  `platform.foreground` when it binds, so the game starts paused and resumes on
  `SDK_GAME_START`.
- **Bundle contents.** Since contract 2 each platform is built separately
  (`pnpm build:platforms`) and a GameMonetize build contains only the GameMonetize adapter;
  no other portal's build contains `api.gamemonetize.com`.
- **Undocumented behaviour.** GameMonetize documents no error codes, no fill signal and no
  rate-limit signal. A refused premature call and a no-fill look the same (`SDK_GAME_START`
  alone), so both resolve `not-ready`, not `too-soon`. The timeouts (5 s init, 25 s ad start,
  60 s ad) are this adapter's, sized from the live SDK's own timers.
- **A silent SDK holds a break for up to 25 s.** If the SDK says nothing at all after
  `showBanner()` (its pre-request fetch to `api.gamemonetize.com` blocked while `sdk.js` was
  not), `withAdBreak` keeps the game paused until the start deadline.
- **The template places no ad.** Placement is game design; a GameMonetize title must add one
  (see Publishing, step 2).
- Browser coverage is Chromium only (desktop and Android profiles).
