# Development Guide

## Setup

Node 20 or newer, and pnpm 9.

```bash
corepack enable pnpm      # or: npm i -g pnpm@9
pnpm install
pnpm dev                  # http://localhost:5173
```

`corepack enable` writes shims next to the Node binary and needs an elevated shell on
Windows; `npm i -g pnpm@9` does not.

## Commands

| Command                             | Does                                        |
| ----------------------------------- | ------------------------------------------- |
| `pnpm dev`                          | Vite dev server with HMR                    |
| `pnpm build`                        | build every package, then bundle to `dist/` |
| `pnpm preview`                      | serve the built bundle                      |
| `pnpm typecheck`                    | `tsc -b` across the workspace               |
| `pnpm lint`                         | ESLint                                      |
| `pnpm format` / `pnpm format:write` | Prettier check / write                      |
| `pnpm test`                         | unit + integration (Vitest)                 |
| `pnpm test:e2e`                     | Playwright against the built bundle         |

`pnpm build` is what `game.config.yaml` names as `build.command`, and `dist` is its
`build.output`. Changing either here without changing it there detaches the repository from
the plan.

## Where code goes

Add to `src/` when it is this game. Add to `packages/` when the next game would want it
too. If you are about to write something in `src/` that another title would obviously need,
it belongs in a package — and if the template is missing something the plan needs, fix the
template rather than patching around it in the game, or every future title inherits the gap.

Engine-specific game code goes in `src/rendering/pixijs/` or `src/rendering/threejs/`.
Nothing else in `src/` imports `pixi.js` or `three`.

## Adding a platform

1. The profile comes first, in the Factory: `core/reference/platforms/<id>.yaml`.
2. Add the id to `KNOWN_PLATFORM_IDS` in `packages/platform-sdk/src/registry.ts`.
3. Write the adapter under `packages/platform-sdk/src/adapters/`, declaring
   `PlatformCapabilities` that match the profile field for field.
4. Wire it into `createPlatform`.

An id with no adapter throws at startup on purpose. Silently degrading to no-ads ships a
title that thinks it has a portal SDK and does not, which is a blocking assertion failure at
release validation.

## Conventions

- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `import type` for type-only imports — ESLint enforces it.
- Private class fields use `#name`, not `private`.
- Comments explain why. What the code does is already written down in the code.
