# Yandex compliance demo — Starfall Basket

A deliberately small PixiJS game whose job is to exercise the Yandex Games integration
end to end, not to be a good game. Catch falling stars; miss three and the run is over.

```
Boot -> SDK init -> loading -> menu (Game Ready) -> first tap -> run -> save
     -> focus loss / portal pause -> paused -> resume
     -> game over -> "play again" -> interstitial -> run
                  -> "watch an ad: continue" -> rewarded -> run (once)
```

## Commands (from the repository root)

```bash
pnpm demo:yandex:dev       # dev server on :5174 — no /sdk.js here, the adapter degrades
pnpm demo:yandex:build     # production build -> examples/yandex-compliance-demo/dist
pnpm demo:yandex:audit     # static audit of dist/ -> build/yandex/audit.json
pnpm demo:yandex:e2e       # Playwright: desktop, phone, tablet (portrait, landscape)
pnpm demo:yandex:package   # ZIP with index.html at the root -> build/yandex/*.zip
```

Unit tests for the game logic and the full flow against the real adapter run as part of
`pnpm test:unit`.

## With the real SDK, locally

`/sdk.js` exists only on the portal. Yandex's own tool proxies it
([local launch](https://yandex.com/dev/games/doc/en/concepts/local-launch)):

```bash
pnpm demo:yandex:build
npx @yandex-games/sdk-dev-proxy -p examples/yandex-compliance-demo/dist --dev-mode=true
```

Headless (CI, WSL), the proxy tries to open a browser with `xdg-open`; stub or ignore it.
On WSL its HTTPS fetch of the dev SDK can time out under Node's address-family
auto-selection; `NODE_OPTIONS=--no-network-family-autoselection` fixed that there. Adding
`--csp` injects the portal's live Content-Security-Policy — the demo boots under it with no
violations.

Dev mode needs no draft: SDK calls are mocked by Yandex, ads are placeholders whose
callbacks fire, player data goes to localStorage. With a draft, `--app-id=<id>` runs it on
the real platform instead.

## Where things are

| Path                                 | What                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `src/app.ts`                         | the flow; decides when gameplay, sound and ads happen |
| `src/game/catch-game.ts`             | the game, pure simulation                             |
| `src/rendering/pixijs/catch-view.ts` | the only file that imports pixi.js                    |
| `src/lifecycle.ts`                   | context menu, scroll, visibility and focus            |
| `src/ui.ts`, `public/locales/`       | DOM screens, ru and en strings                        |
| `tests/e2e/mock-sdk.js`              | test-only stand-in for `/sdk.js`, never shipped       |
| `config/platforms/yandex.yaml`       | the Factory profile, vendored at the pinned version   |

Nothing under `src/` calls Yandex. The adapter is
`packages/platform-sdk/src/adapters/yandex.ts`; the demo talks to the `Platform` interface.

## Console draft settings this build assumes

The code can only be half of compliance; the draft is the other half
([draft fields](https://yandex.com/dev/games/doc/en/console/add-new-game/draft)).

| Draft field / setting                                           | Value for this build                                | Why                                                               |
| --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| "The game uses cloud save"                                      | **on**                                              | the adapter writes `player.setData` (1.11)                        |
| Game translated into                                            | **English, Russian** — nothing else                 | only `en` and `ru` ship; each declared language is tested (8.2.3) |
| Platforms                                                       | Desktop, Mobile (iOS/Android)                       | e2e covers desktop, phone, tablet                                 |
| Orientation                                                     | Any                                                 | layout tested in both                                             |
| Advertising                                                     | interstitial + rewarded on; sticky banner a choice  | only SDK ads are used (4.1, 4.6)                                  |
| How to play                                                     | the `menu.howto` + controls strings, 100–1000 chars | 2.2, 5.2                                                          |
| Title                                                           | the same string as `title` in each locale           | 5.1.3; must be unique per language (5.12)                         |
| Icon 512×512, cover 800×470, video, ≥2 screenshots per platform | to be produced from real gameplay                   | 5.1.1.2, 5.6 — not in this repository                             |
| Age rating, categories                                          | chosen by the submitter                             | —                                                                 |

## Before submitting a real game built this way

See `compliance/yandex-compliance-report.md` at the repository root — in particular the
manual checklist. Passing everything here means the build is ready for moderation, not that
Yandex has approved it.
