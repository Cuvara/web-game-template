# Golden-run port — shared files

Not an example and not a workspace package (it has no `package.json`). These are the files
both golden-run ports share — a small audio service (`src/audio/audio.ts`) and
`src/game/after-ready.ts` (work deferred until main.ts has signalled ready and installed its
probe) — laid out as they sit in a generated game. There is no default `GameIntegration` implementation any more: the
template's main.ts hands every game `PlatformGameIntegration` through
`GameContext.integration` (see `src/game/context.ts`).

The Web Game Factory's golden regression runs copy this directory onto the root of a game
repository created from this template, before the game-specific port
(`examples/tower-merge-rush/wgf-golden/` or `examples/neon-drift-arena/wgf-golden/`); see
their READMEs. The imports are relative to that layout, so the root `tsconfig.json` excludes
this directory: it is typechecked inside the generated game, by the Factory's develop step.

`release-1/` is not copied with the rest: it is the temporary boot bridge the Factory's replay
applies only to a game created from a contract-1 template release (see `release-1/README.md`).
`library/` holds the audio rendering tools, never game files either.
