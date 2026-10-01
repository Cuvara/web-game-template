// The DOM overlay for Tower Merge Rush: in-run HUD plus the title, pause and game-over
// screens. Every string comes from the locale table (public/locales/<locale>.json).
//
// GOLDEN-RUN REPLAY. Ported from examples/tower-merge-rush/src/main.ts (DomUi) by the
// Factory's golden-run replay developer; not agent-written code. Dressed in the design's
// identity: the wordmark on the title, the icon set on every button, the next piece drawn
// from the tower art, each screen on the ui-kit card - all resolved from the runtime asset
// manifest (uiArt below). index.html holds the styles; nothing is a browser default.

import type { RuntimeAssets } from "../game/runtime-assets.js";
import type { I18n } from "../core/i18n.js";
import type { Hud } from "../game/app.js";
import { COLUMNS, type State } from "../game/rules.js";

export interface ScreenActions {
  begin(): void;
  continue(): void;
  double(): void;
  restart(): void;
  pause(): void;
  resume(): void;
  /** Flip the player's own sound setting; returns whether sound is now on. */
  toggleSound(): boolean;
}

type IconName = "play" | "pause" | "retry" | "menu" | "sound" | "ad";
/** The design's icon set, in its stated order: play, pause, retry, menu, sound, ad glyph. */
const ICON_ORDER: readonly IconName[] = ["play", "pause", "retry", "menu", "sound", "ad"];

/** What the overlay draws with: URLs from the runtime asset manifest, or null (greybox). */
export interface UiArt {
  readonly wordmark: string | null;
  readonly panel: string | null;
  readonly icons: Readonly<Partial<Record<IconName, string>>>;
  /** The tower drawing for a level. */
  piece(level: number): string | null;
  /** Every asset id the overlay shows, for preloading. */
  readonly ids: readonly string[];
}

export function uiArt(assets: RuntimeAssets): UiArt {
  const wordmark = assets.find({ id: "wordmark", role: "ui", wide: true });
  const panel = assets.find({ id: "ui-kit", role: "ui", wide: false });
  const iconIds = assets.drawings({ id: "icons", role: "icon" });
  const pieces = assets.drawings({ id: "pieces", role: "target" });
  const icons: Partial<Record<IconName, string>> = {};
  // A single drawing is a stand-in for the whole set; it would mislabel every button.
  if (iconIds.length >= ICON_ORDER.length) {
    ICON_ORDER.forEach((name, n) => {
      const url = assets.url(iconIds[n] ?? null);
      if (url) icons[name] = url;
    });
  }
  return {
    wordmark: assets.url(wordmark),
    panel: assets.url(panel),
    icons,
    piece: (level) =>
      pieces.length ? assets.url(pieces[Math.min(level, pieces.length) - 1] ?? null) : null,
    ids: [wordmark, panel, ...iconIds].filter((id): id is string => id !== null),
  };
}

export class Screens implements Hud {
  readonly #root: HTMLElement;
  readonly #i18n: I18n;
  readonly #art: UiArt;
  readonly #hud: HTMLElement;
  readonly #objective: HTMLElement;
  readonly #score: HTMLElement;
  readonly #best: HTMLElement;
  readonly #next: HTMLImageElement;
  readonly #nextLevel: HTMLElement;
  readonly #start: HTMLElement;
  readonly #pause: HTMLElement;
  readonly #over: HTMLElement;
  readonly #overScore: HTMLElement;
  readonly #overBest: HTMLElement;
  readonly #note: HTMLElement;
  readonly #controls: HTMLElement;
  readonly #continueBtn: HTMLButtonElement;
  readonly #doubleBtn: HTMLButtonElement;
  readonly #restartBtn: HTMLButtonElement;
  #shown = { score: -1, best: -1, level: -1 };

