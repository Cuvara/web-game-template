# Web Game Template

Reusable template repository for web games produced by the **Web Game Factory**.

> This repository is currently a scaffold and does not contain the Web Game Factory implementation.

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

| Workflow | Purpose |
|----------|---------|
| `ci.yml` | Lint, type-check, and test on every push/PR |
| `build.yml` | Production builds for target platforms |
| `verify.yml` | Smoke tests, performance benchmarks, mobile checks |
| `release.yml` | Versioning, changelog, artifact packaging |
| `publish.yml` | Platform-specific packaging and portal submission |
| `campaign.yml` | Campaign metadata and analytics setup |

All workflows are currently placeholder files.

## Platform Abstraction

The template abstracts platform-specific APIs behind a common interface:

- **Yandex Games**
- **CrazyGames**
- **GameVui**
- **Generic Web**

Platform configuration lives in `config/platforms/`.

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

**Scaffold only.** No functionality has been implemented. This structure will be populated in future implementation phases.
