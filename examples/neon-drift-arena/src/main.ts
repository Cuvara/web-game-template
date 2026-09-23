// Boot for Neon Drift Arena.
//
//   platform.initialize -> renderer.init (Three.js) -> scene ready -> signalReady
//
// The renderer is the template's ThreeRenderer (@wgf/three-framework), used exactly as its
// API dictates: construct it, init() it against a container, add meshes to `renderer.scene`,
// aim `renderer.camera`, and call renderer.render() once per frame. The Game's fixed-step
// loop drives the App scene; bindPlatform reports gameplayStart on first input.
//
// A read-only window.__game probe exposes the run so Playwright can drive and assert without
// reading pixels. Everything it exposes is the same state the game itself uses.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import type { Platform } from "@wgf/platform-sdk";
import { ThreeRenderer } from "@wgf/three-framework";
import type { PerspectiveCamera } from "three";
import { bindPlatform } from "../../../src/platform/bind.js";
import { App, type AppView } from "./app.js";
import { ArenaView } from "./game/arena-view.js";
import { Input } from "./input.js";

const PLATFORM_ID = "generic-web";
const GAME_ID = "neon-drift-arena";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

async function main(): Promise<void> {
  const boot = element("boot");
  const container = element("game");
  const hud = element("hud");
  const scoreEl = element("score");
  const bestEl = element("best");
  const menu = element("menu");
  const over = element("over");
  const overScore = element("over-score");
  const reviveBtn = element("revive") as HTMLButtonElement;
  const note = element("note");

  // Platform ONLY through the abstraction. generic-web has no portal SDK and no ads, so every
  // ad request resolves { shown: false } — which the App handles gracefully.
  const platform = createPlatform(PLATFORM_ID, { namespace: GAME_ID });
  await platform.initialize();
  platform.reportLoadingProgress(0.4);

  const renderer = new ThreeRenderer();
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    background: 0x05060f,
  });
  platform.reportLoadingProgress(0.7);

  // Aim the ThreeRenderer's camera down the arena. The renderer created it at (0,0,5) facing
  // -Z; lift and tilt it so the road reads in perspective.
  const camera = renderer.camera as PerspectiveCamera;
  camera.position.set(0, 4.5, 8);
  camera.lookAt(0, 0, -12);
  camera.updateProjectionMatrix();

  const view = new ArenaView();
  view.attach(renderer.scene);

  const game = new Game();
  const binding = bindPlatform(game, platform);

  const app = new App({
    game,
    platform,
    binding,
    view,
    present: () => renderer.render(),
    onChange: (v) => paintHud(v),
    seed: 1,
  });

  const input = new Input(container, {
    steer: (dir) => app.steer(dir),
    play: () => {
      if (app.phase === "menu") app.play();
    },
  });

  function paintHud(v: AppView): void {
    scoreEl.textContent = String(v.score);
    bestEl.textContent = String(v.best);
    hud.hidden = v.phase === "menu";
    menu.hidden = v.phase !== "menu";
    over.hidden = v.phase !== "over";
    overScore.textContent = String(v.score);
    reviveBtn.hidden = !v.canRevive;
  }

  element("play").addEventListener("click", () => app.play());
  element("restart").addEventListener("click", () => {
    note.textContent = "";
    void app.restart();
  });
  reviveBtn.addEventListener("click", () => {
    void app.revive().then((granted) => {
      if (!granted) note.textContent = "No ad available — start a new run instead.";
    });
  });

  await app.load();
  await game.changeScene(app);

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.resize(width, height);
    app.render();
  };
  resize();
  window.addEventListener("resize", resize);

  game.start();
  boot.remove();
  platform.reportLoadingProgress(1);
  await platform.signalReady();

  installProbe(app, game, input, platform);
  document.body.dataset["ready"] = "true";
}

/**
 * Read-and-drive probe for Playwright. Deterministic: `tick` and `steer` feed the pure
 * simulation directly, `spawnObstacleAt` places an obstacle with no RNG dependence, and
 * `restart` resets the run. Reading it never advances anything on its own.
 *
 * `gameplayActive` reads the platform through the abstraction (Platform.gameplayActive),
 * which is exactly what bindPlatform toggles when it reports gameplayStart/gameplayStop — so
 * a test can prove the first-input rule fired without touching a portal SDK. `runId` is a
 * per-run generation counter, so a restart can be proven to have begun a genuinely new run
 * regardless of how many RAF frames have advanced its time-based score since.
 */
function installProbe(app: App, game: Game, input: Input, platform: Platform): void {
  const api = {
    get score(): number {
      return app.score;
    },
    get best(): number {
      return app.best;
    },
    get state(): string {
      // "menu" | "playing" | "over" | (sim) "running" | "over"
      return app.phase === "playing" ? (app.simulation?.state ?? "playing") : app.phase;
    },
    get phase(): string {
      return app.phase;
    },
    get playerX(): number {
      return app.simulation?.playerX ?? 0;
    },
    /** The current run generation. Bumps on every fresh run (including a restart). */
    get runId(): number {
      return app.runId;
    },
    /** Whether the platform currently reports gameplay running — set via the abstraction. */
    gameplayActive: () => platform.gameplayActive,
    /** Begin a run from the menu. */
    play: () => app.play(),
    /** Advance the simulation by `dt` ms of simulation time (fixed-step friendly). */
    tick: (dt: number) => {
      // Route through the scene's update so game-over transitions fire exactly as in play.
      app.update(dt);
    },
    /** Steer: -1 left, +1 right, 0 coast. */
    steer: (dir: number) => app.steer(dir),
    /** Place an obstacle deterministically (no RNG) at lane x, distance z ahead. */
    spawnObstacleAt: (x: number, z: number, halfWidth?: number) =>
      app.simulation?.spawnObstacleAt(x, z, halfWidth),
    /** Restart after game over (shows an interstitial via the abstraction, then a new run). */
    restart: () => app.restart(),
    /** Offer the rewarded revive. Resolves true only when the portal confirms a reward. */
    revive: () => app.revive(),
    snapshot: () => app.simulation?.snapshot() ?? null,
    framesRendered: () => game.framesRendered,
    dispose: () => input.dispose(),
  };
  (window as unknown as { __game: typeof api }).__game = api;
}

void main().catch((error: unknown) => {
  // A boot failure must be visible, not a black screen.
  console.error(error);
  const boot = document.getElementById("boot");
  if (boot) {
    boot.dataset["state"] = "failed";
    boot.textContent = "The game could not start. Please reload.";
  }
});
