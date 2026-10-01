// Neon Drift Arena: the game's entry point (createGame).
//
// GOLDEN-RUN REPLAY. The wiring of examples/neon-drift-arena/src/main.ts, ported by the
// Factory's golden-run replay developer - not written by an agent - into the one entry the
// template asks a game to implement. The template's main.ts (unchanged) boots the platform,
// strings and renderer, reports loading and ready, and calls this with everything wired:
// the platform seam is `context.integration`, so neither this file nor the Factory's `sdk`
// step constructs one.

import type { Game } from "@wgf/game-core";
import { Audio } from "../audio/audio.js";
import { Input } from "../input/steering.js";
import { createArenaView } from "../rendering/threejs/arena.js";
import { Screens } from "../ui/screens.js";
import { App } from "./app.js";
import type { GameContext, GameHandle } from "./context.js";

export async function createGame(context: GameContext): Promise<GameHandle> {
  const { game, renderer, container, ui, i18n, integration } = context;
  const view = createArenaView(renderer);
  const audio = new Audio();

  // Forward declaration: the Screens callbacks close over `app`, which is built after them.
  // eslint-disable-next-line prefer-const
  let app: App;
  const screens = new Screens(ui, i18n, {
    play: () => app.play(),
    revive: () => app.revive(),
    restart: () => void app.restart(),
    pause: () => app.pauseMenu(),
    resume: () => app.resumeMenu(),
  });
  app = new App({
    game,
    integration,
    view,
    audio,
    probe: context.hud,
    present: () => renderer.render(0),
    onChange: (v) => screens.paint(v),
    seed: 1,
  });

  const input = new Input(container, {
    steer: (dir) => app.steer(dir),
    play: () => {
      if (app.phase === "menu") app.play();
    },
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" || event.key === "p" || event.key === "P") {
      if (game.paused) app.resumeMenu();
      else app.pauseMenu();
    }
  };
  window.addEventListener("keydown", onKey);

  await app.load();
  await game.changeScene(app);

  // main.ts resizes the renderer (and its camera) first; the scene only has to redraw.
  const offResize = context.onResize(() => app.render());
  app.render();

  installGameHooks(app, game, input, context);

  return {
    // The platform's mute (portal setting, ads, focus) outranks the game's own.
    audio: {
      mute: () => audio.setPlatformMuted(true),
      unmute: () => audio.setPlatformMuted(false),
    },
    dispose: () => {
      offResize();
      window.removeEventListener("keydown", onKey);
      input.dispose();
    },
  };
}

/**
 * Read-and-drive probe for Playwright, from the example. Deterministic: `tick` and `steer`
 * feed the pure simulation, `spawnObstacleAt` places an obstacle with no RNG dependence.
 */
function installGameHooks(app: App, game: Game, input: Input, context: GameContext): void {
  const api = {
    get score(): number {
      return app.score;
    },
    get best(): number {
      return app.best;
    },
    get state(): string {
      return app.phase === "playing" ? (app.simulation?.state ?? "playing") : app.phase;
    },
    get phase(): string {
      return app.phase;
    },
    get playerX(): number {
      return app.simulation?.playerX ?? 0;
    },
    get runId(): number {
      return app.runId;
    },
    get steps(): number {
      return app.steps;
    },
    gameplayActive: () => context.gameplay.platform.gameplayActive,
    play: () => app.play(),
    tick: (dt: number) => app.update(dt),
    steer: (dir: number) => app.steer(dir),
    spawnObstacleAt: (x: number, z: number, halfWidth?: number) =>
      app.simulation?.spawnObstacleAt(x, z, halfWidth),
    restart: () => app.restart(),
    revive: () => app.revive(),
    pause: () => app.pauseMenu(),
    resume: () => app.resumeMenu(),
    paused: () => game.paused,
    snapshot: () => app.simulation?.snapshot() ?? null,
    framesRendered: () => game.framesRendered,
    dispose: () => input.dispose(),
  };
  (window as unknown as { __game: typeof api }).__game = api;
}
