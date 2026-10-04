# CI/CD

Six workflows. Two of them are named by the Factory as implementing a lifecycle guard; one
is a gate wearing a GitHub environment; the rest move artifacts around.

**CI builds, tests and packages. It never publishes a game to a portal.** Publication (gate
G6) is the Factory's publisher (web-game-factory, `docs/portal-publishing-architecture.md`),
with a person logging in to the portal and authorizing the upload and the submission. No
portal credential belongs in this repository, its workflows or the organization.

| Workflow        | Trigger                      | What it is                           |
| --------------- | ---------------------------- | ------------------------------------ |
| `ci.yml`        | every push, forked PRs       | the `ci_green` guard                 |
| `build.yml`     | push to `develop`, or called | build + develop preview deploy       |
| `verify.yml`    | PR into `main`, or called    | the `verify_suite_green` guard       |
| `release.yml`   | tag `v*`, or dispatch        | freeze a candidate. Does not publish |
| `campaign.yml`  | dispatch only                | gate **G7**                          |
| `bootstrap.yml` | first push in a new repo     | one-time setup, then deletes itself  |

Outside the six, `crazygames.yml`, `yandex-demo.yml` and `gamevui-demo.yml` build, audit and
browser-test the template's compliance examples, and `live-portal-validation.yml` runs the
opt-in live SDK checks (`pnpm test:sdk:live`). They guard the adapters; none is a gate.

## The two channels

**develop** — push to `develop`, get a Cloudflare Pages deployment. No gate, no release id,
no manifest. It exists so the game can be played.

**release** — tag `v1.2.0`, get CI, the verify suite, per-platform packages, an immutable
manifest with checksums, and each platform's assertion results. Then it stops, as a draft
GitHub Release. Nothing after that runs in CI.

It is the same build in both. A develop build that differs from a release build is a develop
build that proves nothing.

## Guards

`ci_green` — lint, typecheck, unit, integration, SDK conformance and `pnpm sdk:check` (the
boot wiring). Sits on three transitions in the title machine, so it stays fast and stays
about the source. A separate `golden` job in `ci.yml` runs `scripts/verify/golden-check.mjs`
when the checkout has golden ports (`examples/wgf-golden-shared`), so a template change that
breaks the Factory's golden games fails in its own pull request.

`verify_suite_green` — read at exactly one place, gate G5. Builds, runs the smoke suite and
the SDK browser matrix against the built bundle, measures package facts, and evaluates each
targeted platform's assertions. Everything in it runs against artifacts, never the dev server.

`release.yml` builds every platform separately (`pnpm build:platforms`) and re-measures each
build before packaging it: a platform ships only its own adapter, so one `dist/` cannot be
packaged for every portal.

## How a platform assertion is evaluated

Each profile carries `assertions[]` like `{left: package.size_mb, op: lte, right: 100}`,
evaluated against facts measured on a GitHub runner; a few warnings need a proxy.

Facts come from three places, and which is which matters:

- **Static** — `size_mb` from the platform's own build (`build/platforms/<id>/dist`, else
  `dist/`), `locales` from the locale files actually in the bundle, `platform_sdk` from a
  scan of the shipped files for every portal's SDK signature
  (`packages/platform-sdk/sdk-signatures.json`): exactly one portal, `none`, or `mixed:…`.
- **Runtime** — `insecure_requests`, `external_links`, `calls_loading_api`,
  `mobile_supported`, `perf.*`, measured by the Playwright `verify` project driving each
  platform's built bundle (`build/runtime-facts/<id>.json`). `perf.lowend_android_fps` is a CPU-throttled desktop run: a proxy for a
  low-end device, not a measurement of one, which is why that assertion is a warning.
- **Declared** — `uses_banner_ads` and `uses_rewarded_ads` come from
  `monetization.ad_kinds` in `game.config.yaml`, not from observation. A run can prove an ad
  was requested; it can never prove one is never requested, and on GameVui
  `uses_rewarded_ads` is blocking. The observation is still taken, as a cross-check: code
  that requests an undeclared ad kind fails the build.

