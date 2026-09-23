// Star Catcher — the GameVui compliance demo.
//
// A platform-neutral web build. GameVui publishes no SDK or JavaScript API
// (docs/platforms/gamevui/platform-contract.md), so this game talks to the template's
// generic-web adapter and to nothing else: no portal script, no ad network, no request that
// leaves the page's own origin. Nothing here reads or calls any `window.GV*` global that a
// GameVui-hosted page happens to expose — those are undocumented.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import { PixiRenderer } from "@wgf/pixi-framework";
import { CatchScene } from "./game/catch-scene.js";
import { loadStrings, pickLocale, SHIPPED_LOCALES } from "./i18n.js";

const GAME_ID = "gamevui-compliance-demo";
const BEST_KEY = "best";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found as T;
}

/** Read-only snapshot for the e2e suite. Functions return copies, never live state. */
export interface DemoProbe {
  readonly locale: string;
  readonly platformId: string;
  readonly timeToInteractiveMs: number;
  phase(): string;
  score(): number;
  lives(): number;
  best(): number;
  steps(): number;
  stars(): number;
  basketX(): number;
  /** Where input last told the basket to go. Set synchronously by every input event. */
  targetX(): number;
  world(): { width: number; height: number };
  framesRendered(): number;
  paused(): boolean;
}

declare global {
  interface Window {
    __gvdemo__?: DemoProbe;
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const loadingBar = element("loading-bar");
  const progress = (fraction: number): void => {
    loadingBar.style.width = `${Math.round(fraction * 100)}%`;
    platform.reportLoadingProgress(fraction);
  };

  const platform = createPlatform("generic-web", { namespace: GAME_ID });
  await platform.initialize();
  progress(0.15);

  const locale = pickLocale(params.get("lang"), SHIPPED_LOCALES);
  const t = await loadStrings(locale);
  document.documentElement.lang = locale;
  document.title = `${t("title")}`;
  element("loading-label").textContent = t("loading");
  progress(0.35);

  const container = element("game");
  const size = (): { width: number; height: number } => ({
    width: Math.max(container.clientWidth, 1),
    height: Math.max(container.clientHeight, 1),
  });

  const renderer = new PixiRenderer();
  await renderer.init({ container, ...size(), background: 0x1b2a4a });
  progress(0.7);

  const stored = Number(await platform.storage.get(BEST_KEY));
  let best = Number.isFinite(stored) ? stored : 0;

  const hud = element("hud");
  const hudScore = element("hud-score");
  const hudLives = element("hud-lives");
  const hudBest = element("hud-best");
  const titleScreen = element("title-screen");
  const overScreen = element("over-screen");

  element("title-heading").textContent = t("title");
  element("title-tagline").textContent = t("tagline");
  element("controls-desktop").textContent = t("controls.desktop");
  element("controls-mobile").textContent = t("controls.mobile");
  element("play").textContent = t("play");
  element("over-heading").textContent = t("over");
  element("again").textContent = t("again");

  // A seed in the URL makes a round replayable; without one, every round differs.
  const seedParam = Number(params.get("seed"));
  const seed = Number.isInteger(seedParam) && params.has("seed") ? seedParam : Date.now();

  const game = new Game();
  const scene: CatchScene = new CatchScene({
    renderer,
    world: size(),
    seed,
    onChange: (state) => {
      hudScore.textContent = `${t("score")}: ${state.score}`;
      hudLives.textContent = `${t("lives")}: ${"★".repeat(state.lives)}`;
      hudBest.textContent = `${t("best")}: ${Math.max(best, state.score)}`;
      hud.dataset["phase"] = state.phase;
      if (state.phase === "over") void finishRound(state.score);
    },
  });
  await game.changeScene(scene);

  async function finishRound(score: number): Promise<void> {
    platform.gameplayStop();
    if (score > best) {
      best = score;
      await platform.storage.set(BEST_KEY, String(best));
    }
    element("over-score").textContent = `${t("score")}: ${score} · ${t("best")}: ${best}`;
    overScreen.hidden = false;
    element("again").focus();
  }

  function beginRound(): void {
    titleScreen.hidden = true;
    overScreen.hidden = true;
    hud.hidden = false;
    scene.start();
    platform.gameplayStart();
  }

  element("play").addEventListener("click", beginRound);
  element("again").addEventListener("click", beginRound);

  // Pointer covers mouse, pen and touch in one path.
  const steerTo = (event: PointerEvent): void => {
    const rect = container.getBoundingClientRect();
    scene.steer(event.clientX - rect.left);
  };
  container.addEventListener("pointerdown", steerTo);
  container.addEventListener("pointermove", steerTo);

  window.addEventListener("keydown", (event) => {
    const { phase, world, targetX } = scene.state;
    if (phase !== "playing") {
      if (
        (event.key === "Enter" || event.key === " ") &&
        document.activeElement === document.body
      ) {
        beginRound();
      }
      return;
    }
    const nudge = world.width * 0.06;
    if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      scene.steer(targetX - nudge);
      event.preventDefault();
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      scene.steer(targetX + nudge);
      event.preventDefault();
    }
  });

  // Rotation, window resizes, and an iframe the host page resizes all arrive here.
  new ResizeObserver(() => {
    const next = size();
    renderer.resize(next.width, next.height);
    scene.resize(next);
  }).observe(container);

  // A hidden tab stops the round; it resumes where it was when the tab comes back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      game.pause("hidden");
      platform.gameplayStop();
    } else {
      game.resume("hidden");
      if (!game.paused && scene.state.phase === "playing") platform.gameplayStart();
    }
  });

  progress(1);
  await platform.signalReady();
  const timeToInteractiveMs = performance.now();

  game.start();
  element("loading").hidden = true;
  titleScreen.hidden = false;
  element("play").focus();

  window.__gvdemo__ = {
    locale,
    platformId: platform.id,
    timeToInteractiveMs,
    phase: () => scene.state.phase,
    score: () => scene.state.score,
    lives: () => scene.state.lives,
    best: () => best,
    steps: () => scene.steps,
    stars: () => scene.state.stars.length,
    basketX: () => scene.state.basketX,
    targetX: () => scene.state.targetX,
    world: () => ({ ...scene.state.world }),
    framesRendered: () => game.framesRendered,
    paused: () => game.paused,
  };
  document.body.dataset["ready"] = "true";
}

void main().catch((error: unknown) => {
  // A reviewer must never see a silent black screen.
  document.body.dataset["ready"] = "false";
  const label = document.getElementById("loading-label");
  if (label)
    label.textContent = `Lỗi / Error: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