  constructor(root: HTMLElement, i18n: I18n, actions: ScreenActions, art: UiArt) {
    this.#root = root;
    this.#i18n = i18n;
    this.#art = art;
    const t = (key: string): string => i18n.t(key);
    const icon = (name: IconName): string =>
      art.icons[name] ? `<img class="icon" src="${art.icons[name]}" alt="" draggable="false">` : "";
    const title = art.wordmark
      ? `<img class="wordmark" src="${art.wordmark}" alt="${t("title.heading")}" draggable="false">`
      : t("title.heading");
    if (art.panel) root.style.setProperty("--panel", `url("${art.panel}")`);
    root.dataset["art"] = art.panel ? "manifest" : "none";
    root.innerHTML = `
      <div class="hud" data-role="hud" hidden>
        <span class="chip"><small>${t("hud.score")}</small><b data-role="score">0</b></span>
        <span class="chip"><small>${t("hud.best")}</small><b data-role="best">0</b></span>
        <span class="chip next"><small>${t("hud.next")}</small>
          <img data-role="next" alt="" draggable="false"><b data-role="next-level"></b></span>
      </div>
      <p class="objective" data-role="objective" hidden>${t("hud.objective")}</p>
      <div class="controls" data-role="controls" hidden>
        <button class="icon-btn" data-action="sound" aria-pressed="true"
          aria-label="${t("hud.sound")}" title="${t("hud.sound")}">${icon("sound")}</button>
        <button class="icon-btn pause" data-action="pause" aria-label="${t("hud.pause")}"
          title="${t("hud.pause")}">${icon("pause") || t("hud.pause")}</button>
      </div>
      <section class="screen" data-screen="start" data-role="start">
        <div class="card">
          <h1>${title}</h1>
          <p data-role="rules">${t("title.rules").replace("1-7", `1-${COLUMNS}`)}</p>
          <button class="btn primary big" data-action="play">${icon("play")}${t("title.play")}</button>
        </div>
      </section>
      <section class="screen" data-screen="pause" data-role="pause" hidden>
        <div class="card">
          <h2>${t("pause.heading")}</h2>
          <button class="btn primary big" data-action="resume">${icon("play")}${t("pause.resume")}</button>
        </div>
      </section>
      <section class="screen" data-screen="over" data-role="over" hidden>
        <div class="card">
          <h2>${t("over.heading")}</h2>
          <p class="result"><small>${t("over.score")}</small><b data-role="over-score">0</b></p>
          <p class="best" data-role="over-best"></p>
          <p class="note" data-role="note"></p>
          <div class="row">
            <button class="btn secondary ad" data-action="continue">${icon("ad")}${t("over.continue")}</button>
            <button class="btn secondary ad" data-action="double">${icon("ad")}${t("over.double")}</button>
          </div>
          <button class="btn primary big" data-action="restart">${icon("retry")}${t("over.restart")}</button>
        </div>
      </section>`;

    const find = <T extends HTMLElement>(selector: string): T => {
      const found = root.querySelector<T>(selector);
      if (!found) throw new Error(`ui is missing ${selector}`);
      return found;
    };
    this.#hud = find('[data-role="hud"]');
    this.#objective = find('[data-role="objective"]');
    this.#score = find('[data-role="score"]');
    this.#best = find('[data-role="best"]');
    this.#next = find('[data-role="next"]');
    this.#nextLevel = find('[data-role="next-level"]');
    this.#start = find('[data-role="start"]');
    this.#pause = find('[data-role="pause"]');
    this.#over = find('[data-role="over"]');
    this.#overScore = find('[data-role="over-score"]');
    this.#overBest = find('[data-role="over-best"]');
    this.#note = find('[data-role="note"]');
    this.#controls = find('[data-role="controls"]');
    this.#continueBtn = find('[data-action="continue"]');
    this.#doubleBtn = find('[data-action="double"]');
    this.#restartBtn = find('[data-action="restart"]');
    const sound = find<HTMLButtonElement>('[data-action="sound"]');

    find('[data-action="play"]').addEventListener("click", actions.begin);
    find('[data-action="resume"]').addEventListener("click", actions.resume);
    find('[data-action="pause"]').addEventListener("click", actions.pause);
    sound.addEventListener("click", () => {
      sound.setAttribute("aria-pressed", String(actions.toggleSound()));
    });
    this.#continueBtn.addEventListener("click", actions.continue);
    this.#doubleBtn.addEventListener("click", actions.double);
    this.#restartBtn.addEventListener("click", actions.restart);
    // A press on the overlay's own controls is not a drop on the track below it.
    this.#controls.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  setState(state: State): void {
    this.#start.hidden = state !== "start";
    this.#over.hidden = state !== "over";
    this.#hud.hidden = state === "start";
    // The objective stays on screen through play: a first-time player reads it there.
    this.#objective.hidden = state !== "playing";
    this.#controls.hidden = state !== "playing";
    this.#root.dataset["screen"] = state;
  }
  setPaused(paused: boolean): void {
    this.#pause.hidden = !paused;
  }
  setScore(score: number): void {
    if (score === this.#shown.score) return;
    this.#shown.score = score;
    this.#score.textContent = String(score);
    this.#bump(this.#score);
  }
  setBest(best: number): void {
    if (best === this.#shown.best) return;
    this.#shown.best = best;
    this.#best.textContent = String(best);
    this.#overBest.textContent = `${this.#i18n.t("over.best")} ${best}`;
  }
  setDropLevel(level: number): void {
    if (level === this.#shown.level) return;
    this.#shown.level = level;
    const url = this.#art.piece(level);
    this.#next.hidden = !url;
    if (url) this.#next.src = url;
    this.#nextLevel.textContent = String(level);
    this.#bump(this.#next.parentElement!);
  }
  setNote(key: string | null): void {
    this.#note.textContent = key ? this.#i18n.t(key) : "";
  }
  setBusy(busy: boolean): void {
    this.#continueBtn.disabled = busy;
    this.#doubleBtn.disabled = busy;
    this.#restartBtn.disabled = busy;
  }
  setOver(view: { score: number; canContinue: boolean; canOffer: boolean }): void {
    this.#overScore.textContent = String(view.score);
    this.#continueBtn.hidden = !view.canContinue || !view.canOffer;
    this.#doubleBtn.hidden = !view.canOffer;
  }

  /** A short pop on a value that changed (index.html's .bump). */
  #bump(element: HTMLElement): void {
    element.classList.remove("bump");
    void element.offsetWidth;
    element.classList.add("bump");
  }
}
