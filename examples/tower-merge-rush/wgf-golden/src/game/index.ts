// Tower Merge Rush: the game's entry point (createGame).
//
// GOLDEN-RUN REPLAY. The wiring of examples/tower-merge-rush/src/main.ts, ported by the
// Factory's golden-run replay developer - not written by an agent - into the one entry the
// template asks a game to implement. The template's main.ts (unchanged) boots the platform,
// strings and renderer, reports loading and ready, and calls this with everything wired:
// the platform seam is `context.integration`, so neither this file nor the Factory's `sdk`
// step constructs one.

import type { Game } from "@wgf/game-core";
import { Audio } from "../audio/audio.js";
import { bindColumnInput } from "../input/columns.js";
import { createBoardView } from "../rendering/pixijs/board.js";
import { Screens } from "../ui/screens.js";
import { App } from "./app.js";
import type { GameContext, GameHandle } from "./context.js";

export async function createGame(context: GameContext): Promise<GameHandle> {
  const { game, renderer, container, ui, i18n, integration } = context;
  const view = createBoardView(renderer);
  const audio = new Audio();

  // Forward declaration: the Screens callbacks close over `app`, which is built after them.
  // eslint-disable-next-line prefer-const
  let app: App;
  const screens = new Screens(ui, i18n, {
    begin: () => app.dropAnywhere(),
    continue: () => void app.continue(),
    double: () => void app.doubleScore(),
    restart: () => void app.restart(),
    pause: () => app.pauseMenu(),
    resume: () => app.resumeMenu(),
  });
  app = new App({
    game,
    integration,
    hud: screens,
    probe: context.hud,
    view,
    audio,
    present: () => renderer.render(0),
  });
  await app.load();
  await game.changeScene(app);

  // main.ts has already resized the renderer when this runs.
  const layout = ({ width, height }: { width: number; height: number }): void => {
    view.resize(width, height);
    app.render();
  };
  layout(context.viewport());
  const offResize = context.onResize(layout);

  const offInput = bindColumnInput(container, {
    get paused() {
      return game.paused;
    },
    drop: (col) => app.drop(col),
    dropAnywhere: () => app.dropAnywhere(),
    togglePause: () => (game.paused ? app.resumeMenu() : app.pauseMenu()),
  });

  installGameHooks(app, game, context);

  return {
    // The platform's mute (portal setting, ads, focus) outranks the game's own.
    audio: {
      mute: () => audio.setPlatformMuted(true),
      unmute: () => audio.setPlatformMuted(false),
    },
    dispose: () => {
      offResize();
      offInput();
    },
  };
}

/**
 * Deterministic test hooks, from the example. Writes go through the App - the same rules and
 * integration seam a player hits - so a hook can never reach a state real play could not.
 */
function installGameHooks(app: App, game: Game, context: GameContext): void {
  (window as unknown as { __game: unknown }).__game = {
    get state() {
      return app.merge.state;
    },
    get score() {
      return app.merge.score;
    },
    get best() {
      return app.best;
    },
    get merges() {
      return app.merge.merges;
    },
    get dropLevel() {
      return app.merge.dropLevel;
    },
    get board() {
      return [...app.merge.board];
    },
    get steps() {
      return app.steps;
    },
    levelAt: (col: number) => app.merge.levelAt(col),
    dropAt: (col: number) => app.drop(col),
    dropAnywhere: () => app.dropAnywhere(),
    continue: () => app.continue(),
    doubleScore: () => app.doubleScore(),
    restart: () => app.restart(),
    pause: () => app.pauseMenu(),
    resume: () => app.resumeMenu(),
    paused: () => game.paused,
    gameplayActive: () => context.gameplay.platform.gameplayActive,
  };
}
