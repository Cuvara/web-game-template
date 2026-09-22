// Entry point.
//
// The order here is the order every portal expects: initialize the platform, report loading
// progress while the heavy work happens, signal ready, then start. Portals whose profile
// sets `loading_api: required` list "does not report loading progress" as a rejection
// cause, so the reporting is part of the boot sequence rather than an afterthought.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import { config, primaryPlatform } from "./core/config.js";
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

  const platform = createPlatform(primaryPlatform().id, { namespace: config.game.id });
  await platform.initialize();
  platform.reportLoadingProgress(0.2);

  const renderer = await createRenderer(config.engine.type);
  platform.reportLoadingProgress(0.6);
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  });

  const game = new Game();
  bindPlatform(game, platform);
  await game.changeScene(new BootScene({ renderer, hud }));

  window.addEventListener("resize", () => {
    renderer.resize(container.clientWidth, container.clientHeight);
  });

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  game.start();
  platform.gameplayStart();

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
