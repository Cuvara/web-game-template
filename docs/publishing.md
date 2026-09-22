# Publishing

Publication is irreversible. Portals cache and index what they receive, so there is no
meaningful undo — which is why it is gate G6, why G6 never auto-approves, and why nothing in
this repository can publish by being pushed to.

## What is automated, and what is not

| Platform     | Upload                        | Requesting review |
| ------------ | ----------------------------- | ----------------- |
| Poki         | automated (`@poki/cli`)       | manual            |
| Yandex Games | manual — no public upload API | manual            |
| CrazyGames   | manual — no public upload API | manual            |
| GameVui      | manual — no public upload API | manual            |
| Generic Web  | n/a — self-hosted             | n/a               |

This is not a gap waiting to be filled. The Factory's publish stage states that no portal
APIs are integrated by design, on the grounds that building four portal integrations before
the contracts are proven is premature. The table above is also simply what exists: three of
the four portals accept a ZIP through a console a person logs into.

## Running a publish

```
Actions → Publish → Run workflow
  release_id: r1
  confirm:    r1
```

The job runs in the `production` environment. With required reviewers configured, GitHub
holds it until a human approves, and records who. That is the gate.

Before doing anything it re-reads each `publications/<platform>.json` and refuses to
continue if any is `validation-failed` — so dispatching this workflow directly cannot route
around a failed candidate.

Then, per platform: upload to Poki if `WGF_POKI_AUTH_JSON` is set, and otherwise print a
checklist into the run summary and attach the package.

## The checklist is generated from the profile

Not a generic list — a generic checklist is one nobody reads. Each item comes from that
platform's own profile: its required locales, its screenshot minimum, whether it wants an
icon or an age rating, and every entry in its `common_rejections`.

That last part is the Factory's memory. When a portal rejects something, the reason is
appended to the profile, and from then on it appears in the checklist for every future
submission to that portal.

## Waiting

`in-review` can last days — `review.typical_days` per profile says roughly how many. Nothing
here can accelerate portal moderation. The state exists so that waiting is visible rather
than mistaken for being finished.

## Rejection

A rejection is not just a status change. The publication record requires a
`rejection.compliance_finding` with a `profile_update`, which is one of `new-assertion`,
`common-rejection-entry`, `requirement-change`, or `none-needed` — and then the profile's
version is bumped in the Factory.

Recording a rejection without updating the profile is how the same wall gets hit by every
future title.

## Credentials

Portal credentials live in the organization's `WGF_*` secrets and are referenced, never
committed and never printed into a log or an artifact. Note that most portal SDKs need no
key at all — they are CDN scripts. The only real credential in the set is the Poki CLI's
`auth.json`, captured once on a developer machine because its login is a browser flow.
