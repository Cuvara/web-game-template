# How this baseline was made

Captured 2026-10-01 from a production build of a game repository the Factory's 2D golden run
created, with this port laid on it by the Factory's own replay developer and its assets built
from `../library` by the Factory's own assets CLI. Every screenshot is of that running build,
reached through real input only (mouse on desktop, touch on the Pixel 5 profile).

1. `python3 scripts/golden/run.py --game 2d --workdir /tmp/wgf-ref2d/run1 --keep` (Factory
   worktree `agent-assets-2d`, lock: template v1.2.0, ports 1c5afcb) - the game repository
   `games/tower-merge-rush`, cloned to a scratch checkout.
2. `python3 scripts/golden/replay_developer.py --game 2d --brief docs/development/brief.md
--repo <checkout> --ports <this template worktree>` - the port overlay, as a golden run
   lays it (then `library/` and `baseline/`, which the overlay also copies, removed).
3. `python3 scripts/wgf-assets.py build --design <game-design> --root <checkout> --library
examples/tower-merge-rush/wgf-golden/library` with the drop-merge golden design (the
   `agent-game-design-ui` Factory worktree's design step: roles and a backdrop) - 8 of 8 assets
   `delivered`, quality `pass` (fonts: no 2D check), production-ready;
   `wgf-assets.py validate` - 0 errors, 0 warnings.
4. In the checkout: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (671 passed), `pnpm build`,
   and the browser suites on desktop and mobile with portal requests refused (28 passed,
   including the art guard in `tests/e2e/tower-merge-rush.spec.ts`).
5. `vite preview` of `dist/`, then `node baseline/capture.mjs http://localhost:4310/ baseline`.

`<viewport>/probe.json` holds the play probe's snapshot at each screenshot (every tower
`render: "asset"` with its runtime asset id; `assets_loaded` lists all 24 manifest ids);
`<viewport>/network-assets.json` every `/assets/` response (all 200) and the one failed request,
the portal SDK, refused on purpose.
