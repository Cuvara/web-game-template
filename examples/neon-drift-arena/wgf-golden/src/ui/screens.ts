// The DOM overlay for Neon Drift Arena: score HUD plus the menu, pause and crash screens.
// Every string comes from the locale table (public/locales/<locale>.json).
//
// GOLDEN-RUN REPLAY. Ported from examples/neon-drift-arena (index.html and the paintHud
// block of src/main.ts) by the Factory's golden-run replay developer; not agent-written.
// Dressed in the design's identity kit (neon-night): the bundled faces (index.html's
// --font-* stacks, loaded by rendering/threejs/assets.ts), the title wordmark and the icon
// glyphs from the runtime asset manifest, and in-run feedback - a near-miss call-out and a
// crash flash. A sound toggle sits in the bottom-left corner on every screen.

import type { I18n } from "../core/i18n.js";
import type { AppView } from "../game/app.js";

export interface ScreenActions {
  play(): void;
  revive(): Promise<boolean>;
  restart(): void;
  pause(): void;
  resume(): void;
  /** Flip the player's own sound setting; returns whether sound is now on. */
  toggleSound(): boolean;
}

/** UI art from the runtime asset manifest: absolute URLs, or null when not delivered. */
export interface ScreenArt {
  readonly wordmark: string | null;
  readonly panel: string | null;
  readonly icons: Readonly<Record<string, string>>;
}

export class Screens {
  readonly #i18n: I18n;
  readonly #root: HTMLElement;
  readonly #hud: HTMLElement;
  readonly #objective: HTMLElement;
  readonly #score: HTMLElement;
  readonly #best: HTMLElement;
  readonly #menu: HTMLElement;
  readonly #pause: HTMLElement;
  readonly #pauseBtn: HTMLElement;
  readonly #over: HTMLElement;
  readonly #overScore: HTMLElement;
  readonly #overBest: HTMLElement;
  readonly #revive: HTMLButtonElement;
  readonly #note: HTMLElement;
  readonly #callout: HTMLElement;
  #phase = "";
  #calloutTimer = 0;

