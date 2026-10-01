// Entry point. TEMPLATE-OWNED: a game implements src/game/index.ts, never this file.
//
// The order here is the order every portal expects: initialize the platform, report loading
// progress while the heavy work happens, signal ready, then start — and report gameplay
// only once the player first interacts. Portals whose profile sets `loading_api: required`
// list "does not report loading progress" as a rejection cause, so the reporting is part of
// the boot sequence rather than an afterthought.
//
// Everything platform-facing is wired here, before the game exists: bootPlatform (degrades
// instead of blanking the screen when an adapter breaks), bindPlatform (pause, mute, first
// input), PlatformGameplay with the Factory's integration plan (ads at the design's
// moments). The game receives all of it through GameContext, so neither a game nor the
// Factory ever edits this file, and `pnpm sdk:check` fails the build if the wiring is gone.

import { Analytics, NullSink } from "@wgf/analytics-sdk";
import { Game } from "@wgf/game-core";
import availableLocales from "virtual:locales";
import { config, platformOptions, targetPlatform } from "./core/config.js";
import { loadLocale } from "./core/i18n.js";
import { installProbe } from "./core/probe.js";
import type { GameContext, GameHandle, ViewportSize } from "./game/context.js";
import { createGame } from "./game/index.js";
import { bindPlatform } from "./platform/bind.js";
import { PlatformGameIntegration } from "./platform/game-integration.js";
import {
  PlatformGameplay,
  bootPlatform,
  createSdkFreePlatform,
  installGameplay,
} from "./platform/gameplay.js";
import { INTEGRATION_PLAN } from "./platform/integration-plan.js";
import { createTargetPlatform } from "./platform/target.js";
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

  const entry = targetPlatform();
  const booted = await bootPlatform({
    target: entry.id,
    options: platformOptions(entry),
    plan: INTEGRATION_PLAN,
    // The target's own adapter; a plan may substitute only the SDK-free one.
    create: (id, options) =>
      id === entry.id ? createTargetPlatform(options) : createSdkFreePlatform(id, options),
  });
  const platform = booted.platform;
  // The adapter's initialize() rejected: play on without it rather than show a blank page,
  // and leave the reason where the verify suite can see it.
  if (booted.degraded) console.warn("platform degraded", booted.degraded);
  hud.dataset["platform"] = platform.id;
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

  const renderer = await createRenderer();
  hud.dataset["engine"] = renderer.kind;
  platform.reportLoadingProgress(0.6);
  const viewport = (): ViewportSize => ({
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  });
  const initial = viewport();
  await renderer.init({ container, width: initial.width, height: initial.height });

  const game = new Game();
  // The scene id is published from the Game itself, so every game passes the smoke suite
  // without reporting anything; a game that sets its own data-scene is simply overwritten
  // with the same value.
  game.events.on("scene:changed", ({ id }) => {
    hud.dataset["scene"] = id;
  });

  // One mute state from two sources — bindPlatform (portal setting, ad events, focus,
  // portal overlay) and PlatformGameplay (the ad breaks it runs) — so neither can unmute
  // over the other.
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
  const gameplay = installGameplay(
    new PlatformGameplay(game, platform, INTEGRATION_PLAN, {
      target: booted.target,
      tracker: new Analytics({ sink: new NullSink() }),
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
      // bindPlatform owns the portal's foreground pause, with its dropped-event watchdog.
      followForeground: false,
    }),
  );

  const resizeListeners = new Set<(size: ViewportSize) => void>();
  const context: GameContext = {
    game,
    renderer,
    container,
    hud,
    ui,
    i18n,
    integration: new PlatformGameIntegration(),
    gameplay,
    platform: {
      id: platform.id,
      target: booted.target,
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
  // A device pixel ratio change (the window moved to another screen) fires no resize either.
  // The media query matches only the current ratio, so it is re-armed after every change.
  const watchPixelRatio = (): void => {
    const query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query?.addEventListener(
      "change",
      () => {
        resize();
        watchPixelRatio();
      },
      { once: true },
    );
  };
  watchPixelRatio();
  resize();

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    handle.dispose?.();
    gameplay.dispose();
    binding.dispose();
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
    target: booted.target,
    gameplay,
    gameId: config.game.id,
    gameVersion: config.game.version,
    engine: renderer.kind,
    timeToInteractiveMs,
  });
  publishSteps(game, hud);

  hud.dataset["ready"] = "true";
}

/**
 * #hud[data-steps]: the loop's fixed steps, once per animation frame. Written from the Game,
 * not from a scene, so the smoke suite's "the loop advances" holds for any game.
 */
function publishSteps(game: Game, hud: HTMLElement): void {
  let published = -1;
  const tick = (): void => {
    if (game.steps !== published) {
      published = game.steps;
      hud.dataset["steps"] = String(published);
    }
    requestAnimationFrame(tick);
  };
  tick();
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
