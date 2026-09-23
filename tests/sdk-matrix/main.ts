// SDK matrix harness: one page, any engine × any portal adapter × any SDK condition.
//
//   ?engine=pixijs|threejs  &portal=yandex|crazygames|poki|gamevui
//   &sdk=ok|missing|init-fails  &ad=complete|no-fill|closed-early
//
// The boot is src/main.ts's order — initialize, report progress, renderer, scene, ready,
// start, gameplayStart on first input — so what passes here is the sequence a game built
// from the template runs. `window.__matrix` is the handle tests/sdk-matrix/matrix.spec.ts
// drives it through.

import { Game } from "@wgf/game-core";
import { BootScene } from "../../src/game/boot-scene.js";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import { createRenderer } from "../../src/rendering/create-renderer.js";
import {
  PORTALS,
  createHarness,
  type AdOutcome,
  type Portal,
  type SdkMode,
} from "../sdk/portals.js";

const params = new URLSearchParams(location.search);
const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const value = params.get(name);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
};

const engine = pick("engine", ["pixijs", "threejs"] as const, "pixijs");
const portal = pick<Portal>("portal", PORTALS, "yandex");
const sdk = pick<SdkMode>("sdk", ["ok", "missing", "init-fails"], "ok");
const ad = pick<AdOutcome>("ad", ["complete", "no-fill", "closed-early"], "complete");

async function main(): Promise<void> {
  const container = document.getElementById("game")!;
  const hud = document.getElementById("hud")!;
  const harness = createHarness(portal, { sdk, ad });
  const { platform } = harness;

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
  await game.changeScene(new BootScene({ renderer, hud }));

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  game.start();
  binding.armFirstInput();

  const breakFor = <T>(body: () => Promise<T>): Promise<T> =>
    withAdBreak(game, platform, body, {
      mute: () => (hud.dataset["breakMuted"] = "true"),
      unmute: () => (hud.dataset["breakMuted"] = "false"),
    });

  Object.assign(window, {
    __matrix: {
      engine,
      portal,
      hasSdk: harness.hasSdk,
      calls: () => [...harness.calls],
      usage: () => platform.usage,
      state: () => ({
        paused: game.paused,
        gameplayActive: platform.gameplayActive,
        audioMuted: binding.audioMuted,
        foreground: platform.foreground,
        rewardedAvailability: platform.adAvailability("rewarded"),
      }),
      setAd: (outcome: AdOutcome) => harness.setAd(outcome),
      interstitial: () => breakFor(() => platform.showInterstitial()),
      rewarded: () => breakFor(() => platform.showRewarded()),
      portalPause: () => harness.portalPause?.(),
      portalResume: () => harness.portalResume?.(),
      setPortalMute: (muted: boolean) => harness.setPortalMute?.(muted),
      /** Write, then read back through the platform's storage. */
      save: async (key: string) => {
        await platform.storage.set(key, "42");
        return platform.storage.get(key);
      },
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
