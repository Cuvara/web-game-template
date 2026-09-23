// Keyboard, mouse and touch.
//
// Two jobs besides reading the controls. Poki frames the game in an iframe on a scrolling
// page, and its HTML5 guide says to stop Space, the arrow keys and the wheel from scrolling
// that page. And its requirements say to force the mobile control scheme on tablets, so the
// scheme is chosen by the input hardware (a coarse pointer, or touch points), not by screen
// size — an iPad in landscape is as wide as a laptop.

export type ControlScheme = "touch" | "keyboard";

const SCROLL_KEYS = new Set([
  " ",
  "Spacebar",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
]);

export function detectScheme(): ControlScheme {
  const query = (media: string): boolean =>
    typeof matchMedia === "function" && matchMedia(media).matches;
  // A phone or tablet: the primary pointer is a finger.
  if (query("(pointer: coarse)")) return "touch";
  // Touch points with no fine pointer anywhere: still a touch device. A touchscreen laptop
  // has a trackpad or mouse too, and keeps the keyboard scheme.
  if (navigator.maxTouchPoints > 0 && !query("(any-pointer: fine)")) return "touch";
  return "keyboard";
}

export interface InputHandlers {
  /** Checked on every event. False during ad breaks, which must not receive input. */
  enabled(): boolean;
  onPause(): void;
}

export class Controls {
  #left = false;
  #right = false;
  #pointerX: number | null = null;
  readonly #handlers: InputHandlers;
  readonly #dispose: Array<() => void> = [];

  constructor(handlers: InputHandlers) {
    this.#handlers = handlers;
  }

  /** -1, 0 or 1 from held keys and touch buttons. */
  get axis(): number {
    return (this.#right ? 1 : 0) - (this.#left ? 1 : 0);
  }

  /** Where a held pointer on the canvas is, in CSS pixels. Null when none is held. */
  get pointerX(): number | null {
    return this.#pointerX;
  }

  release(): void {
    this.#left = false;
    this.#right = false;
    this.#pointerX = null;
  }

  attach(canvasHost: HTMLElement, leftButton: HTMLElement, rightButton: HTMLElement): void {
    this.#listen(window, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (SCROLL_KEYS.has(key)) event.preventDefault();
      if (!this.#handlers.enabled()) return;
      // Esc, as Poki's guidelines suggest. Not Space: it also starts the game from the title.
      if (key === "Escape" || key === "p" || key === "P") this.#handlers.onPause();
      if (key === "ArrowLeft" || key === "a" || key === "A") this.#left = true;
      if (key === "ArrowRight" || key === "d" || key === "D") this.#right = true;
    });
    this.#listen(window, "keyup", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "ArrowLeft" || key === "a" || key === "A") this.#left = false;
      if (key === "ArrowRight" || key === "d" || key === "D") this.#right = false;
    });
    this.#listen(window, "wheel", (event) => event.preventDefault(), { passive: false });
    this.#listen(window, "blur", () => this.release());

    this.#listen(canvasHost, "pointerdown", (event) => {
      if (!this.#handlers.enabled()) return;
      this.#pointerX = (event as PointerEvent).clientX;
    });
    this.#listen(canvasHost, "pointermove", (event) => {
      if (this.#pointerX !== null) this.#pointerX = (event as PointerEvent).clientX;
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      this.#listen(canvasHost, type, () => (this.#pointerX = null));
    }

    this.#hold(leftButton, (held) => (this.#left = held));
    this.#hold(rightButton, (held) => (this.#right = held));
  }

  detach(): void {
    for (const dispose of this.#dispose.splice(0)) dispose();
  }

  #hold(button: HTMLElement, set: (held: boolean) => void): void {
    this.#listen(button, "pointerdown", (event) => {
      event.preventDefault();
      if (this.#handlers.enabled()) set(true);
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      this.#listen(button, type, () => set(false));
    }
  }

  #listen(
    target: EventTarget,
    type: string,
    listener: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.#dispose.push(() => target.removeEventListener(type, listener, options));
  }
}
