# GameDistribution

How a template game targets GameDistribution (GD), what the adapter was built from, and what
is still unverified. Code: `packages/platform-sdk/src/adapters/gamedistribution/`.

## Official sources audited (2026-09-24)

| Source                                                                                                       | Version / date                                     |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [GD-HTML5 README](https://github.com/GameDistribution/GD-HTML5) and `index_iframe.html`                      | `4873abe`, "version 1.43.58", 2026-06-18           |
| [GD-HTML5 wiki](https://github.com/GameDistribution/GD-HTML5/wiki): SDK-Implementation, Rewarded-Ads, F.A.Q. | `431a51d`, 2025-06-17                              |
| Loader `https://html5.api.gamedistribution.com/main.min.js`                                                  | banner "Version: 1.43.58 (18-06-2026 11:44)"       |
| [Developer Guidelines](https://static.gamedistribution.com/developer/developers-guidelines.html)             | as served 2026-09-24                               |
| [gd-embed-game README](https://github.com/GameDistribution/gd-embed-game)                                    | `gd_sdk_referrer_url` = "Your exact game page url" |

`https://gamedistribution.com/sdk/html5` returns 404 and the developer FAQ pages render
client-side only; neither could be read. The SDK's source is no longer in the GD-HTML5 repo
(moved to the npm packages `@bygd/gd-sdk-pes` / `@bygd/gd-sdk-era`, minified). It was read to
confirm names and orderings; **the adapter depends only on what the docs state**. Where a
behaviour is undocumented and the adapter must still handle it, this page says so.

## API surface implemented

Only documented members, and only the ones the contract needs (`adapters/gamedistribution/sdk.ts`):

| GD                                                                                                                 | Adapter                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `window.GD_OPTIONS = { gameId, onEvent }`, then `<script id="gamedistribution-jssdk" src=".../main.min.js">`, once | `loadGameDistributionSdk()`, called by `initialize()`         |
| `SDK_READY` / `SDK_ERROR`                                                                                          | `initialize()` resolves; `sdkState`                           |
| `gdsdk.showAd("interstitial")`                                                                                     | `showInterstitial()` (pre-roll and mid-roll)                  |
| `gdsdk.showAd("rewarded")` + `SDK_REWARDED_WATCH_COMPLETE`                                                         | `showRewarded()`                                              |
| `gdsdk.preloadAd("rewarded")` — rejects when "Any Rewarded ad is not available"                                    | `adAvailability("rewarded")`                                  |
| `SDK_GAME_PAUSE` — "pause AND mute your game"                                                                      | `foreground:lost` (+ `ad:start` for an ad the game asked for) |
| `SDK_GAME_START` — "resume your game"                                                                              | `foreground:gained` (+ `ad:end`)                              |
| `AD_IS_ALREADY_RUNNING`                                                                                            | reason `busy`                                                 |

Not used: `cancelAd`, `openConsole` (a developer tool), `getSession`, `sendEvent`,
`leaderboard`, the Store API, display ads and the deprecated `showBanner()`, and the
undocumented `GD_OPTIONS.pauseGame/resumeGame` callbacks. `prefix` and
`advertisementSettings` are left at the SDK's defaults (the SDK ignores `prefix`).

## Capabilities

| Capability               | Value                  | Why                                                                                                                               |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ads                      | interstitial, rewarded | pre-roll + mid-roll are "mandatory for all games" (Guidelines §2); rewarded is optional                                           |
| banner                   | unsupported            | the contract has no banner call; `showBanner()` is deprecated                                                                     |
| loadingApi               | `none`                 | the SDK has no loading or game-ready call                                                                                         |
| gameplay start/stop      | tracked locally        | the SDK has no such call; counted in `usage` for release validation                                                               |
| interstitialMinIntervalS | `null`                 | "we regulate the ad-interval through the SDK"; an early request is refused → `too-soon`                                           |
| gameplayStopOnHidden     | `true`                 | the SDK raises no pause for a hidden tab                                                                                          |
| storage                  | local                  | no storage API; §7 "Any collection or storing of data from a game is strictly prohibited" targets personal data — see limitations |
| analytics                | platform-provided      | §7 forbids third-party analytics and trackers                                                                                     |
| language, user           | `null`                 | no API (`advertisementSettings.locale` is ad text only)                                                                           |

## SDK lifecycle

```text
initialize()
  └─ GD_OPTIONS set, main.min.js inserted once ──┬─ SDK_READY          → ready; preloadAd("rewarded")
                                                  ├─ SDK_ERROR first    → error (boot without ads)
                                                  ├─ script blocked     → unavailable
                                                  └─ nothing in 5 s     → unavailable
  late SDK_READY after error/unavailable → ready (honoured, never dropped)
  SDK_READY twice                        → no-op
  SDK_ERROR after SDK_READY              → ignored (ads keep working)
```

`initialize()` never rejects and is memoised: repeated calls load the SDK once. If the page
already carries a `#gamedistribution-jssdk` tag the adapter did not add (the snippet pasted
into `index.html`), it neither loads a second copy ("Only load the SDK once!") nor trusts a
`GD_OPTIONS.onEvent` that is not its own — it boots without ads. **Do not add the snippet to
`index.html`; the adapter is the snippet.**

The page must declare UTF-8. `main.min.js` is served without a charset and contains non-ASCII
regular expressions; on a page without `<meta charset="utf-8">` Chromium decodes it as
windows-1252 and it throws `Invalid regular expression` before defining `gdsdk` (observed live,
2026-09-24). The template's `index.html` declares it.

The adapter calls whatever `window.gdsdk` is at the moment of each call: 1.43.58 may swap
the global for an "SDK wrapper" object after load.

## Advertising lifecycle

```text
showAd(type) ─┬─ SDK_GAME_PAUSE ──► ad:start, foreground:lost, hooks.onStart
              │     [SDK_REWARDED_WATCH_COMPLETE] ──► rewarded = true (once)
              │  SDK_GAME_START ──► ad:end, foreground:gained ──► resolve {shown:true, rewarded}
              ├─ no pause, promise resolves      ──► {shown:false, reason:"not-ready"} (no fill)
              ├─ AD_IS_ALREADY_RUNNING, resolves ──► {shown:false, reason:"busy"}
              └─ promise rejects                  ──► "too-soon" | "disabled" | "error"
```

Rules the adapter holds whatever the SDK does:

- **Reward** only on `SDK_REWARDED_WATCH_COMPLETE` received while that rewarded request is
  open — never on a resolved promise, never on `SDK_GAME_START`, never on an interstitial,
  never twice. A duplicate reward event is ignored. A reward arriving after the flow ended is
  ignored (not attributable). A reward arriving after the adapter already answered
  `rewarded: false` (its deadline fired) but while GD's flow is still open is announced once as
  `ad:late-reward`; the game decides.
- **Exactly one answer** per request; never rejects; a synchronous throw from `showAd` is `error`.
- **Never stuck paused.** No `SDK_GAME_PAUSE` within 10 s (interstitial) / 20 s (rewarded) →
  `not-ready`; a later start still pauses the game and is handed back. A started ad with no
  `SDK_GAME_START` and no settled promise is handed back after 90 s. A flow that settles
  without `SDK_GAME_START` is handed back at settlement. `bindPlatform`'s foreground watchdog
  is the second line.
- **Busy**: one request at a time, and none while GD holds the screen (its pre-roll splash).
- **Duplicates**: repeated `SDK_GAME_PAUSE` / `SDK_GAME_START` produce one transition each.
- A pause GD raises by itself (its splash waits for the player's click before the pre-roll) has
  **no** deadline: the portal legitimately holds the screen until the player acts.

Rejection reasons are matched on the messages 1.43.58 rejects with ("The advertisement was
requested too soon.", "Advertisements are disabled."), because the docs define none; anything
else is `error`.

Undocumented and handled defensively: `SDK_GAME_START` also arrives with no pause before it
(a refused request, a skipped splash) — a no-op; with ads disabled the SDK resolves without
pausing — `not-ready`; early close of a rewarded ad — no reward event, so `rewarded: false`.

## Game ID and configuration

```yaml
# game.config.yaml
platforms:
  - id: gamedistribution
    profile: gamedistribution@1.0.0
    role: required
    game_id: 0123456789abcdef0123456789abcdef # 32 hex, from the GD developer panel
    # hosting: self-hosted                    # only with GD's agreement, see below
    # game_url: https://games.example.com/my-game/
```

- `game_id` is **required** and validated at build time (`src/core/game-config.ts`): 32 hex
  characters; the SDK's built-in placeholder `4f3d7d38…2333` ("no revenue will be reported")
  is refused. `createPlatform("gamedistribution")` without one throws. A Game ID is public
  (it is in every GD game URL) — it is configuration, not a credential; no credential is
  read or stored anywhere.
- `game_id`, `hosting`, `game_url` on any other platform entry fail the build.
- Rewarded ads need the rewarded flag set for the game in the developer panel; without it
  `preloadAd` rejects and `adAvailability("rewarded")` is `disabled`.
- Profile: the Factory carries a core profile `gamedistribution@1.0.0`
  (`status: unverified`), which Factory `init` vendors into a game's `config/platforms/`. The
  template's own `config/platforms/gamedistribution.yaml` is the earlier draft, with the
  assertions `evaluate-assertions.mjs` checks (SDK present, https, English, no banner, no
  external links); it is not in the template's `pinned.json`.

## `GD_SDK_REFERRER_URL` and self-hosting

What the sources say:

- README: a self-hosting developer uploads "a zipped `index.html`-file containing an iframe
  with the following query variable: `GD_SDK_REFERRER_URL`. The value of this variable should
  be the parentUrl", with `index_iframe.html` as the example.
- It is a **query parameter on the game iframe's URL**, not a global. No SDK version reads a
  `window.GD_SDK_REFERRER_URL`. The SDK parses its own query case-insensitively (the README
  writes it upper case, the example lower case).
- The value is the URL of the page embedding the wrapper (`document.referrer` when framed, the
  wrapper's own URL otherwise), not the game's URL.
- At the top level (not framed) the SDK replaces it with the page's own URL — it has no effect.
- Guidelines §3.1: **"We do not permit external hosting of games, except for Real Multiplayer
  games."** Self-hosting is an exception GD must agree to.

What the template does — the minimum, and nothing invented:

| Mode                                    | Build / release                                                                                                                                                                                           | Referrer                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GD-hosted (default)                     | `build/platforms/gamedistribution/dist/` zipped as `gamedistribution.zip` and uploaded                                                                                                                    | none needed; the SDK derives the domain from GD's frame           |
| Self-hosted (`hosting: self-hosted`)    | `build/platforms/gamedistribution/dist/` is deployed to `game_url` (https, validated); `gamedistribution.zip` contains **only** the wrapper `index.html` (`scripts/release/gamedistribution-wrapper.mjs`) | the wrapper computes it **at run time** from where it is embedded |
| Local development (`pnpm dev`, preview) | nothing                                                                                                                                                                                                   | absent — the SDK uses the page itself; the adapter sets nothing   |
| Any iframe embed                        | nothing                                                                                                                                                                                                   | whatever the embedding wrapper passed, untouched                  |

The wrapper follows `index_iframe.html` value for value (embedding page from
`document.referrer` when framed, an incoming `gd_sdk_referrer_url` passed through, a
`localhost` referrer mapped to `https://gamedistribution.com/` as the example does), with two
corrections that change no value the SDK receives: the parameter is URL-encoded (the example
concatenates it raw, cutting a referrer at its first `&`) and appended with `searchParams`
(a `game_url` with a query stays valid). `game_url` may not carry the parameter itself: a
value baked in at build time would report every embed as one page.

The game never writes the parameter. `platform.hosting` reports what the SDK will see —
`absent`, `valid`, `malformed` (not a URL: the SDK cannot use it) or `ignored` (top level) —
for diagnostics only; the adapter never changes behaviour on it.

Existing Yandex / Poki / CrazyGames / GameVui releases are unaffected: the wrapper branch in
`scripts/release/package.mjs` applies only to a `gamedistribution` target with
`hosting: self-hosted`, and the new config fields are refused on any other platform.

`readGameConfig` (scripts) now honours `WGF_GAME_CONFIG`, as `vite.config.ts` already did, so
a build made against another config is packaged and measured against that same config.

## Local development

- `pnpm dev` with a GD `game.config.yaml` loads the real SDK from GD's CDN. On `localhost` /
  `127.0.0.1` the real SDK raised `SDK_READY` with a Game ID that belongs to no title (observed
  2026-09-24); ads do not fill locally ("ads don't show when testing locally", F.A.Q.).
- `gdsdk.openConsole()` in the browser console (select the game's frame) opens GD's debug
  toolbar with fake ads; clear localStorage to switch it off.
- Tests never contact GD: node suites use `tests/gamedistribution/fake-sdk.ts`, browser suites
  serve `tests/gamedistribution/mock-gd-sdk.js` in place of `main.min.js`.

## Test evidence

| Layer                     | Where                                                                  | Result (this ref)                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter, adversarial      | `tests/unit/gamedistribution.test.ts`                                  | 57 pass: missing/malformed/placeholder Game ID, snippet loaded once, SDK never loads / late / twice / SDK_ERROR, pause without resume (portal and ad), no fill, error, too soon, disabled, already running, busy, duplicate events, duplicate / stray / late reward, ad after deadline, 90 s hand-back, referrer states |
| Release side              | `tests/unit/gamedistribution-release.test.ts`                          | 10 pass: wrapper run in a sandbox (top level, framed, passthrough, localhost, query), malformed/http/pre-referred `game_url`, self-hosted packaging, integration artifact                                                                                                                                               |
| Conformance               | `tests/sdk/conformance.test.ts` (`pnpm test:sdk`)                      | every feature for `gamedistribution` passes                                                                                                                                                                                                                                                                             |
| Game-side contract        | `tests/unit/sdk-contract.test.ts`                                      | GD runs every cross-portal scenario                                                                                                                                                                                                                                                                                     |
| Browser matrix (Chromium) | `tests/sdk-matrix/` (`pnpm test:sdk:matrix`)                           | PixiJS × GD and Three.js × GD, desktop + mobile: boot, first-input gameplay, interstitial, rewarded, closed early, no fill, hidden tab, SDK missing / init-fails, `SDK_GAME_PAUSE`/`START` holding the loop and sound, duplicate + stray reward, too soon                                                               |
| Template build smoke      | `tests/sdk-browser/gamedistribution.spec.ts`                           | the real PixiJS and Three.js builds, desktop + mobile: documented snippet with the configured Game ID, loaded once; SDK_READY twice; blocked; SDK_ERROR; never ready (boots after 5 s); late ready; pause/resume; top-level local dev; **self-hosted wrapper framing the game with the publisher's referrer**           |
| Release                   | GD build → `release:package` → `release:manifest` → facts → assertions | PixiJS and Three.js GD zips: no `.map`, no `sourceMappingURL`, no secrets, UTF-8 meta; manifests valid against the Factory's `release-manifest.schema.json`; `gamedistribution@1.0.0` assertions 5/5 with runtime facts; self-hosted zip = wrapper `index.html` only                                                    |

## Live verification

`WGF_LIVE=1 pnpm test:sdk:live` (or `playwright test -c tests/live/live.config.ts gamedistribution`).
Evidence: `docs/audits/live/gamedistribution/`.

| Check                                                                                                                                         | Status        | Evidence                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| Real `main.min.js` loads the documented way; `gdsdk.showAd` / `preloadAd` present                                                             | **LIVE PASS** | `sdk-load.json`                                                     |
| Real SDK raises `SDK_READY` on 127.0.0.1 with a test Game ID                                                                                  | **LIVE PASS** | `sdk-load.json`                                                     |
| Template GD build + real SDK: adapter receives `SDK_READY`, calls the real `preloadAd("rewarded")`, one script tag, loop runs, no game errors | **LIVE PASS** | `adapter-boot.json`                                                 |
| Interstitial / rewarded fill, `SDK_GAME_PAUSE`/`START` around a real ad, reward event                                                         | BLOCKED       | needs a registered Game ID on an approved domain and GD's ad server |
| Pre-roll activation in the developer panel                                                                                                    | BLOCKED       | needs a publisher account                                           |
| Self-hosted wrapper accepted by GD                                                                                                            | BLOCKED       | needs GD's agreement (§3.1)                                         |

Everything under "Advertising lifecycle" is **MOCK PASS**, not LIVE: it was observed against
the fake and the mock, which emit the documented events in the order the 1.43.58 source does.

## Known limitations

- No live ad was observed. Fill, real event order around an ad, the rewarded skip GD adds after
  30 s, and the mid-roll interval GD sets per game need a registered title.
- Rejection reasons depend on 1.43.58's messages; if GD rewords them the adapter reports
  `error` instead of `too-soon` / `disabled` — never a wrong reward.
- `preloadAd` in 1.43.58 does not check fill (it resolves unless ads are disabled for the
  type), so `adAvailability("rewarded") === "available"` does not promise a filled ad; a
  no-fill still resolves `{ shown: false, rewarded: false }`.
- Saves stay in local storage. §7 prohibits "collection or storing of data"; whether it covers
  local game progress is not stated. Titles should keep saves to game state only.
- GD events carry no request id. If a request is answered `not-ready` at its start deadline
  and the game immediately asks for another ad, a late `SDK_GAME_PAUSE` from the first flow is
  attributed to the second. The game is still paused, muted and handed back; only the
  `shown` bookkeeping can be off by one.
- Self-hosting is supported technically but is against GD's guidelines unless GD agrees.
- The template's analytics package must stay off for GD (§7).
- Fixed in contract 2: each platform is built separately (`pnpm build:platforms`) and a GD
  build bundles only the GD adapter, so no other portal's SDK URL is in it (`platform_sdk`
  is measured from the shipped files).
- Chromium only; Safari/iOS audio behaviour during GD ads is a manual check.
