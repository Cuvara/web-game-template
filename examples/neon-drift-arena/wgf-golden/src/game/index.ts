// Neon Drift Arena: the game's entry point (createGame).
//
// GOLDEN-RUN REPLAY. The wiring of examples/neon-drift-arena/src/main.ts, ported by the
// Factory's golden-run replay developer - not written by an agent - into the one entry the
// template asks a game to implement. The template's main.ts (unchanged) boots the platform,
// strings and renderer, reports loading and ready, and calls this with everything wired:
// the platform seam is `context.integration`, so neither this file nor the Factory's `sdk`
// step constructs one.
//
// Loading is real: the production models, fonts and UI art come through the runtime asset
// manifest (public/assets/assets.json) before the title screen shows, and a manifest that
// lacks a production model, or offers only a placeholder, fails the boot visibly instead of
// drawing boxes. A build with no manifest at all is the greybox, before the assets exist: it
// draws plain boxes the play probe reports as primitives (rendering/threejs/assets.ts).

import type { Game } from "@wgf/game-core";
import { Audio } from "../audio/audio.js";
import { Input } from "../input/steering.js";
import { createArenaView, loadArenaAssets, screenBounds } from "../rendering/threejs/arena.js";
import { Screens } from "../ui/screens.js";
import { afterReady } from "./after-ready.js";
import { App } from "./app.js";
import type { GameContext, GameHandle } from "./context.js";
import { installPlayProbe } from "./play-probe.js";

export async function createGame(context: GameContext): Promise<GameHandle> {
  const { game, renderer, container, ui, i18n, integration } = context;
  const assets = await loadArenaAssets(document.baseURI, (fraction) =>
    context.reportLoadingProgress(0.9 * fraction),
  );
  document.documentElement.dataset["fonts"] = "loaded";
  // Forward declaration: the view's feedback reaches the screens, built below.
  // eslint-disable-next-line prefer-const
  let screens: Screens;
  const view = createArenaView(renderer, assets, { nearMiss: () => screens.nearMiss() });

  const audio = new Audio({
    music: 0.5,
    mix: {
      "ui-tap": 0.4,
      "sfx-engine": 0.22,
      "sfx-pass": 0.35,
      "sfx-near-miss": 0.6,
      "sfx-crash": 0.9,
      "sfx-game-over": 0.75,
      "ui-fanfare": 0.75,
    },
  });
  const click = (): void => {
    audio.unlock();
    audio.play("ui-tap", { vary: 30 });
  };

  // Forward declaration: the Screens callbacks close over `app`, which is built after them.
  // eslint-disable-next-line prefer-const
  let app: App;
  screens = new Screens(ui, i18n, assets.ui, {
    play: () => app.play(),
    revive: () => {
      click();
      return app.revive();
    },
    restart: () => {
      click();
      void app.restart();
    },
    pause: () => {
      click();
      app.pauseMenu();
    },
    resume: () => {
      app.resumeMenu();
      click();
    },
    toggleSound: () => {
      audio.unlock();
      if (!audio.userMuted) click();
      audio.setUserMuted(!audio.userMuted);
      if (!audio.userMuted) click();
      return !audio.userMuted;
    },
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
  context.reportLoadingProgress(1);
  await game.changeScene(app);

  // main.ts resizes the renderer (and its camera) first; the view reframes its chase camera
  // to the new aspect and the scene redraws.
  const layout = ({ width, height }: { width: number; height: number }): void => {
    view.frame(width / Math.max(1, height));
    app.render();
  };
  layout(context.viewport());
  const offResize = context.onResize(layout);

  installGameHooks(app, game, input, context);
  const offReady = afterReady(context.hud, () => {
    // Beside the template's probe, which main.ts installs after this function returns.
    installPlayProbe({
      app,
      game,
      surface: container,
      ui,
      project: (centre, size) => screenBounds(renderer, container, centre, size),
      drawing: view,
      assetsLoaded: () => assets.loaded,
      audio,
    });
    // Sound streams in after the game is interactive: the driving loop and its layer first.
    void audio.load(["music-drive", "music-drive-layer", "sfx-engine", "ui-tap", "music-title"]);
  });

  return {
    // The platform's mute (portal setting, ads, focus) outranks the game's own.
    audio: {
      mute: () => audio.setPlatformMuted(true),
      unmute: () => audio.setPlatformMuted(false),
    },
    dispose: () => {
      offReady();
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
