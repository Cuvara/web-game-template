# Release-1 boot bridge (temporary)

The golden-run ports implement the template's **contract 2**: each supplies
`src/game/index.ts` (`createGame(context)`) and never `src/main.ts`. The Web Game Factory,
however, creates its games from the template **release** it pins (`v1.2.0`), which is still
contract 1: its `src/main.ts` boots the template's own `BootScene`, there is no
`src/game/context.ts`, and the Factory's develop step requires main.ts to boot through its
seam (`createGamePlatform()` / `createGameIntegration()` from `src/platform/integration.ts`).

This directory bridges the two. The Factory's replay developer
(`scripts/golden/replay_developer.py`) applies it **only when the game repository has no
`src/game/context.ts`** - detected, never assumed - and records in the development report that
it did:

- `src/main.ts` - the release's boot order line for line, with the Factory's seam lines in
  place of `createPlatform`, and the boot scene replaced by `createGame` with the
  `GameContext` contract 2's main.ts builds (viewport, resize listeners, loading progress
  between renderer init and ready, one mute state from `bindPlatform` and the integration's
  ad breaks);
- `src/game/context.ts` - contract 2's `GameContext`, narrowed to what a contract-1 repository
  has before the Factory's `sdk` step: `integration` is the develop step's seam and
  `gameplay` exposes only the running platform's `gameplayActive`.

It is skipped when the ports are assembled onto this template (`scripts/verify/golden-check.mjs`)
or onto any contract-2 game. Remove it when the Factory moves its release pin to a contract-2
template release; nothing else depends on it.
