# SDK conformance

One scenario matrix over every platform the Factory knows, so "does this title's platform
integration work?" has the same answer shape for every portal. The Factory's `sdk` step reads
the result.

| Layer                  | Where                           | Runs                                     | What it proves                                                                                                                   |
| ---------------------- | ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Adapter unit tests     | `tests/unit/<platform>.test.ts` | `pnpm test:unit`                         | The portal's call sequence, in detail                                                                                            |
| **Conformance matrix** | `tests/sdk/`                    | `pnpm test:sdk` / `pnpm sdk:conformance` | The same scenarios on every adapter, against fake portal SDKs, with a real `Game` bound the way `src/main.ts` binds it           |
| **Browser smoke**      | `tests/sdk-browser/`            | `pnpm test:sdk:browser`                  | The real PixiJS and Three.js builds boot, run and pause correctly with each portal's script replaced by a local mock, or blocked |

None of these loads a real portal script, makes a network request to a portal, or publishes
anything. How the real portal behaves is checked in its draft/QA mode by a person, as part of
the release pipeline.

## The matrix

`describe(<platform>) > describe(<feature>) > it(<scenario>)`. `pnpm sdk:conformance` writes
vitest's JSON report to `build/sdk-conformance.json`; the Factory maps each feature to an
sdk-report status:

| JSON status of a feature's scenarios   | sdk-report status                 |
| -------------------------------------- | --------------------------------- |
| all `passed`                           | `working`                         |
| any `failed`                           | `partial` (the failure is quoted) |
| any `skipped` — the adapter is missing | `not-started`                     |
| only `todo` "not applicable"           | `not-required`                    |

| Feature              | Scenarios                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-configured`     | `createPlatform` builds the adapter, or refuses loudly; an unknown id fails at startup                                                                                  |
| `init`               | initialize resolves, is idempotent; signalReady reported once (Yandex `LoadingAPI.ready`, Poki `gameLoadingFinished`)                                                   |
| `sdk-unavailable`    | script blocked or absent: the game boots, ads are refused, storage works                                                                                                |
| `init-failure`       | the portal's init rejects: the game boots and degrades                                                                                                                  |
| `loading`            | progress accepted in any order, counted for release validation                                                                                                          |
| `gameplay-lifecycle` | start/stop tracked; duplicates never reach the portal                                                                                                                   |
| `pause-resume`       | portal pause/resume become foreground signals once each; an ad takes the foreground and gives it back                                                                   |
| `interstitial`       | plays on fill; no fill and portal errors resolve unshown, never throw; interval rule (Yandex)                                                                           |
| `rewarded`           | granted only on the portal's reward confirmation; closed early, no fill and errors never grant                                                                          |
| `storage`            | set/get/remove round-trip; Yandex writes reach player data                                                                                                              |
| `game-binding`       | a real `Game`: paused for the whole ad, resumed after; closed early resumes without reward; portal pause pauses the game; hidden tab pauses and stops reported gameplay |

## Current results (this ref)

| Platform         | Adapter             | Result                                                                                                                                                     |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| generic-web      | implemented         | all applicable scenarios pass                                                                                                                              |
| Yandex Games     | implemented         | all scenarios pass; browser smoke passes on PixiJS and Three.js                                                                                            |
| Poki             | implemented         | all scenarios pass; browser smoke passes on PixiJS and Three.js                                                                                            |
| CrazyGames       | implemented         | all scenarios pass; browser: PixiJS and Three.js in the SDK matrix (`tests/sdk-matrix`, `pnpm test:sdk:matrix`) and the compliance demo suite              |
| GameDistribution | implemented         | all scenarios pass; browser: PixiJS and Three.js in the SDK matrix and the template build smoke. See [gamedistribution.md](gamedistribution.md)            |
| GameVui          | implemented, no SDK | `GameVuiPlatform`: local saves, no requestable ad; all applicable scenarios pass; browser: SDK matrix. See [../sdk.md](../sdk.md)                          |
| Y8               | implemented         | all scenarios pass; no loading/gameplay API, so those are counted, not forwarded; browser: SDK matrix and smoke. See [y8.md](y8.md)                        |
| GameMonetize     | implemented         | all applicable scenarios pass; rewarded is `unsupported` (none documented); browser: SDK matrix and template build. See [gamemonetize.md](gamemonetize.md) |

### Fixed while building this

`bindPlatform` (`src/platform/bind.ts`) never wired the platform's `foreground:lost` /
`foreground:gained` to the game. On Yandex the template game therefore kept running — and
sounding — through `game_api_pause`, including the ad the portal shows by itself at launch
(requirements 1.19.4 and 4.7). The game now pauses under reason `platform` until the portal
hands the foreground back. The browser smoke fails without the fix.

## Known limitations

Checked against each portal's current documentation on 2026-09-23. They are limits of the
adapters or of what can be tested, not failures of the matrix.

**All portals**

- `reportLoadingProgress` forwards nothing: none of Yandex, Poki or CrazyGames documents a
  progress API. It is counted for release validation only.
- Fakes are shaped like the documented APIs. Behaviour the docs leave open — what a real
  portal does on a failed init, ad fill rates, exact event timing — is only settled in each
  portal's draft/QA mode.

**Yandex Games**

- The SDK is injected from script (`loadSdkScript`), where the English docs show a static
  `<script src="/sdk.js">` tag; requirement 1.19.1 asks for initialisation "exactly as
  described". Confirm the debug panel shows `IT` in draft mode before submitting.
- The 60 s interstitial floor is the Factory profile's figure, not a documented Yandex rule
  (the portal controls frequency).
- Sticky banners (`showBannerAdv`), IAP, `EXIT` and `HISTORY_BACK` are not implemented.
- Tab hide is handled by the game (`bindPlatform` stops reported gameplay), not the adapter.

**Poki**

- `openExternalLink`, `shareableURL` / `getURLParam` and `movePill` are not implemented; a
  game that adds an external link has no compliant way to open it yet.
- No language or cloud-save API exists; the game follows the browser and saves locally.
- Poki's size guidance is 5 MB initial / 8 MB total — far below the Factory profile's 150 MB.

**CrazyGames**

- Banners, auth, `happytime` and the invite-only purchases and leaderboards are not
  implemented. What a player closing a rewarded ad early reports is undocumented; the
  adapter rewards only on `adFinished`. See [../sdk.md](../sdk.md).

**GameVui**

- No SDK, JS API or publishing API is published. `createPlatform("gamevui")` returns
  `GameVuiPlatform`, a no-SDK adapter (local saves, no ad the game can request), so a title
  whose required platform is `gamevui` boots. See [../sdk.md](../sdk.md).
- Ads injected by GameVui's own scripts are outside the game's control and untested here.
