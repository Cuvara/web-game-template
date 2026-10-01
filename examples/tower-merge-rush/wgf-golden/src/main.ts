// Entry point for Tower Merge Rush.
//
// GOLDEN-RUN REPLAY. The template's boot sequence (initialize the platform, report loading
// progress, signal ready, start, report gameplay only on the first input) with the game of
// examples/tower-merge-rush in place of the template boot scene - ported by the Factory's
// golden-run replay developer, not written by an agent. The boot lines are the template's
// own, unchanged, so the Factory's `sdk` step can route them through its integration.
// Loading also brings in the design's art: public/assets/assets.json is fetched once, the
// identity's fonts are bundled through @font-face and awaited, and the board's textures and
// the overlay's images are loaded by asset id before the title screen shows. The music and
// sound effects (type music / sfx in the same manifest) load in the background after the
// game is interactive, and nothing sounds before the player's first input.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import availableLocales from "virtual:locales";
import { RuntimeAssets } from "./game/runtime-assets.js";
import { Audio } from "./audio/audio.js";
import { config, primaryPlatform } from "./core/config.js";
import { loadLocale } from "./core/i18n.js";
import { installProbe } from "./core/probe.js";
import { App } from "./game/app.js";
import { installPlayProbe } from "./game/play-probe.js";
import { bindColumnInput, columnFromClientX } from "./input/columns.js";
import { bindPlatform } from "./platform/bind.js";
import { DefaultGameIntegration } from "./platform/default-integration.js";
import { createRenderer } from "./rendering/create-renderer.js";
import { createBoardView } from "./rendering/pixijs/board.js";
import { Screens, uiArt } from "./ui/screens.js";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

async function main(): Promise<void> {
  const container = element("game");
  const hud = element("hud");
  const uiRoot = element("ui");

  const platform = createPlatform(primaryPlatform().id, { namespace: config.game.id });
  await platform.initialize();
  platform.reportLoadingProgress(0.2);

  // The portal's language outranks the browser's: Yandex requires it (requirement 2.14).
  const i18n = await loadLocale({
    available: availableLocales,
    fallback: "en",
    ...(platform.language ? { preferred: [platform.language] } : {}),
  });
  hud.textContent = i18n.t("boot.title");
  document.documentElement.lang = i18n.locale;
  platform.reportLoadingProgress(0.4);

  const assets = await RuntimeAssets.fetch();
  await assets.loadFonts({ id: "fonts", role: "font" });
  const art = uiArt(assets);
  await assets.preloadImages(art.ids);
  platform.reportLoadingProgress(0.5);

  const renderer = await createRenderer(config.engine.type);
  platform.reportLoadingProgress(0.6);
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    background: 0xf4ede1,
  });
  const view = await createBoardView(renderer, assets, { next: i18n.t("hud.next") }, (share) =>
    platform.reportLoadingProgress(0.6 + share * 0.15),
  );

  const game = new Game();
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
  const binding = bindPlatform(game, platform, {
    onAudioMutedChange: (muted) => {
      audio.setPlatformMuted(muted);
      document.documentElement.dataset["audioMuted"] = String(muted);
    },
  });
  const integration = new DefaultGameIntegration(game, platform);

  let presentedAt = -Infinity;
  const click = (): void => {
    audio.unlock();
    audio.play("ui-tap", { vary: 30 });
  };
  // Forward declaration: the Screens callbacks close over `app`, which is built after them.
  // eslint-disable-next-line prefer-const
  let app: App;
  const screens = new Screens(
    uiRoot,
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
    probe: hud,
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
  platform.reportLoadingProgress(0.8);
  await game.changeScene(app);

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.resize(width, height);
    view.resize(width, height);
    app.render();
  };
  resize();
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);

  bindColumnInput(container, {
    get paused() {
      return game.paused;
    },
    drop: (col) => app.drop(col),
    dropAnywhere: () => app.dropAnywhere(),
    togglePause: () => (game.paused ? app.resumeMenu() : app.pauseMenu()),
  });
  // The next piece hovers over the column under the pointer.
  container.addEventListener("pointermove", (event) =>
    view.hover(columnFromClientX(container, event.clientX)),
  );
  container.addEventListener("pointerleave", () => view.hover(null));

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  // performance.now() is measured from navigation start, so this is time-to-interactive
  // without needing a separate mark.
  const timeToInteractiveMs = performance.now();

  game.start();
  // gameplayStart waits for the player (Poki: "gameplayStart() fires on first player input
  // (not load)"). bindPlatform owns it from here, including hidden-tab stops.
  binding.armFirstInput();

  installProbe({
    game,
    platform,
    gameId: config.game.id,
    gameVersion: config.game.version,
    engine: config.engine.type,
    timeToInteractiveMs,
  });
  installGameHooks(app, game, platform);
  // After installProbe, which replaces window.__wgf__.
  installPlayProbe({ app, game, surface: container, ui: uiRoot, view, assets, audio });
  // Sound streams in after the game is interactive: the play loop and the cues a first
  // tap needs first, the rest behind them.
  void audio.load(["music-loop", "sfx-drop", "sfx-merge", "ui-tap", "music-title"]);

  hud.dataset["ready"] = "true";
}

/**
 * Deterministic test hooks, from the example. Writes go through the App - the same rules and
 * integration seam a player hits - so a hook can never reach a state real play could not.
 */
function installGameHooks(app: App, game: Game, platform: { gameplayActive: boolean }): void {
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
    gameplayActive: () => platform.gameplayActive,
  };
}

void main().catch((error: unknown) => {
  // Boot failures must be visible. A portal reviewer sees a black screen otherwise.
  const hud = document.getElementById("hud");
  if (hud) {
    hud.dataset["ready"] = "false";
    hud.textContent = `boot failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
