// GameMonetize in a real browser through the adapter's own script loader.
//
// Unlike main.ts, nothing here injects a fake through `loadSdk`: GameMonetizePlatform sets
// window.SDK_OPTIONS and inserts <script id="gamemonetize-sdk" src="https://api.gamemonetize
// .com/sdk.js"> exactly as it does in production, and gamemonetize.spec.ts answers that
// request with the mock in tests/gamemonetize/mock-sdk.ts (or blocks it). The boot order is
// src/main.ts's, with the real renderer, loop and bindPlatform.
//
//   ?engine=pixijs|threejs  &gameId=<id>|none  &initMs=  &startMs=  &adMs=
//
// The timeouts are shortened by query so a lost callback can be proved in seconds.

import { Game } from "@wgf/game-core";
import { GameMonetizePlatform, MemoryStorageBackend } from "@wgf/platform-sdk";
import { ProbeScene } from "../support/probe-scene.js";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import { createRenderer } from "../../src/rendering/create-renderer.js";

const params = new URLSearchParams(location.search);
const engine = params.get("engine") === "threejs" ? "threejs" : "pixijs";
const gameIdParam = params.get("gameId");
const number = (name: string): number | undefined => {
  const value = params.get(name);
  return value === null ? undefined : Number(value);
};

async function main(): Promise<void> {
  const container = document.getElementById("game")!;
  const hud = document.getElementById("hud")!;
  const initTimeoutMs = number("initMs");
  const adStartTimeoutMs = number("startMs");
  const adTimeoutMs = number("adMs");
  const platform = new GameMonetizePlatform({
    namespace: "matrix-gm",
    gameId: gameIdParam === "none" ? null : gameIdParam,
    storage: new MemoryStorageBackend(),
    ...(initTimeoutMs !== undefined ? { initTimeoutMs } : {}),
    ...(adStartTimeoutMs !== undefined ? { adStartTimeoutMs } : {}),
    ...(adTimeoutMs !== undefined ? { adTimeoutMs } : {}),
  });
  const events: string[] = [];
  for (const event of ["ad:start", "ad:end", "foreground:lost", "foreground:gained"] as const) {
    platform.on(event, () => events.push(event));
  }

  await platform.initialize();
  platform.reportLoadingProgress(0.3);
  const renderer = await createRenderer(engine);
  platform.reportLoadingProgress(0.7);
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  });

  const game = new Game();
  const binding = bindPlatform(game, platform, {
    onAudioMutedChange: (muted) => (hud.dataset["audioMuted"] = String(muted)),
  });
  await game.changeScene(new ProbeScene({ renderer, hud }));
  platform.reportLoadingProgress(1);
  await platform.signalReady();
  game.start();
  binding.armFirstInput();

  Object.assign(window, {
    __gm: {
      engine,
      events: () => [...events],
      state: () => ({
        sdkState: platform.sdkState,
        configProblem: platform.configProblem,
        paused: game.paused,
        gameplayActive: platform.gameplayActive,
        audioMuted: binding.audioMuted,
        foreground: platform.foreground,
        interstitial: platform.adAvailability("interstitial"),
        rewarded: platform.adAvailability("rewarded"),
        usage: platform.usage,
      }),
      interstitial: () => withAdBreak(game, platform, () => platform.showInterstitial()),
      /** Two requests at once: the second must be refused, never queued. */
      interstitialTwice: () =>
        Promise.all([
          withAdBreak(game, platform, () => platform.showInterstitial()),
          platform.showInterstitial(),
        ]),
      rewarded: () => withAdBreak(game, platform, () => platform.showRewarded()),
    },
  });
  hud.dataset["ready"] = "true";
}

main().catch((error: unknown) => {
  const hud = document.getElementById("hud");
  if (hud) {
    hud.dataset["ready"] = "false";
    hud.textContent = `boot failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
