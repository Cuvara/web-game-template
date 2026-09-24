// Boot.
//
//   platform init -> renderer -> scene on screen -> Game Ready
//
// Everything platform-facing goes through the Platform contract from @wgf/platform-sdk and the
// template's bindPlatform/withAdBreak helpers. Nothing here reads window.YaGames, CrazyGames,
// PokiSDK or gamevui — the platform is chosen by id from game.config.yaml and constructed with
// createPlatform, so the same source runs against any portal the Factory supports.

import { Game } from "@wgf/game-core";
import { createPlatform } from "@wgf/platform-sdk";
import { PixiRenderer } from "@wgf/pixi-framework";
import { installProbe } from "../../../src/core/probe.js";
import { App, type Hud } from "./app.js";
import { BoardView } from "./rendering/board-view.js";
import { COLUMNS } from "./game/rules.js";

const GAME_ID = "tower-merge-rush";
const GAME_VERSION = "0.1.0";
const PLATFORM_ID = "generic-web";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

/** The DOM overlay: HUD plus the start and game-over screens. */
class DomUi implements Hud {
  readonly #root: HTMLElement;
  readonly #hud: HTMLElement;
  readonly #score: HTMLElement;
  readonly #drop: HTMLElement;
  readonly #start: HTMLElement;
  readonly #over: HTMLElement;
  readonly #overScore: HTMLElement;
  readonly #note: HTMLElement;
  readonly #continueBtn: HTMLButtonElement;
  readonly #doubleBtn: HTMLButtonElement;
  readonly #restartBtn: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    actions: {
      begin: () => void;
      continue: () => void;
      double: () => void;
      restart: () => void;
    },
  ) {
    this.#root = root;
    root.innerHTML = `
      <div class="hud" data-role="hud">
        <span data-role="score">Score 0</span>
        <span class="spacer"></span>
        <span data-role="drop">Next lvl 1</span>
      </div>
      <section class="screen" data-screen="start" data-role="start">
        <h1>Tower Merge Rush</h1>
        <p>Drop towers onto the track. Two equal levels merge into one higher level. Tap a
          column or press 1–${COLUMNS}. Fill the track with no merge and it is over.</p>
        <button data-action="play">Play</button>
      </section>
      <section class="screen" data-screen="over" data-role="over" hidden>
        <h1>Game Over</h1>
        <p data-role="over-score">Score 0</p>
        <p class="note" data-role="note"></p>
        <div class="row">
          <button class="ad" data-action="continue">Continue (ad)</button>
          <button class="ad secondary" data-action="double">Double score (ad)</button>
        </div>
        <button data-action="restart">Play again</button>
      </section>`;

    this.#hud = root.querySelector('[data-role="hud"]')!;
    this.#score = root.querySelector('[data-role="score"]')!;
    this.#drop = root.querySelector('[data-role="drop"]')!;
    this.#start = root.querySelector('[data-role="start"]')!;
    this.#over = root.querySelector('[data-role="over"]')!;
    this.#overScore = root.querySelector('[data-role="over-score"]')!;
    this.#note = root.querySelector('[data-role="note"]')!;
    this.#continueBtn = root.querySelector('[data-action="continue"]')!;
    this.#doubleBtn = root.querySelector('[data-action="double"]')!;
    this.#restartBtn = root.querySelector('[data-action="restart"]')!;

    root.querySelector('[data-action="play"]')!.addEventListener("click", actions.begin);
    this.#continueBtn.addEventListener("click", actions.continue);
    this.#doubleBtn.addEventListener("click", actions.double);
    this.#restartBtn.addEventListener("click", actions.restart);
  }

  setState(state: "start" | "playing" | "over"): void {
    this.#start.hidden = state !== "start";
    this.#over.hidden = state !== "over";
    this.#hud.hidden = state === "start";
    this.#root.dataset["screen"] = state;
  }
  setScore(score: number): void {
    this.#score.textContent = `Score ${score}`;
  }
  setDropLevel(level: number): void {
    this.#drop.textContent = `Next lvl ${level}`;
  }
  setNote(text: string): void {
    this.#note.textContent = text;
  }
  setBusy(busy: boolean): void {
    this.#continueBtn.disabled = busy;
    this.#doubleBtn.disabled = busy;
    this.#restartBtn.disabled = busy;
  }
  setOver(view: { score: number; canContinue: boolean }): void {
    this.#overScore.textContent = `Score ${view.score}`;
    this.#continueBtn.hidden = !view.canContinue;
  }
}

