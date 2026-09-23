# Platform SDK

How a game reaches a portal, what each adapter was checked against, and what is still
unverified. Code: `packages/platform-sdk`. Wiring into the game: `src/platform/bind.ts`.

```text
Game code (src/, examples/)
 │   calls only the Platform contract — never window.YaGames / CrazyGames / PokiSDK
 ▼
@wgf/platform-sdk — Platform (types.ts), created by createPlatform(id) from game.config.yaml
 ├── YandexPlatform       adapters/yandex.ts        /sdk.js, loaded at runtime
 ├── CrazyGamesPlatform   adapters/crazygames/      HTML5 SDK v3, <script> in <head>
 ├── PokiPlatform         adapters/poki.ts          poki-sdk.js v2, loaded at runtime
 ├── GameVuiPlatform      adapters/gamevui.ts       no SDK exists — local saves, no ads
 └── GenericWebPlatform   adapters/generic-web.ts   self-hosted, no portal
```

## The contract

One interface for every portal (`packages/platform-sdk/src/types.ts`):

| Concern            | Contract                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK initialization | `initialize()` — once, never rejects. A missing or failing SDK leaves a platform that behaves like a plain web game                                                                                                                      |
| Loading            | `reportLoadingProgress(f)`, then `signalReady()` once the game is interactive                                                                                                                                                            |
| Game lifecycle     | `gameplayStart()` on first input / unpause, `gameplayStop()` on pause, death, menu; duplicates dropped; `gameplayActive`                                                                                                                 |
| Pause / resume     | `foreground` + `foreground:lost/gained` (portal holds the screen), `capabilities.gameplayStopOnHidden` (whether the game reports a hidden tab)                                                                                           |
| Visibility, audio  | `bindPlatform` pauses on a hidden tab, mutes on blur, on a playing ad, on the portal holding the screen, and on `settings.muteAudio`                                                                                                     |
| Ads                | `showInterstitial(hooks)`, `showRewarded(hooks)` — resolve, never reject; `rewarded` true only on the portal's reward signal; `adAvailability(kind)` to hide an offer that cannot play; `ad:start`/`ad:end` bracket what actually played |
| Storage            | `storage.get/set/remove` — portal cloud saves where they exist, local storage otherwise                                                                                                                                                  |
| Analytics          | Portal-provided where the profile says so; no adapter sends events of its own                                                                                                                                                            |
| Locale, user       | `language`, `environment`, `getUser()`                                                                                                                                                                                                   |

A new portal is a new adapter implementing this, a profile in the Factory, and an entry in
`tests/sdk/portals.ts` so it runs through the same scenarios as the others.

## Verification

| Suite                | What                                                                                                                                                                                                                                                | Command                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Conformance          | Every platform over its mocked SDK: SDK unavailable, init failure, ad unavailable, closed early, reward callback, pause/resume, storage, not configured, a real `Game` bound to each ([platforms/sdk-conformance.md](platforms/sdk-conformance.md)) | `pnpm test:sdk`                                              |
| Game-side scenarios  | The same portals from the game's side: `withAdBreak`, portal mute, `adAvailability`, loading once; plus one regression test per audit finding                                                                                                       | `tests/unit/sdk-contract.test.ts`, `sdk-audit-fixes.test.ts` |
| Per-adapter detail   | Call order, timeouts, late ads, retries                                                                                                                                                                                                             | `tests/unit/{yandex,poki,crazygames}.test.ts`                |
| Browser matrix       | PixiJS and Three.js games × all four portal adapters, real renderer, loop and `bindPlatform`, desktop and mobile Chromium                                                                                                                           | `pnpm test:sdk:matrix`                                       |
| Template build smoke | The template game itself built per platform (generic-web, Yandex, Poki) × engine                                                                                                                                                                    | `pnpm test:sdk:browser`                                      |
| Release boundary     | Integration artifacts are prepared, never published; no SDK code can upload                                                                                                                                                                         | `tests/unit/sdk-integration.test.ts`                         |

Mocks implement only the documented SDK surface. They prove the adapter uses that surface
the way the documentation says; they cannot prove what the portal does with it.

## Integration artifacts

`pnpm build && pnpm sdk:prepare` writes, for the platforms `game.config.yaml` targets:

- `build/sdk/integration.json` — adapter, SDK source and how it loads, capabilities, and any
  ad kind the title declares that an adapter cannot show (exit 1 if so);
- `build/sdk/sdk-report.json` — the Factory's `sdk-report` artifact. Portal features are
  `partial`, never `working`: they were observed against mocks, not a live portal.

It makes no network request. **Publishing is not the SDK module's job**: it belongs to the
release pipeline (GitHub Actions, behind gates G5 and G6), and portal submission is the
human checklist `scripts/publish/make-publication.mjs` writes.

## Audit against current portal documentation (2026-09-23)

Every adapter was re-read against the portal's current documentation, fetched on
2026-09-23, not from memory.

### Yandex Games — PASS, with known limitations

