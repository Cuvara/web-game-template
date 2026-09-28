# Development Guide

Working in a game repository created from the template, day to day. The rules for coding
agents are in [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md); the Factory ↔ template
API is [factory-contract.md](factory-contract.md).

## Setup

Node 20 or newer (CI pins `.nvmrc`), and pnpm 9.

```bash
corepack enable pnpm      # or: npm i -g pnpm@9
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once, for the browser suites
pnpm dev                  # http://localhost:5173
```

`corepack enable` writes shims next to the Node binary and needs an elevated shell on
Windows; `npm i -g pnpm@9` does not.

## Commands

| Command                             | Does                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev`                          | Vite dev server with HMR, for the target platform                                   |
| `pnpm build`                        | build every package, then bundle the target platform to `dist/`                     |
| `pnpm build:platforms`              | one build per `platforms[]` entry into `build/platforms/<id>/dist/` (release input) |
| `pnpm preview`                      | serve `dist/`                                                                       |
| `pnpm typecheck`                    | `tsc -b --force` across the workspace (and the examples, where present)             |
| `pnpm lint`                         | ESLint                                                                              |
| `pnpm format` / `pnpm format:write` | Prettier check / write                                                              |
| `pnpm test`                         | Vitest: unit, integration and SDK conformance                                       |
| `pnpm sdk:check`                    | the boot wiring in `src/main.ts` is intact (JSON report, exit 1 if not)             |
| `pnpm test:e2e`                     | Playwright `desktop` + `mobile` against `dist/` (run `pnpm build` first)            |
| `pnpm test:verify`                  | Playwright `verify`: runtime facts for each built platform                          |

The target platform is `WGF_TARGET_PLATFORM`, else the first `role: required` entry. A portal
build without its portal id fails; `WGF_ALLOW_UNCONFIGURED_PORTAL=1` lets a local build
through (never releasable). Details: [factory-contract.md §2](factory-contract.md#2-gameconfigyaml).

`pnpm build` is what `game.config.yaml` names as `build.command`, and `dist` is its
`build.output`.

## Where code goes

The game is `src/game/index.ts` → `createGame(context)` and whatever it builds. `main.ts`
boots the platform, loads strings, creates and initialises the renderer, wires pause, mute
and ads, then calls `createGame` and starts the loop. Replace `src/game/boot-scene.ts` with
the game's own scenes.

| Put it in                                           | When                                                     |
| --------------------------------------------------- | -------------------------------------------------------- |
| `src/game/`                                         | rules, state, scenes — engine-agnostic, unit-tested      |
| `src/rendering/pixijs/` or `src/rendering/threejs/` | anything that imports `pixi.js` or `three`; nowhere else |
| `src/ui/`, `src/input/`, `src/audio/`               | menus and HUD, input mapping, the audio service          |
| `public/`                                           | assets and `public/locales/<lang>.json`                  |
| `tests/unit/`, `tests/e2e/`                         | the game's own tests (`@aspect` tags in e2e titles)      |

Ads, gameplay start/stop, analytics and saves go through `context.integration`
(`GameIntegration`) or `context.gameplay` (`PlatformGameplay`) — never a `Platform` method,
never a portal SDK.

### Assets (2D)

Files go in `public/assets/`; what the game loads is declared in `src/assets/manifest.ts` as
an `AssetManifest` and loaded by `AssetLoader` from `@wgf/pixi-framework`:

```ts
const assets = new AssetLoader({
  manifest: MANIFEST,
  onProgress: context.reportLoadingProgress,
});
await assets.load("boot");
const hero = assets.texture("hero");
```

- `src` drops the `public/` prefix: `public/assets/hero.png` is `"assets/hero.png"`. Vite
  writes relative URLs (`base: "./"`), which portals require.
- Group bundles by when they are needed. Everything in the first `load()` sits in front of
  the first frame, and `pnpm test:verify` measures time to interactive.
- Pass `context.reportLoadingProgress` as `onProgress`. `main.ts` maps it into the portal's
  loading bar; profiles with `loading_api` treat a missing call as a rejection cause, and
  `pnpm facts` records it as `calls_loading_api`.
- The manifest is validated when the loader is constructed — a duplicate alias or an empty
  `src` is a startup error naming the file, not a texture that silently never appears.
- Audio files are not an asset kind: Pixi's `Assets` does not decode audio. Load sounds in
  `src/audio/`.

### Input

`Input` from `@wgf/game-core` maps keyboard and pointer to named actions. What an action
means stays in `src/game/`; this layer only reports which are held.

```ts
const input = new Input({
  surface: context.container,
  paused: () => context.game.paused,
  actions: {
    left: { keys: ["ArrowLeft", "KeyA"] },
    right: { keys: ["ArrowRight", "KeyD"] },
    jump: { keys: ["Space"] },
    pause: { keys: ["Escape", "KeyP"], whilePaused: true },
    tap: { pointer: true },
  },
});

