# Runtime baseline

Frames of the built game, played - not rendered offline, not mocked. How they were made:

1. A golden 3D run of the Factory (`python3 scripts/golden/run.py --game 3d --keep`) created
   and built the game repository from the pinned template; this port was laid onto that
   checkout exactly as the replay developer lays it (`port_files` + `seam_main`).
2. `public/assets/assets.json` was written by the Factory's asset CLI from `../library/`
   (`scripts/wgf-assets.py build --library library --dimension 3d`), against a design whose
   `build_spec.assets` carry the arena-dodge archetype's roles.
3. `pnpm build`, then `vite preview` of `dist/`, played in headless Chromium (WebGL through
   SwiftShader) on a 1280x720 desktop and a Pixel 5 (touch) by a Playwright script using real
   input only - mouse clicks and arrow keys on desktop, taps and held touches (CDP touch
   events) on the phone - following the play probe's `?wgf-probe=1` oracle to dodge, and
   steering into a wall to crash. External requests were aborted, as in the game's own browser
   suite.

| Frame           | State                                                              |
| --------------- | ------------------------------------------------------------------ |
| `title`         | title screen: wordmark, rules, the Drive button, the arena behind  |
| `playing`       | play, walls coming down the track                                  |
| `steer`         | mid-steer, the craft banking                                       |
| `close-wall`    | a wall level with the craft, a little over a craft's width away    |
| `near-miss`     | the "close call" call-out after a wall passed close                |
| `crash`         | the frame after the crash: burst and flash, before the result card |
| `game-over`     | the result card (score, best, race again)                          |
| `retry-playing` | playing again after Race Again                                     |
| `paused`        | the pause card, from the pause button                              |

`<viewport>/evidence.json`: every `/assets/` response (status and path) and the play probe's
snapshot at each frame - each craft and wall entity with its manifest asset and
`render: "asset"`, and `assets_loaded`. The one console error is the aborted portal SDK
request.

`production-gate/`: the Factory's production-quality gate (branch integration-2.6) run for
real on this port - `gate.py.txt` is the harness (the lead's `drive.py`, adapted): a golden 3D
run's game checkout and design, the port overlaid and committed, `public/assets/` written by the
real `AssetsStep` with `library/` configured, then the real `PlayabilityStep` (bot on desktop
1280x720 and Pixel 5, behind the refusing proxy) and `ProductionQualityStep`.
`playability-report.json` (24/24 PASS), `production-quality-report.json` (PASS, both
viewports), `asset-manifest.items.json`, and the state frames the gate measured the UI on
(`<viewport>/state-*.png`). `production-quality-report.unassessed-manifest.json`: the same
gate on the manifest exactly as the assets step wrote it - it fails only `assets.present`,
because the step records a library GLB's quality as `skipped`; the harness fills that in with
the Factory's own `model_quality.assess` (see the port README).