  constructor(root: HTMLElement, i18n: I18n, art: ScreenArt, actions: ScreenActions) {
    this.#i18n = i18n;
    this.#root = root;
    const t = (key: string): string => i18n.t(key);
    const icon = (name: string): string =>
      art.icons[name]
        ? `<span class="icon" aria-hidden="true" style="--icon: url('${art.icons[name]}')"></span>`
        : "";
    const heading = art.wordmark
      ? `<h1 class="wordmark"><img src="${art.wordmark}" alt="${t("title.heading")}" /></h1>`
      : `<h1>${t("title.heading")}</h1>`;
    const card = art.panel ? "card kit" : "card";
    if (art.panel) root.style.setProperty("--panel", `url('${art.panel}')`);
    root.innerHTML = `
      <div id="score-hud" class="hud" hidden>
        <span class="hud-best">${t("hud.best")} <b id="best">0</b></span>
        <span class="hud-score"><small>${t("hud.score")}</small><b id="score">0</b></span>
      </div>
      <p id="objective" class="objective" hidden>${t("hud.objective")}</p>
      <p id="callout" class="callout" aria-live="polite" hidden>${t("hud.near-miss")}</p>
      <div id="crash-flash" class="crash-flash" hidden></div>
      <button id="pause" class="pause square" aria-label="${t("hud.pause")}" hidden>${icon("pause")}<span class="label">${t("hud.pause")}</span></button>
      <div id="menu" class="screen title" data-screen="start">
        ${heading}
        <p class="tagline">${t("title.rules")}</p>
        <button id="play" class="primary">${icon("play")}${t("title.play")}</button>
      </div>
      <div id="paused" class="screen" data-screen="pause" hidden>
        <div class="${card}">
          <h2>${t("pause.heading")}</h2>
          <button id="resume" class="primary">${icon("play")}${t("pause.resume")}</button>
        </div>
      </div>
      <div id="over" class="screen" data-screen="over" hidden>
        <div class="${card} result">
          <h2>${t("over.heading")}</h2>
          <div class="stats">
            <p><small>${t("over.score")}</small><b id="over-score">0</b></p>
            <p><small>${t("over.best")}</small><b id="over-best">0</b></p>
          </div>
          <div class="note" id="note"></div>
          <button id="restart" class="primary">${icon("retry")}${t("over.restart")}</button>
          <button id="revive" class="square" hidden>${icon("ad")}${t("over.revive")}</button>
        </div>
      </div>
      <button id="sound" class="sound square" aria-pressed="true" aria-label="${t("hud.sound")}"
        title="${t("hud.sound")}">${icon("sound")}<span class="label">${t("hud.sound")}</span></button>`;

    const find = <T extends HTMLElement>(id: string): T => {
      const found = root.querySelector<T>(`#${id}`);
      if (!found) throw new Error(`ui is missing #${id}`);
      return found;
    };
    this.#hud = find("score-hud");
    this.#objective = find("objective");
    this.#score = find("score");
    this.#best = find("best");
    this.#menu = find("menu");
    this.#pause = find("paused");
    this.#pauseBtn = find("pause");
    this.#over = find("over");
    this.#overScore = find("over-score");
    this.#overBest = find("over-best");
    this.#revive = find<HTMLButtonElement>("revive");
    this.#note = find("note");
    this.#callout = find("callout");

    find("play").addEventListener("click", () => actions.play());
    find("resume").addEventListener("click", () => actions.resume());
    this.#pauseBtn.addEventListener("click", () => actions.pause());
    find("restart").addEventListener("click", () => {
      this.#note.textContent = "";
      actions.restart();
    });
    const sound = find<HTMLButtonElement>("sound");
    sound.addEventListener("click", () => {
      const on = actions.toggleSound();
      sound.setAttribute("aria-pressed", String(on));
      sound.classList.toggle("off", !on);
    });
    this.#revive.addEventListener("click", () => {
      void actions.revive().then((granted) => {
        if (!granted) this.#note.textContent = this.#i18n.t("note.no-ad");
      });
    });
  }

  /** A wall passed close: a short call-out above the craft. */
  nearMiss(): void {
    if (this.#phase !== "playing") return;
    this.#callout.hidden = false;
    // Restart the pop animation.
    this.#callout.classList.remove("pop");
    void this.#callout.offsetWidth;
    this.#callout.classList.add("pop");
    window.clearTimeout(this.#calloutTimer);
    this.#calloutTimer = window.setTimeout(() => {
      this.#callout.hidden = true;
    }, 1000);
  }

  paint(v: AppView): void {
    if (v.phase === "over" && this.#phase === "playing") this.#crashFlash();
    this.#phase = v.phase;
    this.#root.dataset["phase"] = v.phase;
    this.#score.textContent = String(v.score);
    this.#best.textContent = String(v.best);
    this.#hud.hidden = v.phase === "menu";
    // The objective stays on screen through play: a first-time player reads it there.
    this.#objective.hidden = v.phase !== "playing";
    if (v.phase !== "playing") this.#callout.hidden = true;
    this.#pauseBtn.hidden = v.phase !== "playing" || v.paused;
    this.#menu.hidden = v.phase !== "menu";
    this.#pause.hidden = !(v.paused && v.phase === "playing");
    this.#over.hidden = v.phase !== "over";
    this.#overScore.textContent = String(v.score);
    this.#overBest.textContent = String(v.best);
    this.#revive.hidden = !v.canRevive;
  }

  #crashFlash(): void {
    const flash = this.#root.querySelector<HTMLElement>("#crash-flash");
    if (!flash) return;
    flash.hidden = false;
    flash.classList.remove("go");
    void flash.offsetWidth;
    flash.classList.add("go");
    window.setTimeout(() => {
      flash.hidden = true;
    }, 600);
  }
}
