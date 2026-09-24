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
