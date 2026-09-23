# Production build policy

What `pnpm build` and the release scripts emit, and why a portal submission is
safe to upload.

## Sourcemaps

`vite.config.ts` sets `sourcemap: "hidden"`: `.map` files are still written to
`dist/assets/` for local debugging, but the `//# sourceMappingURL=` comment is
**stripped** from the shipped `.js`, so a portal browser never auto-fetches a
map even if one leaked.

The release packager (`scripts/release/package.mjs`) zips `dist/` **file by
file, excluding `*.map`**. A submission therefore contains no sourcemaps — no
~4.3 MB of map payload and no source exposure on a public portal. Verify:

```bash
pnpm build && pnpm release:package --release r1
unzip -l release/r1/<platform>.zip | grep -c '\.map'   # → 0
```

## Bundle composition

Measured for a `generic-web`, `pixijs` build:

| Slice | Raw | Gzip | In initial download? |
|---|---|---|---|
| Entry chunk | ~50 KB | ~13 KB | yes |
| 3 unused portal adapters (of 4) | ~30 KB | ~7 KB | yes (in entry) |
| Unused engine (three.js for a pixijs game) | ~452 KB | ~116 KB | **no** — lazy chunk, never fetched |
| Total JS (all chunks) | ~1.0 MB | ~268 KB | — |
| Release zip (maps excluded) | — | ~0.27 MB | — |

- **Engines are already tree-split.** `create-renderer.ts` dynamic-imports the
  chosen framework, so the unused engine is emitted as a lazy chunk and never
  loaded at runtime. It costs disk/zip size, not initial download.
- **All four portal adapters are currently bundled.** `registry.ts` uses static
  imports plus a runtime `switch`, which defeats tree-shaking; the cost is small
  (~7 KB gzip in the entry). Removing it is a **deferred** optimization:
  selecting the adapter via a build-time `import()` would force
  `createPlatform` to become async and ripple through every synchronous caller
  and the conformance/`toBeInstanceOf` tests. Do it as a dedicated change with
  its own test pass, not as a drive-by. See the audit under `docs/audits/`.

## Release artifact

`release/<release-id>/`:

- `<platform>.zip` — `dist/` **contents** at the archive root (not a `dist/`
  folder); Yandex requires `index.html` at root.
- `checksums.txt`, `packages.json`, `publications/<platform>.json`.
- `manifest.json` — conforms to the Factory `release-manifest.schema.json`.
  `provenance.inputs` is intentionally empty; the Factory fills it when it
  records the release (tech-plan / game-design inputs live there, not here).

```bash
pnpm release:package  --release r1                 # zips + checksums
pnpm release:manifest --release r1 --version 1.0.0 # immutable manifest
```

Both scripts read `game.config.yaml` for `game.id`, `platforms[]` (and their
pinned `profile` versions), and `build.output`.