async function main(): Promise<void> {
  const boot = element("boot");
  const container = element("game");
  const uiRoot = element("ui");

  // Chosen by id from game.config.yaml. createPlatform maps it to the right adapter; the game
  // never names a portal. generic-web needs no external SDK, so this example runs anywhere.
  const platform = createPlatform(PLATFORM_ID, { namespace: GAME_ID });
  await platform.initialize();
  platform.reportLoadingProgress(0.4);

  const renderer = new PixiRenderer();
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    background: 0x0b1026,
  });
  platform.reportLoadingProgress(0.8);

  const view = new BoardView(renderer.stage);
  const game = new Game();
  const present = (): void => renderer.render();

  // Forward declaration: the DomUi callbacks close over `app`, which is built after `ui`
  // (ui -> app -> ui is a construction cycle), so this cannot be a const.
  // eslint-disable-next-line prefer-const
  let app: App;
  const ui = new DomUi(uiRoot, {
    begin: () => app.dropAnywhere(),
    continue: () => void app.continue(),
    double: () => void app.doubleScore(),
    restart: () => void app.restart(),
  });

  app = new App({ game, platform, hud: ui, view, present });
  await game.changeScene(app);

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.resize(width, height);
    view.resize(width, height);
    app.render();
  };
  resize();
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);

  // Input. A tap on the canvas maps to a column; keys 1..COLUMNS drop into that column, and
  // Space/Enter drop into the first open one. All of it goes through the App, never the
  // platform. The first such input is what bindPlatform reports gameplayStart on.
  const columnFromClientX = (clientX: number): number => {
    const rect = container.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.min(COLUMNS - 1, Math.max(0, Math.floor(ratio * COLUMNS)));
  };
  container.addEventListener("pointerdown", (event) => {
    app.drop(columnFromClientX(event.clientX));
  });
  window.addEventListener("keydown", (event) => {
    if (event.key >= "1" && event.key <= String(COLUMNS)) {
      app.drop(Number(event.key) - 1);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      app.dropAnywhere();
    }
  });

  game.start();
  boot.remove();

  platform.reportLoadingProgress(1);
  await platform.signalReady();
  const timeToInteractiveMs = performance.now();

  installProbe({
    game,
    platform,
    gameId: GAME_ID,
    gameVersion: GAME_VERSION,
    engine: "pixijs",
    timeToInteractiveMs,
  });
  installGameHooks(app, game, platform);
  uiRoot.dataset["ready"] = "true";
}

/**
 * Deterministic, read-only test hooks. A Playwright test drives the game and asserts on it
 * without reading pixels: dropAt/dropAnywhere make moves, the getters report state. Writing
 * goes through the App (and thus the same rules and platform wiring the player hits), so the
 * hooks can never reach a state real play could not.
 */
function installGameHooks(app: App, game: Game, platform: ReturnType<typeof createPlatform>): void {
  (window as unknown as { __game: unknown }).__game = {
    get state() {
      return app.merge.state;
    },
    get score() {
      return app.merge.score;
    },
    get merges() {
      return app.merge.merges;
    },
    get dropLevel() {
      return app.merge.dropLevel;
    },
    get board() {
      return [...app.merge.board];
    },
    levelAt: (col: number) => app.merge.levelAt(col),
    dropAt: (col: number) => app.drop(col),
    dropAnywhere: () => app.dropAnywhere(),
    continue: () => app.continue(),
    doubleScore: () => app.doubleScore(),
    restart: () => app.restart(),
    paused: () => game.paused,
    gameplayActive: () => platform.gameplayActive,
  };
}

void main().catch((error: unknown) => {
  // A boot failure must be visible, never a black screen.
  console.error(error);
  const boot = document.getElementById("boot");
  if (boot) {
    boot.dataset["state"] = "failed";
    boot.textContent = "The game could not start. Please reload the page.";
  }
});
