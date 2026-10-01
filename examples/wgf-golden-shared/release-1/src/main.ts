// Entry point of a golden-run port on a game created from a contract-1 template release.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. TEMPORARY: see ../README.md. The golden ports implement the template's
// contract 2 - src/game/index.ts, createGame(context) - but the Factory creates its games from
// its pinned release (v1.2.0), whose main.ts starts the template's own boot scene and knows
// nothing of createGame. The replay developer writes this file over that main.ts, and
// ./game/context.ts beside it, only when the repository has no src/game/context.ts.
//
// It is the release's boot order, line for line, with the Factory's seam in place of
// createPlatform (the platform from createGamePlatform(), the integration from
// createGameIntegration(), as the development brief asks every developer) and the boot
// scene replaced by createGame with the GameContext contract 2's main.ts would build. Like
// contract 2, one mute state comes from two sources - bindPlatform (portal setting, ad
// events, focus) and the integration's ad breaks - so neither can unmute over the other.

import { Game } from "@wgf/game-core";
import availableLocales from "virtual:locales";
import { config } from "./core/config.js";
import { loadLocale } from "./core/i18n.js";
import { installProbe } from "./core/probe.js";
import type { GameContext, GameHandle, ViewportSize } from "./game/context.js";
import { createGame } from "./game/index.js";
import { bindPlatform } from "./platform/bind.js";
import { createGameIntegration, createGamePlatform } from "./platform/integration.js";
import { createRenderer } from "./rendering/create-renderer.js";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

/** #ui is optional in index.html; a game that draws its menus in the DOM always gets one. */
function uiRoot(): HTMLElement {
  const existing = document.getElementById("ui");
  if (existing) return existing;
  const created = document.createElement("div");
  created.id = "ui";
  document.body.append(created);
  return created;
}

async function main(): Promise<void> {
  const container = element("game");
  const hud = element("hud");
  const ui = uiRoot();

  const platform = await createGamePlatform();
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
  const viewport = (): ViewportSize => ({
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  });
  const initial = viewport();
  await renderer.init({ container, width: initial.width, height: initial.height });

  const game = new Game();

  let handle: GameHandle = {};
  let bindingMuted = false;
  let breakMuted = false;
  let muted = false;
  const muteListeners = new Set<(muted: boolean) => void>();
  const applyMute = (): void => {
    const next = bindingMuted || breakMuted;
    if (next === muted) return;
    muted = next;
    document.documentElement.dataset["audioMuted"] = String(muted);
    if (muted) handle.audio?.mute();
    else handle.audio?.unmute();
    for (const listener of muteListeners) listener(muted);
  };

  const binding = bindPlatform(game, platform, {
    onAudioMutedChange: (value) => {
      bindingMuted = value;
      applyMute();
    },
  });
  const integration = createGameIntegration(game, platform, {
    audio: {
      mute: () => {
        breakMuted = true;
        applyMute();
      },
      unmute: () => {
        breakMuted = false;
        applyMute();
      },
    },
  });

  const resizeListeners = new Set<(size: ViewportSize) => void>();
  const context: GameContext = {
    game,
    renderer,
    container,
    hud,
    ui,
    i18n,
    integration,
    gameplay: { platform },
    platform: {
      id: platform.id,
      target: platform.id,
      capabilities: platform.capabilities,
      language: platform.language,
    },
    audio: {
      get muted() {
        return muted;
      },
      onMutedChange: (listener) => {
        muteListeners.add(listener);
        return () => muteListeners.delete(listener);
      },
    },
    config,
    viewport,
    onResize: (listener) => {
      resizeListeners.add(listener);
      return () => resizeListeners.delete(listener);
    },
    reportLoadingProgress: (fraction) => {
      platform.reportLoadingProgress(0.6 + 0.2 * Math.min(1, Math.max(0, fraction)));
    },
  };
  handle = await createGame(context);
  // The game's audio exists only now: bring it in line with a mute already in force.
  if (muted) handle.audio?.mute();
  platform.reportLoadingProgress(0.8);

  const resize = (): void => {
    const size = viewport();
    renderer.resize(size.width, size.height);
    for (const listener of resizeListeners) listener(size);
  };
  window.addEventListener("resize", resize);
  // Mobile URL bars and pinch zoom change the visual viewport without a window resize.
  window.visualViewport?.addEventListener("resize", resize);
  resize();

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
