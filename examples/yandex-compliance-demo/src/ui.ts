// The DOM layer over the canvas: menu, HUD, pause and game-over screens.
//
// Text lives in the DOM rather than in the canvas so it is crisp at any scale and every
// string comes from public/locales/ — which is what lets a moderator switching the
// language in the debug panel see the whole game change (2.14, 8.2.3).
//
// Buttons carry data-action attributes; the e2e suite clicks by those, not by text, so the
// tests pass in every language.

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface UiHandlers {
  readonly play: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly menu: () => void;
  readonly again: () => void;
  readonly revive: () => void;
  readonly toggleSound: () => void;
}

export type Screen = "loading" | "menu" | "playing" | "paused" | "over" | "ad";

interface OverView {
  readonly score: number;
  readonly best: number;
  readonly newBest: boolean;
  readonly canRevive: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

export class Ui {
  readonly #root: HTMLElement;
  readonly #t: Translate;

  readonly #hud: HTMLElement;
  readonly #score: HTMLElement;
  readonly #lives: HTMLElement;
  readonly #sound: HTMLButtonElement;

  readonly #menu: HTMLElement;
  readonly #menuBest: HTMLElement;

  readonly #paused: HTMLElement;

  readonly #over: HTMLElement;
  readonly #overScore: HTMLElement;
  readonly #overBest: HTMLElement;
  readonly #overNewBest: HTMLElement;
  readonly #revive: HTMLButtonElement;
  readonly #note: HTMLElement;

  constructor(root: HTMLElement, t: Translate, handlers: UiHandlers) {
    this.#root = root;
    this.#t = t;

    const button = (
      action: string,
      label: string,
      handler: () => void,
      className = "",
    ): HTMLButtonElement => {
      const node = el("button", { type: "button", "data-action": action }, [label]);
      if (className) node.className = className;
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
      });
      return node;
    };

    this.#score = el("span", { "data-role": "score" });
    this.#lives = el("span", { "data-role": "lives" });
    this.#sound = button("sound", "", handlers.toggleSound, "secondary");
    this.#hud = el("div", { class: "hud" }, [
      this.#score,
      this.#lives,
      el("span", { class: "spacer" }),
      this.#sound,
      button("pause", t("hud.pause"), handlers.pause, "secondary"),
    ]);

    this.#menuBest = el("p", { "data-role": "menu-best" });
    this.#menu = el("section", { class: "screen", "data-screen": "menu" }, [
      el("h1", {}, [t("title")]),
      el("p", {}, [t("menu.howto")]),
      el("p", {}, [t("menu.controls.pointer")]),
      el("p", {}, [t("menu.controls.keyboard")]),
      this.#menuBest,
      button("play", t("menu.play"), handlers.play),
    ]);

    this.#paused = el("section", { class: "screen", "data-screen": "paused" }, [
      el("h1", {}, [t("pause.title")]),
      button("resume", t("pause.continue"), handlers.resume),
      button("menu", t("pause.menu"), handlers.menu, "secondary"),
    ]);

    this.#overScore = el("p", { "data-role": "over-score" });
    this.#overBest = el("p", { "data-role": "over-best" });
    this.#overNewBest = el("p", { "data-role": "new-best" }, [t("over.newBest")]);
    this.#revive = button("revive", t("over.revive"), handlers.revive, "ad");
    this.#note = el("p", { class: "note", "data-role": "note" });
    this.#over = el("section", { class: "screen", "data-screen": "over" }, [
      el("h1", {}, [t("over.title")]),
      this.#overScore,
      this.#overBest,
      this.#overNewBest,
      button("again", t("over.again"), handlers.again),
      this.#revive,
      button("menu", t("over.menu"), handlers.menu, "secondary"),
      this.#note,
    ]);

    root.append(this.#hud, this.#menu, this.#paused, this.#over);
    this.show("loading");
  }

  show(screen: Screen): void {
    this.#root.dataset["screen"] = screen;
    this.#hud.hidden = screen !== "playing";
    this.#menu.hidden = screen !== "menu";
    this.#paused.hidden = screen !== "paused";
    this.#over.hidden = screen !== "over";
  }

  setScore(score: number, lives: number): void {
    this.#score.textContent = this.#t("hud.score", { score });
    this.#lives.textContent = this.#t("hud.lives", { lives });
  }

  setBest(best: number): void {
    this.#menuBest.textContent = this.#t("menu.best", { best });
  }

  setSound(enabled: boolean): void {
    this.#sound.textContent = this.#t(enabled ? "hud.sound.on" : "hud.sound.off");
    this.#sound.dataset["enabled"] = String(enabled);
  }

  setOver(view: OverView): void {
    this.#overScore.textContent = this.#t("over.score", { score: view.score });
    this.#overBest.textContent = this.#t("over.best", { best: view.best });
    this.#overNewBest.hidden = !view.newBest;
    this.#revive.hidden = !view.canRevive;
    this.setNote("");
  }

  setNote(text: string): void {
    this.#note.textContent = text;
  }

  /** Buttons that start an ad are disabled while one is on screen. */
  setBusy(busy: boolean): void {
    for (const node of this.#root.querySelectorAll("button")) node.disabled = busy;
  }
}