Checked: [sdk-about](https://yandex.com/dev/games/doc/en/sdk/sdk-about),
[sdk-game-events](https://yandex.com/dev/games/doc/en/sdk/sdk-game-events),
[sdk-events](https://yandex.com/dev/games/doc/en/sdk/sdk-events),
[sdk-adv](https://yandex.com/dev/games/doc/en/sdk/sdk-adv),
[sdk-player](https://yandex.com/dev/games/doc/en/sdk/sdk-player),
[sdk-environment](https://yandex.com/dev/games/doc/en/sdk/sdk-environment),
[requirements](https://yandex.com/dev/games/doc/en/concepts/requirements).

Matches the docs: relative `/sdk.js`, `YaGames.init()`, `LoadingAPI.ready()`,
`GameplayAPI.start/stop`, `game_api_pause/resume`, `showFullscreenAdv` /
`showRewardedVideo` with `onRewarded` as the only reward signal, `getData/setData`
(200 KB, 100 requests / 5 min), account-selection events, `i18n.lang`.

Fixed in this change: the portal stops `GameplayAPI` itself on a tab switch, so
`gameplayStopOnHidden` is false; the template now pauses and mutes on `foreground:lost`
(the launch ad, 4.7) and mutes on window blur (1.3) — previously only the demo did; a
second ad while one is open reports `busy`.

Known limitations:

- Needs a real draft to confirm: when the portal's own `start()` runs relative to
  `game_api_resume`; whether `setData` merges or replaces; a skipped rewarded ad's
  `onClose` value; whether the launch ad can fire before `init()` resolves.
- No leaderboards, purchases or login — not implemented, and not claimed in capabilities.
- The 60 s interstitial floor is a local policy; the docs leave frequency to the portal.

### CrazyGames — PASS, with known limitations

Checked: [sdk/intro](https://docs.crazygames.com/sdk/intro/),
[sdk/game](https://docs.crazygames.com/sdk/game/),
[sdk/video-ads](https://docs.crazygames.com/sdk/video-ads/),
[sdk/data](https://docs.crazygames.com/sdk/data/),
[sdk/user](https://docs.crazygames.com/sdk/user/),
[requirements](https://docs.crazygames.com/requirements/intro/).

Matches the docs: v3 script URL, awaited `SDK.init()`, `environment` (`disabled` → no
calls), `loadingStart/Stop`, `gameplayStart/Stop` not on focus loss, `requestAd` with
mute on `adStarted` and reward only on `adFinished`, documented error codes, `hasAdblock`,
Data module, `muteAudio`, `systemInfo`.

Fixed in this change: loading events are optional, not required; rewarded ads count
toward the 3-minute midgame interval; `dataModuleDisabled` (Progress Save not selected at
submission) falls back to local saves instead of losing every save; a `loadingStop` is
still sent when the game became ready before a slow `init()` finished.

Known limitations:

- The docs do not say what a player closing a rewarded ad early reports; the adapter
  rewards only on `adFinished`, which is safe either way.
- `adsDisabledBasicLaunch`, `dataModuleDisabled`, the in-app (`applicationType`) context and
  the QA tool need the real portal.
- Banners, `happytime`, invite-only purchases and leaderboards are not implemented.

### Poki — PASS, with known limitations

Checked: [sdk-html5](https://developers.poki.com/guide/sdk-html5),
[sdk-overview](https://developers.poki.com/guide/sdk-overview),
[requirements-quality](https://developers.poki.com/guide/requirements-quality),
[web-engine](https://developers.poki.com/guide/web-engine),
[accounts](https://developers.poki.com/guide/accounts),
[inspector](https://developers.poki.com/guide/inspector).

Matches the docs: v2 loader URL, `init()` with load-anyway on rejection,
`gameLoadingFinished`, `gameplayStart` on first input, `commercialBreak` /
`rewardedBreak(onStart)` with the reward only on `success`, no internal ad timers, no
banners.

Fixed in this change: a rejected `init()` (Poki's ad-blocker symptom) now reports
`adblock`, so a game can hide a rewarded offer; an ad break before `gameLoadingFinished`
is refused, keeping the documented startup order.

Known limitations:

- `openExternalLink`, `measure`, `shareableURL`, `movePill` and User Accounts are not
  exposed; `getUser()` is null.
- Real fill, `onStart` timing under real blockers, and the Inspector's checks need Poki.

### GameVui — KNOWN LIMITATION: no SDK exists

GameVui publishes no SDK, developer portal or integration contract (`/developer`, `/sdk`,
`/api` do not exist; submission is by email — see `docs/platforms/gamevui/`). The portal
injects an undocumented `score.min.js` with a rewarded break and score saving, served only
on its own host and paid to its own AdSense account; a third-party build cannot honestly
target it, so the adapter never loads it.

`GameVuiPlatform` is therefore a no-SDK adapter: nothing to initialize, no ad the game can
request (`adAvailability` → `unsupported`), saves in local storage, pause on a hidden tab.
Its capabilities deliberately differ from the Factory profile `gamevui@1.0.0`, which lists
interstitial and banner ads the game cannot actually request.

## Factory profile findings

The audit found profile values the portals' own docs contradict. Profiles are versioned in
the Factory (`core/reference/platforms/`), so these need a new profile version there, not
an edit here:

| Profile            | Finding                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yandex@1.0.0`     | `ru` is not required by the docs (auto-detection is, 2.14); "does not report loading progress" — there is no progress API; the 60 s interval is undocumented; `max_bundle_mb: 100` is uncompressed  |
| `crazygames@1.0.0` | `loading_api: required` — docs say optional; 3 covers + 2 videos, not 4 screenshots; missing the 50 MB initial-download and 1500-file limits                                                        |
| `poki@1.0.0`       | `interstitial_min_interval_s: 120` contradicts "no internal ad timers"; `max_bundle_mb: 150` — docs say ~5 MB initial, 8 MB total; external links are allowed through `openExternalLink`            |
| `gamevui@1.0.0`    | ads, bundle size and `vi` locale are unsourced; the blocking `gamevui_no_rewarded` contradicts the portal's own rewarded system (which developers cannot use); `age_rating_required` should be true |

## Known limitations, all portals

- Every portal feature is verified against a mock of the documented SDK, in Node and in
  Chromium. None is verified against a live portal: that is the portal's own QA tool or
  draft upload, done by a person before submission.
- Browser coverage is Chromium (desktop and Android profiles). Safari/iOS audio and
  visibility behaviour is a manual check.
