// The SDK matrix game: the smallest thing that exercises every part of the platform seam a
// real title uses - boot order, loading, ready, gameplay on first input, pause for the
// portal, an interstitial, a rewarded ad that grants only on confirmation, and a save that
// survives a reload - built once per platform adapter and per engine.
//
// It goes through exactly the layers a game from the template does: @wgf/platform-sdk for
// the portal, src/platform/bind.ts for pause and gameplay, src/core/i18n.ts for strings.
// Nothing here names a portal or imports its SDK.

import { Game, type Scene } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import buildTarget from "virtual:build-target";
import rawConfig from "virtual:game-config";
import availableLocales from "virtual:locales";
import type { GameConfig } from "../../../src/core/game-config.js";
import { loadLocale } from "../../../src/core/i18n.js";
import { installProbe } from "../../../src/core/probe.js";
import { bindPlatform, withAdBreak } from "../../../src/platform/bind.js";
import type { MatrixView } from "./view.js";

const config = rawConfig as GameConfig;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found as T;
}

async function loadView(container: HTMLElement): Promise<MatrixView> {
  const module =
    config.engine.type === "threejs"
      ? await import("./rendering/threejs/view.js")
      : await import("./rendering/pixijs/view.js");
  return module.createView(container);
}

async function main(): Promise<void> {
  const hud = element("hud");
  const target =
    buildTarget ?? config.platforms.find((entry) => entry.role === "required")?.id ?? "";
  hud.dataset["platform"] = target;
  hud.dataset["engine"] = config.engine.type;

  const platform = createPlatform(target, { namespace: config.game.id });
  await platform.initialize();
  platform.reportLoadingProgress(0.3);

  const i18n = await loadLocale({
    available: availableLocales,
    fallback: "en",
    ...(platform.language ? { preferred: [platform.language] } : {}),
  });
  document.documentElement.lang = i18n.locale;
  hud.dataset["locale"] = i18n.locale;
  for (const id of ["interstitial", "rewarded", "save"]) element(id).textContent = i18n.t(id);
  platform.reportLoadingProgress(0.6);

  const view = await loadView(element("game"));
  const saved = Number((await platform.storage.get("score")) ?? 0);
  let score = Number.isFinite(saved) ? saved : 0;
  let rewards = 0;
  hud.dataset["loaded"] = String(score);

  const game = new Game();
  const binding = bindPlatform(game, platform);
  let steps = 0;
  const scene: Scene = {
    id: "matrix",
    update: () => {
      steps += 1;
      hud.dataset["steps"] = String(steps);
    },
    render: () => view.draw(game.elapsedMs, score),
  };
  await game.changeScene(scene);
  hud.dataset["scene"] = scene.id;

  const publish = (): void => {
    hud.dataset["score"] = String(score);
    hud.dataset["rewards"] = String(rewards);
    hud.dataset["foreground"] = String(platform.foreground);
    hud.dataset["paused"] = String(game.paused);
    hud.dataset["gameplay"] = String(platform.gameplayActive);
  };
  platform.on("foreground:lost", publish);
  platform.on("foreground:gained", publish);
  game.events.on("paused", publish);
  game.events.on("resumed", publish);
  window.addEventListener("pointerdown", () => queueMicrotask(publish));

  element("interstitial").addEventListener("click", () => {
    void withAdBreak(game, platform, () => platform.showInterstitial(), {
      resumeGameplay: true,
    }).then((result) => {
      hud.dataset["lastAd"] = JSON.stringify(result);
      publish();
    });
  });
  element("rewarded").addEventListener("click", () => {
    void withAdBreak(game, platform, () => platform.showRewarded(), { resumeGameplay: true }).then(
      (result) => {
        // `rewarded`, never `shown`: a player who closed the ad early gets nothing.
        if (result.rewarded) {
          score += 10;
          rewards += 1;
        }
        hud.dataset["lastAd"] = JSON.stringify(result);
        publish();
      },
    );
  });
  element("save").addEventListener("click", () => {
    void platform.storage.set("score", String(score)).then(() => {
      hud.dataset["saved"] = String(score);
    });
  });

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  const timeToInteractiveMs = performance.now();
  game.start();
  // Gameplay is reported on the first input, not at load (Poki's rule, harmless elsewhere).
  binding.armFirstInput();
  installProbe({
    game,
    platform,
    gameId: config.game.id,
    gameVersion: config.game.version,
    engine: config.engine.type,
    timeToInteractiveMs,
  });
  publish();
  hud.dataset["ready"] = "true";
}

void main().catch((error: unknown) => {
  const hud = document.getElementById("hud");
  if (hud) {
    hud.dataset["ready"] = "false";
    hud.textContent = `boot failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
