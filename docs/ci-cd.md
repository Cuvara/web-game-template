# CI/CD

Seven workflows. Two of them are named by the Factory as implementing a lifecycle guard;
two are gates wearing a GitHub environment; the rest move artifacts around.

| Workflow        | Trigger                      | What it is                           |
| --------------- | ---------------------------- | ------------------------------------ |
| `ci.yml`        | every push, forked PRs       | the `ci_green` guard                 |
| `build.yml`     | push to `develop`, or called | build + develop preview deploy       |
| `verify.yml`    | PR into `main`, or called    | the `verify_suite_green` guard       |
| `release.yml`   | tag `v*`, or dispatch        | freeze a candidate. Does not publish |
| `publish.yml`   | dispatch only                | gate **G6**                          |
| `campaign.yml`  | dispatch only                | gate **G7**                          |
| `bootstrap.yml` | first push in a new repo     | one-time setup, then deletes itself  |

## The two channels

**develop** — push to `develop`, get a Cloudflare Pages deployment. No gate, no release id,
no manifest. It exists so the game can be played.

**release** — tag `v1.2.0`, get CI, the verify suite, per-platform packages, an immutable
manifest with checksums, and one publication record per platform. Then it stops, as a draft
GitHub Release.

It is the same build in both. A develop build that differs from a release build is a develop
build that proves nothing.

## Guards

`ci_green` — lint, typecheck, unit, integration. Sits on three transitions in the title
machine, so it stays fast and stays about the source.

`verify_suite_green` — read at exactly one place, gate G5. Builds, runs the smoke suite
against the built bundle, measures package facts, and evaluates each targeted platform's
assertions. Everything in it runs against artifacts, never the dev server.

## How a platform assertion is evaluated

Each profile carries `assertions[]` like `{left: package.size_mb, op: lte, right: 100}`.
Twelve distinct fact paths appear across the five profiles, and **every blocking one is
measurable on a GitHub runner**. Three warnings need a proxy.

Facts come from three places, and which is which matters:

- **Static** — `size_mb` from `dist`, `locales` from the locale files actually in the
  bundle, `platform_sdk` from the build target.
- **Runtime** — `insecure_requests`, `external_links`, `calls_loading_api`,
  `mobile_supported`, `perf.*`, measured by the Playwright `verify` project driving the
  built bundle. `perf.lowend_android_fps` is a CPU-throttled desktop run: a proxy for a
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

## Gates are environments

`publish.yml` runs in the `production` environment and `campaign.yml` in `campaign-spend`.
Put **required reviewers** on both. GitHub then holds the job until a human approves and
records who did — which is G6 and G7 made real.

An environment with no reviewers is not a gate, and this is a trap rather than an oversight:
GitHub creates an environment **implicitly, with no protection**, the first time a job names
one. A workflow can say `environment: production`, run unimpeded, and look gated. So both gate
workflows read their environment's protection rules as their first step and **refuse to run**
when there are no required reviewers.

`bootstrap.yml` creates all three environments in a new repository and seeds the person who
pushed as the reviewer, so the gap never exists.

> **Required reviewers are unavailable on private repositories under a free plan.** A private
> game repository on a free organization cannot enforce G6 or G7 through environments. The
> options are to make the repository public, upgrade the plan, or accept that publication is
> guarded by convention — and in the third case both gate workflows will refuse to run, which
> is the intended outcome for an irreversible action.

## Publishing is not automated, and mostly cannot be

The Factory's publish stage says no portal APIs are integrated, by design. Independently of
that, it is also the state of the world: of the platforms in the profile set, only Poki has
a CLI that runs headlessly. Yandex, CrazyGames and GameVui accept a ZIP through a console a
person logs into.

So `publish.yml` uploads to Poki when `WGF_POKI_AUTH_JSON` is set, and for everything else
produces the package and a checklist built from that platform's own profile — its required
locales, its screenshot minimum, its past rejection reasons. Uploading to Poki is not
releasing on Poki either; requesting review stays a human action.

## Secrets and variables

Organization-scoped, prefixed `WGF_`, visible only to selected repositories so nothing here
touches the organization's other secrets. Managed by
`web-game-factory/scripts/wgf-org-setup.sh`.

An unset secret holds the sentinel `__UNSET__`. Workflows check for it, skip the step, and
say so in the run summary — a missing credential should not look like a broken pipeline.

Values you have not set yet are safe to leave: the build still succeeds and attaches its
artifact.

## New repositories from the template

`bootstrap.yml` runs on the first push, using a GitHub App installed in the organization. It
grants the repository access to the `WGF_*` organization secrets, copies the `WGF_*`
organization variables down to repository level, sets `GAME_ID` and `GAME_NAME` from the
repository name, rewrites `game.config.yaml`, and deletes itself.

**Secrets are not copied, and cannot be** — GitHub never returns a secret's value through
its API. They are inherited from the organization. To override one for a single game, add a
repository secret with the same name; the lower level wins.

The push event fires on a repository created from a template, but is
[documented to fire twice](https://github.com/orgs/community/discussions/50356), so every
step is idempotent and the workflow checks whether it has already run.
