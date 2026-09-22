# Release

A release is a numbered shipment of a title — `r1`, `r2`, and so on — and a title returns to
`releasing` for every one of them, hotfixes included.

## The directory

```
release/<release-id>/
  manifest.json            — the immutable record
  <platform>.zip           — one package per targeted platform
  checksums.txt
  packages.json            — sizes and checksums, input to the manifest
  publications/<id>.json   — one per platform, carrying its assertion results
```

Not committed. A release is recorded by its GitHub Release assets and its workflow artifact;
committing generated files back to the branch invites someone to edit one.

## Freezing

At the release-candidate stage the manifest becomes immutable: a fixed commit, fixed
packages, checksums for each, and a `frozen_at` timestamp. **Any change produces a new
release, never an edit to this one.**

That is what makes a rollback cheap. Rolling back is republishing a known-good manifest, not
rebuilding from a tag and hoping the result matches.

## Running one

```bash
git tag v1.2.0 && git push origin v1.2.0
```

`release.yml` then runs CI, runs the verify suite, builds, packages per platform, evaluates
each platform's assertions, writes the manifest and publications, and opens a **draft**
GitHub Release. A draft because publishing the GitHub Release is itself a publication, and
publication is gate G6.

By hand, the same sequence is:

```bash
pnpm build
pnpm test:verify                                   # measure runtime facts
pnpm facts  --platform generic-web                 # merge static + runtime facts
pnpm assert --platform generic-web --out build/assertions/generic-web.json
pnpm release:package  --release r1
pnpm release:manifest --release r1 --version 1.2.0 --state rc
pnpm publish:prepare  --release r1
```

## Release ids

`release.yml` derives `r<n>` by counting the GitHub Releases that already exist, so the
numbering stays monotonic without anyone storing a counter. A release deleted from GitHub
will cause the next one to reuse its number — delete tags, not releases.

## Validating a manifest

The schemas live in the Factory. From the workspace root, with both repositories checked out
side by side:

```bash
npx --yes -p ajv-cli@5 -p ajv-formats@2 ajv validate \
  -s web-game-factory/core/artifacts/release-manifest.schema.json \
  -r "web-game-factory/core/artifacts/shared/*.schema.json" \
  -c ajv-formats --spec=draft2020 --strict=false \
  -d web-game-template/release/r1/manifest.json
```

Both flags are required: `--strict=false` because `x-wgf` is a custom keyword, and
`-c ajv-formats` because the schemas use `format: date-time`.

## What the manifest cannot pin yet

`provenance.inputs[]` is empty. The governed inputs to a release — the tech plan and the game
design — live in the Factory's workspace, not in the game repository, so CI has nothing to
hash. What CI can pin, it does: `commit_sha`, and `target_platforms[].profile_version` for
every target. The Factory fills `inputs[]` when it records the release against the title.
