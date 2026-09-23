# GameVui compliance demo — Hứng Sao (Star Catcher)

A small PixiJS game built from the template's packages and packaged for submission to
[GameVui](https://gamevui.vn/). It exists to show what "targeting GameVui" can honestly mean
today, and to check it.

**GameVui publishes no SDK, no JavaScript API and no publishing API.** The only documented
route in is an email to the operator or its contact form. So this demo has no GameVui
adapter and calls no GameVui code: it is a platform-neutral web build, plus a package and a
report a person sends. See [docs/platforms/gamevui/](../../docs/platforms/gamevui/).

```
Game (src/)  →  @wgf/platform-sdk generic-web  →  dist/  →  release/gamevui/  →  email, by a person
```

## Run it

From the repository root:

```bash
pnpm install
pnpm --filter gamevui-compliance-demo dev          # http://localhost:5173
pnpm --filter gamevui-compliance-demo verify       # everything below, in order
```

| Step              | Command                | Output                                                                               |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| typecheck         | `pnpm typecheck`       | —                                                                                    |
| unit              | `pnpm test`            | rules, compliance registry, audit, packaging determinism                             |
| build             | `pnpm build`           | `dist/`, relative paths, no source maps                                              |
| e2e               | `pnpm test:e2e`        | `build/gamevui-demo/e2e-results.json` — desktop, phone portrait + landscape, tablet  |
| static audit      | `pnpm audit:build`     | `build/gamevui-demo/static-audit.json`                                               |
| package           | `pnpm package:gamevui` | `release/gamevui/{build,manifest}/`                                                  |
| compliance report | `pnpm compliance`      | `release/gamevui/submission-report.md`, `build/gamevui-demo/compliance-results.json` |

Run these inside `examples/gamevui-compliance-demo/`, or prefix with
`pnpm --filter gamevui-compliance-demo`. `build/` and `release/` are ignored by git.

The e2e suite needs Playwright's Chromium: `pnpm exec playwright install --with-deps chromium`.
It serves the build on port 4188 and refuses to reuse a server already listening there.

## What gets checked

Every requirement lives in [compliance/requirements.mjs](compliance/requirements.mjs) with its
basis — `OFFICIAL` (quoted from gamevui.vn), `INFERRED` (observed on the live site), `UNKNOWN`
(nothing published) or `LOCAL` (this repository's own rule). A requirement whose basis is
`UNKNOWN` is reported `UNKNOWN` whatever the demo measures; `resolveStatus` enforces that and
a unit test holds it there. Bundle size, frame rate and load time are measured and reported,
never compared against a limit GameVui has not published.

## What the package holds

```
release/gamevui/
  build/hung-sao-0.1.0.zip    dist/ contents, index.html at the root
  manifest/manifest.json      every entry with its size and SHA-256
  manifest/checksums.txt
  submission-report.md        requirements, results, manual checklist, cover-email draft
```

No `screenshots/` or `metadata/`: GameVui documents neither as required. The zip is
byte-identical across runs and time zones.

Before sending, fill `developer.name` and `developer.email` in
[gamevui.submission.json](gamevui.submission.json) and work through the manual checklist in
the report.

## The game

Move the basket to catch falling stars; three misses end the round. Mouse, keyboard (← →,
A/D) and touch. Vietnamese by default, `?lang=en` for English, `?seed=<n>` for a replayable
round. Everything is drawn from primitives — no image, font or audio files — so there is no
third-party asset to account for. The best score is the only thing stored, in
`localStorage`.
