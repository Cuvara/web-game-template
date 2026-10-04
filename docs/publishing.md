# Publishing

Publication is irreversible. Portals cache and index what they receive, so there is no
meaningful undo — which is why it is gate G6, why G6 never auto-approves, and why nothing in
this repository can publish, by being pushed to or by being dispatched.

## Who publishes

**Not CI.** CI builds, tests, verifies and packages: `release.yml` ends at a frozen
`release/r<n>/` directory (packages, `packages.json`, checksums, `manifest.json`), a workflow
artifact and a **draft** GitHub Release. Nothing after that runs in this repository.

Publication to a portal is done by the Factory's publisher (web-game-factory,
`docs/portal-publishing-architecture.md`). A person logs in to the portal live and authorizes
the upload and the submission; the publisher writes the `platform-publication` record from the
release the person approved at G6.

| Platform      | Upload and submission                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| Poki          | the Factory's publisher, a person logged in                                            |
| Yandex Games  | the Factory's publisher, a person logged in                                            |
| CrazyGames    | the Factory's publisher, a person logged in                                            |
| GameVui       | email or contact form, see [platforms/gamevui](platforms/gamevui/platform-contract.md) |
| Other portals | the Factory's publisher, a person logged in                                            |
| Generic Web   | n/a — self-hosted                                                                      |

## What this repository does not contain

- No publish workflow, no `production` environment, no `publish:prepare` script.
- No portal CLI (`@poki/cli` or any other), no upload or submit call to a portal API.
- No portal credential: no Poki `auth.json`, no portal token, no console session — not in the
  repository, not in its workflows, not in the organization's secrets. CI has no step that
  could use one.

Portal **ids** a build bakes into the bundle (`WGF_Y8_APP_ID`, `WGF_Y8_GAME_ID`,
`WGF_GAMEMONETIZE_GAME_ID`, or `game_id` / `app_id` in `game.config.yaml`) are not
credentials: they ship publicly in the game. The Cloudflare Pages preview of the `develop`
channel (`build.yml`) is not portal publishing either.

## What the release hands the publisher

Each `<platform>.zip` is that platform's own build, deterministic and checksummed, with the
platform's facts and assertion results measured in CI. The publisher validates against the
pinned profile and builds the submission checklist from it: required locales, screenshot
minimum, icon and age rating, and every entry in the profile's `common_rejections`.

## Waiting and rejection

`in-review` can last days — `review.typical_days` per profile says roughly how many. A
rejection updates the profile in the Factory (`new-assertion`, `common-rejection-entry`,
`requirement-change`, or `none-needed`) so the same wall is not hit by every future title.
Both are recorded by the Factory, not here.
