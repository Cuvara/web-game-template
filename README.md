# Web Game Template

Reusable template repository for web games produced by the **Web Game Factory**.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # unit + integration
pnpm build      # packages, then dist/
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit, and
[docs/development.md](docs/development.md) for working in it.

## Purpose

This template provides the common technical foundation from which individual web game projects are created. Each game produced by Web Game Factory starts as a clone of this template and is customized for its specific genre, mechanics, and target platforms.

## Relationship with Web Game Factory

```
web-game-factory          (orchestration & AI workflows)
       |
       | creates project from
       v
web-game-template         (this repo — shared game foundation)
       |
       | cloned into
       v
actual game repository    (e.g., Cooking Rush, Puzzle Quest)
```

The Factory orchestrates game creation. This template provides the technical starting point. The Factory does **not** contain individual game source code.

## Engine Support

### PixiJS (2D)

- 2D rendering foundation
- Sprite management
- Animation system
- Particle effects

### Three.js (3D)

- 3D rendering foundation
- Scene management
- Model loading (GLB/GLTF)
- Compressed textures (KTX2)

Engine selection is configured in `game.config.yaml`.

## CI/CD Infrastructure

GitHub Actions workflows provide:

| Workflow       | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `ci.yml`       | Lint, type-check, and test on every push/PR        |
| `build.yml`    | Production builds for target platforms             |
| `verify.yml`   | Smoke tests, performance benchmarks, mobile checks |
| `release.yml`  | Versioning, changelog, artifact packaging          |
| `publish.yml`  | Platform-specific packaging and portal submission  |
| `campaign.yml` | Campaign metadata and analytics setup              |

All workflows are currently placeholder files.

## Platform Abstraction

Game code calls `@wgf/platform-sdk` and never a portal SDK directly. Each platform has a
profile in the Factory (`core/reference/platforms/<id>.yaml`) and an adapter here.

| Platform     | Profile | Adapter         |
| ------------ | ------- | --------------- |
| Generic Web  | ✅      | ✅              |
| Yandex Games | ✅      | not written yet |
| Poki         | ✅      | not written yet |
| CrazyGames   | ✅      | not written yet |
| GameVui      | ✅      | not written yet |

An id with a profile but no adapter throws at startup rather than silently degrading.

## Testing Architecture

```
tests/
  unit/          — Fast, isolated unit tests
  integration/   — Cross-module integration tests
  e2e/           — Playwright end-to-end tests
```

Test configuration: `playwright.config.ts` (E2E), standard test runner for unit/integration.

## Publishing Architecture (Future)

The template will support automated publishing to multiple game portals:

1. Build the game for a target platform
2. Run verification (smoke, performance, mobile)
3. Package with platform-specific metadata
4. Submit to the portal
5. Verify post-publish status

## Project Structure

```
web-game-template/
  .github/workflows/    — CI/CD pipeline definitions
  src/                  — Game source code
    core/               — Core game systems
    game/               — Game-specific logic
    rendering/          — PixiJS and Three.js renderers
    ui/                 — UI components
    audio/              — Audio system
    input/              — Input handling
    assets/             — Asset loading and management
    platform/           — Platform abstraction layer
    analytics/          — Analytics abstraction
  packages/             — Shared workspace packages
  tests/                — Unit, integration, and E2E tests
  public/               — Static assets and metadata
  config/               — Platform, performance, environment configs
  scripts/              — Build, verify, release, publish scripts
  docs/                 — Documentation
  game.config.yaml      — Game configuration
```

## Status

**Foundation implemented.** `pnpm build`, `pnpm test` and `pnpm test:e2e` all run green on
the untouched template.

| Area                                                  | State              |
| ----------------------------------------------------- | ------------------ |
| `@wgf/game-core` — loop, scenes, events, pause        | done               |
| `@wgf/platform-sdk` — abstraction, ad policy, storage | done               |
| `@wgf/analytics-sdk`                                  | done               |
| `@wgf/pixi-framework`, `@wgf/three-framework`         | done               |
| `game.config.yaml` load + validation                  | done               |
| Unit, integration, e2e smoke                          | done               |
| Portal adapters (yandex, poki, crazygames, gamevui)   | not written        |
| Six GitHub Actions workflows                          | still comment-only |
| `scripts/`, `config/`, asset and audio pipelines      | empty              |