// In the scene's update(), the fixed step:
const direction = input.axis("left", "right");
if (input.consumePressed("jump")) player.jump();
```

- Keys are `KeyboardEvent.code`, the physical key. Yandex 1.6.2.4 requires controls that
  survive a layout change, and `KeyA` is the key under A on QWERTY and under Q on AZERTY.
- Read one-shot controls with `consumePressed(action)` from `update()`. `onPressed(listener)`
  fires from the browser event, between frames — right for menus, wrong for the simulation,
  which may only advance in the fixed step.
- `paused: () => game.paused` is the whole pause wiring. Actions then do not fire and
  `held()` reports false while an ad, a hidden tab or the pause menu holds the game; the
  physical key stays tracked, so a control held across an ad break needs no fresh press.
  Give the control that ends the pause `whilePaused: true`.
- Keys that scroll a page (space, the arrows, page up/down) have their default cancelled
  when an action binds them — Yandex 1.10.2, and Poki's HTML5 guide for its iframe.
  `preventDefault` on the binding overrides it either way.
- `pointer` is `{ down, x, y, fractionX, fractionY }` in the surface's CSS pixels. Touch
  arrives through the same pointer events; there is no separate touch path.
- `bindElement(action, element)` makes an on-screen button a press source for an action —
  the mobile control scheme for a keyboard game. It returns its own unsubscribe, and
  `dispose()` removes it too.
- `dispose()` removes every listener and is safe to call twice — return it from
  `createGame`'s `GameHandle.dispose`.

**A game never edits `packages/`, `scripts/`, `src/main.ts`, `src/core/`, the template-owned
files in `src/platform/` and `src/game/`, the build and test configs, `game.config.yaml` or
`package.json` scripts.** The Factory refuses such a change. If the template lacks something
the game needs, report it: the fix goes into the template, where every later title inherits
it, not into one game.

## Working on the template itself

Changes to `packages/`, the boot path or the tooling are made here, in `web-game-template`,
and reach games by re-pinning. Anything that changes [factory-contract.md](factory-contract.md)
updates that page and `CHANGELOG.md`.

### Adding a platform

1. The profile comes first, in the Factory: `core/reference/platforms/<id>.yaml`.
2. Write the adapter under `packages/platform-sdk/src/adapters/`, declaring
   `PlatformCapabilities` that match the profile field for field, and wire it into
   `createPlatform` and `KNOWN_PLATFORM_IDS` in `packages/platform-sdk/src/registry.ts`.
3. Export it as a subpath (`./adapters/<id>`) in `packages/platform-sdk/package.json`, add
   its SDK URL signature to `packages/platform-sdk/sdk-signatures.json`, and add a
   `TARGET_ADAPTERS` entry in `scripts/build/game-config-plugin.ts`.
4. Add the id to `KNOWN_PLATFORM_IDS` in `src/core/game-config.ts` (and any required portal id
   to `REQUIRED_PORTAL_IDS`).
5. Add it to `tests/sdk/portals.ts` so it runs through the conformance scenarios.

`tests/unit/target-platform.test.ts` and `tests/unit/game-config-build.test.ts` fail when
these lists disagree.

## Conventions

- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `import type` for type-only imports — ESLint enforces it.
- Private class fields use `#name`, not `private`.
- Comments explain why. What the code does is already written down in the code.
