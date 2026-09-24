// Entry point.
//
// The order here is the order every portal expects: initialize the platform, report loading
// progress while the heavy work happens, signal ready, then start — and report gameplay
// only once the player first interacts. Portals whose profile
// sets `loading_api: required` list "does not report loading progress" as a rejection
// cause, so the reporting is part of the boot sequence rather than an afterthought.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import availableLocales from "virtual:locales";
import { config, primaryPlatform } from "./core/config.js";
import { loadLocale } from "./core/i18n.js";
import { installProbe } from "./core/probe.js";
import { BootScene } from "./game/boot-scene.js";
import { bindPlatform } from "./platform/bind.js";
import { createRenderer } from "./rendering/create-renderer.js";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

async function main(): Promise<void> {
  const container = element("game");
  const hud = element("hud");

  const target = primaryPlatform();
  const platform = createPlatform(target.id, {
    namespace: config.game.id,
    portalGameId: target.game_id ?? null,
  });
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

  const renderer = await createRenderer(config.engine.type);
  platform.reportLoadingProgress(0.6);
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  });

  const game = new Game();
  // src/audio/ is still an empty slot. Whatever fills it must follow this callback.
  const binding = bindPlatform(game, platform, {
    onAudioMutedChange: (muted) => {
      document.documentElement.dataset["audioMuted"] = String(muted);
    },
  });
  await game.changeScene(new BootScene({ renderer, hud }));

  window.addEventListener("resize", () => {
    renderer.resize(container.clientWidth, container.clientHeight);
  });

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  // performance.now() is measured from navigation start, so this is time-to-interactive
  // without needing a separate mark.
  const timeToInteractiveMs = performance.now();

  game.start();
  // gameplayStart waits for the player. Poki lists "gameplayStart() fires on first player
  // input (not load)" among its SDK rules; reporting it at boot counts idle page views as
  // play time. bindPlatform owns it from here, including hidden-tab stops.
  binding.armFirstInput();

  installProbe({
    game,
    platform,
    gameId: config.game.id,
    gameVersion: config.game.version,
    engine: config.engine.type,
    timeToInteractiveMs,
  });

  hud.dataset["ready"] = "true";
}

void main().catch((error: unknown) => {
  // Boot failures must be visible. A portal reviewer sees a black screen otherwise, and
  // "unfinished UI" is a listed rejection cause on more than one platform.
  const hud = document.getElementById("hud");
  if (hud) {
    hud.dataset["ready"] = "false";
    hud.textContent = `boot failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
