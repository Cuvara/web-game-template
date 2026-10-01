// Tower Merge Rush: the game's entry point (createGame).
//
// GOLDEN-RUN REPLAY. The wiring of examples/tower-merge-rush/src/main.ts, ported by the
// Factory's golden-run replay developer - not written by an agent - into the one entry the
// template asks a game to implement. The template's main.ts (unchanged) boots the platform,
// strings and renderer, reports loading and ready, and calls this with everything wired:
// the platform seam is `context.integration`, so neither this file nor the Factory's `sdk`
// step constructs one.
//
// Loading also brings in the design's art: public/assets/assets.json is fetched once, the
// identity's fonts are bundled through @font-face and awaited, and the board's textures and
// the overlay's images are loaded by asset id before the title screen shows (reported
// through context.reportLoadingProgress). The music and sound effects (type music / sfx in
// the same manifest) load in the background once the game is interactive, and nothing
// sounds before the player's first input.

import type { Game } from "@wgf/game-core";
import { Audio } from "../audio/audio.js";
import { bindColumnInput, columnFromClientX } from "../input/columns.js";
import { createBoardView } from "../rendering/pixijs/board.js";
import { Screens, uiArt } from "../ui/screens.js";
import { afterReady } from "./after-ready.js";
import { App } from "./app.js";
import type { GameContext, GameHandle } from "./context.js";
import { installPlayProbe } from "./play-probe.js";
import { RuntimeAssets } from "./runtime-assets.js";

export async function createGame(context: GameContext): Promise<GameHandle> {
  const { game, renderer, container, ui, i18n, integration } = context;
  const assets = await RuntimeAssets.fetch();
  await assets.loadFonts({ id: "fonts", role: "font" });
  const art = uiArt(assets);
  await assets.preloadImages(art.ids);
  context.reportLoadingProgress(0.25);
  const view = await createBoardView(renderer, assets, { next: i18n.t("hud.next") }, (share) =>
    context.reportLoadingProgress(0.25 + share * 0.65),
  );

  const audio = new Audio({
    music: 0.55,
    mix: {
      "ui-tap": 0.4,
      "sfx-drop": 0.6,
      "sfx-merge": 0.62,
      "sfx-combo": 0.7,
      "sfx-game-over": 0.85,
      "sfx-reward": 0.75,
      "ui-fanfare": 0.8,
    },
  });

  let presentedAt = -Infinity;
  const click = (): void => {
    audio.unlock();
    audio.play("ui-tap", { vary: 30 });
  };
  // Forward declaration: the Screens callbacks close over `app`, which is built after them.
  // eslint-disable-next-line prefer-const
  let app: App;
  const screens = new Screens(
    ui,
    i18n,
    {
      begin: () => app.dropAnywhere(),
      continue: () => {
        click();
        void app.continue();
      },
      double: () => {
        click();
        void app.doubleScore();
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
        // A button press unlocks sound like any first input; the tap is heard on the way in
        // (before muting) and on the way back (after unmuting).
        audio.unlock();
        if (!audio.userMuted) click();
        audio.setUserMuted(!audio.userMuted);
        if (!audio.userMuted) click();
        return !audio.userMuted;
      },
    },
    art,
  );
  app = new App({
    game,
    integration,
    hud: screens,
    probe: context.hud,
    view,
    audio,
    // At most one frame per display frame: a burst of input (or a test's scripted loop)
    // redraws once, not once per drop; the loop's next frame shows the rest.
    present: () => {
      const now = performance.now();
      if (now - presentedAt < 8) return;
      presentedAt = now;
      renderer.render(0);
    },
  });
  await app.load();
  context.reportLoadingProgress(1);
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
  // The next piece hovers over the column under the pointer.
  const onPointerMove = (event: PointerEvent): void =>
    view.hover(columnFromClientX(container, event.clientX));
  const onPointerLeave = (): void => view.hover(null);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", onPointerLeave);

  installGameHooks(app, game, context);
  const offReady = afterReady(context.hud, () => {
    // Beside the template's probe, which main.ts installs after this function returns.
    installPlayProbe({ app, game, surface: container, ui, view, assets, audio });
    // Sound streams in after the game is interactive: the play loop and the cues a first
    // tap needs first, the rest behind them.
    void audio.load(["music-loop", "sfx-drop", "sfx-merge", "ui-tap", "music-title"]);
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
      offInput();
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
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
