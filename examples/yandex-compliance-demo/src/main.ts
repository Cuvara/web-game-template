// Boot.
//
//   SDK initialisation -> language -> saves -> renderer -> menu on screen -> Game Ready
//
// Game Ready (LoadingAPI.ready(), requirement 1.19.2) is sent only once the menu is on
// screen and its Play button works: not before, because moderation checks for spinners
// still showing, and not on a timer, because moderation dismisses the portal's loader early
// to catch exactly that.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import { PixiRenderer } from "@wgf/pixi-framework";
import availableLocales from "virtual:locales";
import { config, primaryPlatform } from "../../../src/core/config.js";
import { loadLocale } from "../../../src/core/i18n.js";
import { installProbe } from "../../../src/core/probe.js";
import { App } from "./app.js";
import { Sound } from "./audio.js";
import { Input } from "./input.js";
import { toPlayfieldX } from "./layout.js";
import { lockPage, watchFocus } from "./lifecycle.js";
import { formatter } from "./format.js";
import { CatchView } from "./rendering/pixijs/catch-view.js";
import { Ui } from "./ui.js";
// Compiled in as the last resort only; the real tables are fetched from locales/.
import englishFallback from "../public/locales/en.json";

/**
 * Languages close enough to Russian that a Russian-speaking player is better served by it
 * than by the English fallback. The portal reports these for its CIS domains.
 */
const RUSSIAN_FALLBACK = new Set(["be", "kk", "uk", "uz"]);

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

async function main(): Promise<void> {
  lockPage();
  const boot = element("boot");
  const container = element("game");
  const uiRoot = element("ui");

  const platform = createPlatform(primaryPlatform().id, { namespace: config.game.id });
  await platform.initialize();
  platform.reportLoadingProgress(0.25);

  // 2.14: the language comes from the portal at launch, whatever the browser says.
  const lang = platform.language;
  const preferred = lang ? [lang, ...(RUSSIAN_FALLBACK.has(lang) ? ["ru"] : [])] : undefined;
  const i18n = await loadLocale({
    available: availableLocales,
    fallback: "en",
    ...(preferred ? { preferred } : {}),
  });
  const t = formatter(i18n.t, englishFallback);
  document.documentElement.lang = i18n.locale;
  document.title = t("title");
  boot.textContent = t("loading");
  platform.reportLoadingProgress(0.5);

  // engine.type is pixijs in this demo's config; importing the renderer directly keeps the
  // unused Three.js chunk out of the archive.
  const renderer = new PixiRenderer();
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    background: 0x0b1026,
  });
  platform.reportLoadingProgress(0.8);

  const view = new CatchView(renderer.stage);
  const game = new Game();
  const sound = new Sound();
  let app: App | null = null;

  const input = new Input({
    surface: container,
    toPlayfieldX: (clientX) => toPlayfieldX(clientX, view.field),
    onPause: () => app?.togglePause(),
  });
  const ui = new Ui(uiRoot, t, {
    play: () => app?.play(),
    pause: () => app?.togglePause(),
    resume: () => app?.resume(),
    menu: () => void app?.menu(),
    again: () => void app?.again(),
    revive: () => void app?.revive(),
    toggleSound: () => void app?.toggleSound(),
  });

  // Draw, then present: the loop drives rendering, Pixi's own ticker is stopped.
  const present = {
    draw: (run: Parameters<CatchView["draw"]>[0]) => {
      view.draw(run);
      renderer.render();
    },
  };
  app = new App({ game, platform, ui, sound, input, view: present, t });
  await app.load();
  await game.changeScene(app);

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.resize(width, height);
    view.resize(width, height);
    // A paused loop draws nothing; redraw so a rotated, paused game is not left stretched.
    app?.render();
  };
  resize();
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  const currentApp = app;
  watchFocus({
    visibility: (visible) => currentApp.visibility(visible),
    focus: (focused) => currentApp.focus(focused),
  });

  game.start();
  ui.show("menu");
  boot.remove();

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  const timeToInteractiveMs = performance.now();

  installProbe({
    game,
    platform,
    gameId: config.game.id,
    gameVersion: config.game.version,
    engine: config.engine.type,
    timeToInteractiveMs,
  });
  installDemoProbe(currentApp, platform, sound, i18n.locale);
  uiRoot.dataset["ready"] = "true";
}

/**
 * Read-only state for the e2e suite, next to the template's own __wgf__ probe and for the
 * same reason: the build that is tested has to be the build that ships.
 */
function installDemoProbe(
  app: App,
  platform: ReturnType<typeof createPlatform>,
  sound: Sound,
  locale: string,
): void {
  (window as unknown as { __demo__: unknown }).__demo__ = {
    locale,
    phase: () => app.phase,
    best: () => app.best,
    score: () => app.run?.score ?? 0,
    lives: () => app.run?.lives ?? 0,
    basketX: () => app.run?.basketX ?? null,
    manuallyPaused: () => app.manuallyPaused,
    audio: () => sound.state,
    foreground: () => platform.foreground,
  };
}

void main().catch((error: unknown) => {
  // A boot failure must be visible and must not be a black screen (1.14).
  console.error(error);
  const boot = document.getElementById("boot");
  if (boot) {
    boot.dataset["state"] = "failed";
    boot.textContent = document.documentElement.lang.startsWith("ru")
      ? "Не удалось запустить игру. Перезагрузите страницу."
      : "The game could not start. Please reload the page.";
  }
});
