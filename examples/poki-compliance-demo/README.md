# Poki compliance demo

A small PixiJS game whose only job is to exercise every path Poki's SDK documentation
describes, through `@wgf/platform-sdk`, in a production build that can be audited and driven
end to end.

```bash
pnpm demo:poki:dev      # dev server
pnpm demo:poki:build    # examples/poki-compliance-demo/dist
pnpm audit:poki         # static audit of that build
pnpm test:poki          # Playwright: desktop, mobile, tablet
```

It is not a game for submission and has not been through Poki's review. See
[compliance/poki-compliance-report.md](../../compliance/poki-compliance-report.md) for what
has been verified, how, and what is still manual.

## The flow

```
loading ── gameLoadingFinished
   │
 title ─── first input ── gameplayStart
   │
playing ── Esc / ⏸ ────── gameplayStop ─── paused ── Resume ── commercialBreak ── gameplayStart
   │
 death ─────────────────── gameplayStop ─── game over
                                             ├─ Play again ── commercialBreak ── gameplayStart
                                             └─ 🎬 Revive ─── rewardedBreak ─┬─ reward ── gameplayStart
                                                                             └─ none ──── stays on game over
```

## Where Poki lives

```
src/main.ts, dodge-scene.ts, …     the game — knows Platform, not Poki
src/session.ts                      the game's platform glue: pause, mute, input around breaks
@wgf/platform-sdk  Platform         the interface
                   PokiPlatform     the adapter — the only code that touches window.PokiSDK
                   GameplayLifecycle  Poki's sequencing rules, enforced
https://game-cdn.poki.com/scripts/v2/poki-sdk.js   injected by the adapter at runtime
```

`main.ts` constructs `PokiPlatform` directly rather than via `createPlatform("poki")`: the
registry names every portal the template supports, and those names would otherwise ship in a
Poki build. The audit fails on them.

## What it deliberately does

- **No external requests** besides Poki's SDK loader. No web fonts, no CDN code, no remote
  images, no audio files — sound is synthesised with WebAudio.
- **Survives a blocked SDK.** An ad blocker stopping the loader, an `init()` that rejects, and
  an `init()` that never settles all boot the game; ads then resolve as not shown and no reward
  is granted. No "ad blocked" message — Poki handles that.
- **Survives blocked storage.** Saves go through `Platform.storage`, which falls back to
  memory when `localStorage` throws, and the title screen says progress will not be kept.
- **Covers the frame.** The world is 720 units tall and as wide as the screen's aspect
  ratio — 1280 × 720 at 16:9 — drawn edge to edge in portrait and landscape.
- **Touch controls on any touch device**, tablets included, chosen by input hardware rather
  than screen width.
- **Keeps the host page still.** Space, arrows, Page Up/Down and the wheel do not scroll
  Poki's page.
- **Runs without `eval`.** `pixi.js/unsafe-eval` is loaded so rendering does not depend on
  the iframe's Content-Security-Policy allowing it.

## Test hooks

`#hud` carries `data-state`, `data-ad`, `data-audio`, `data-score`, `data-best`, `data-runs`,
`data-sdk`, `data-persistent`, `data-scheme`, `data-world`, `data-viewport` and
`data-player-x`. They are what the Playwright suite reads. A title built from this would drop
them.