The profile is read from `config/platforms/`, at the version `game.config.yaml` pins.
Validating against the current profile instead of the pinned one is a named failure mode —
a build must be judged by the rules in force when its plan was approved.

An assertion that cannot be evaluated counts as breached. A fact nobody measured must not
satisfy a blocking rule by omission.

## G7 is an environment; G6 is not in CI

`campaign.yml` runs in the `campaign-spend` environment. Put **required reviewers** on it.
GitHub then holds the job until a human approves and records who did — which is G7 made real.

An environment with no reviewers is not a gate, and this is a trap rather than an oversight:
GitHub creates an environment **implicitly, with no protection**, the first time a job names
one. A workflow can say `environment: campaign-spend`, run unimpeded, and look gated. So
`campaign.yml` reads its environment's protection rules as its first step and **refuses to
run** when there are no required reviewers.

`bootstrap.yml` creates `develop` and `campaign-spend` in a new repository and seeds the
person who pushed as the `campaign-spend` reviewer, so the gap never exists. There is no
`production` environment: no workflow publishes, so there is nothing for one to hold.

> **Required reviewers are unavailable on private repositories under a free plan.** A private
> game repository on a free organization cannot enforce G7 through an environment. The options
> are to make the repository public, upgrade the plan, or accept that spend is guarded by
> convention — and in the third case `campaign.yml` refuses to run, which is the intended
> outcome for an irreversible action.

## Publishing is not CI's job

Publication is irreversible: portals cache and index what they receive. It is the Factory's
publisher, driven by a person who logs in to each portal console and authorizes the upload and
the submission. There is no `publish.yml`, no Poki CLI upload, no `publish:prepare` script and
no portal token or session in CI. See [publishing.md](publishing.md).

## Secrets and variables

Organization-scoped, prefixed `WGF_`, visible only to selected repositories so nothing here
touches the organization's other secrets. Managed by
`web-game-factory/scripts/wgf-org-setup.sh`.

What CI reads, and all a new repository is given:

- secrets — `WGF_CF_API_TOKEN` (develop preview deploy) and `WGF_LIVE_OPT_IN` (opt-in live
  SDK checks);
- variables — `WGF_CF_*` (Cloudflare account and project prefix) and the portal **ids** a
  build bakes in: `WGF_Y8_APP_ID`, `WGF_Y8_GAME_ID`, `WGF_GAMEMONETIZE_GAME_ID`. An id is
  public — it ships in the bundle — and is not a credential.

**No portal credential** (a Poki `auth.json`, a portal token, a console session) belongs in
the repository or the organization. CI has no step that could use one.

An unset secret holds the sentinel `__UNSET__`. Workflows check for it, skip the step, and
say so in the run summary — a missing credential should not look like a broken pipeline.

Values you have not set yet are safe to leave: the build still succeeds and attaches its
artifact.

## New repositories from the template

`bootstrap.yml` runs on the first push, authenticating as the organization's bot app through
the `APP_ID` and `APP_PRIVATE_KEY` organization secrets. It grants the repository access to
the allowlisted `WGF_*` organization secrets above, copies the allowlisted `WGF_*` variables
down to repository level, creates `develop` and `campaign-spend` (the pusher as the
`campaign-spend` reviewer), sets `GAME_ID`
and `GAME_NAME` from the repository name, rewrites `game.config.yaml`, and deletes itself.

Those two app secrets are the single place a game pipeline reads something outside the `WGF_*`
namespace, and it has to be that way round: a repository created from the template is on no
selected-repository list until bootstrap puts it on one, so the credential it starts with must
already be visible to it.

**Secrets are not copied, and cannot be** — GitHub never returns a secret's value through
its API. They are inherited from the organization. To override one for a single game, add a
repository secret with the same name; the lower level wins.

The push event fires on a repository created from a template, but is
[documented to fire twice](https://github.com/orgs/community/discussions/50356), so every
step is idempotent and the workflow checks whether it has already run.
