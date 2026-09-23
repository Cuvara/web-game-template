// Mouse, touch and keyboard, folded into the game's two-field input.
//
// Keys are read by `KeyboardEvent.code`, the physical key, so the controls work whatever
// the keyboard layout (requirement 1.6.2.4 — a Russian layout must not break A/D). Keys the
// game uses have their default action cancelled so arrows and space never scroll the page
// (1.10.2). Nothing here binds a combination the operating system reserves (1.6.2.6).

import type { GameInput } from "./game/catch-game.js";

const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);
// P only. Esc is the browser's own key for leaving fullscreen; doubling it as pause is the
// kind of reserved-shortcut overlap 1.6.2.6 asks games to avoid.
const PAUSE = new Set(["KeyP"]);
const SWALLOW = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"]);

export interface InputOptions {
  readonly surface: HTMLElement;
  /** Maps a client x coordinate to the playfield's normalised x. */
  readonly toPlayfieldX: (clientX: number) => number;
  readonly onPause: () => void;
}

export class Input {
  readonly #held = new Set<string>();
  #targetX: number | null = null;
  readonly #dispose: Array<() => void> = [];

  constructor(options: InputOptions) {
    const listen = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      handler: (event: WindowEventMap[K]) => void,
      passive = true,
    ): void => {
      target.addEventListener(type, handler as EventListener, { passive });
      this.#dispose.push(() => target.removeEventListener(type, handler as EventListener));
    };

    const steer = (event: PointerEvent): void => {
      this.#targetX = options.toPlayfieldX(event.clientX);
    };
    listen(options.surface, "pointerdown", steer);
    listen(options.surface, "pointermove", steer);

    listen(
      window,
      "keydown",
      (event) => {
        if (SWALLOW.has(event.code)) event.preventDefault();
        if (PAUSE.has(event.code)) {
          if (!event.repeat) options.onPause();
          return;
        }
        if (LEFT.has(event.code) || RIGHT.has(event.code)) {
          this.#held.add(event.code);
          // The keyboard has taken over; a stale pointer target would pull the basket back.
          this.#targetX = null;
        }
      },
      false,
    );
    listen(window, "keyup", (event) => this.#held.delete(event.code));
    // Keys held while focus leaves never get their keyup.
    listen(window, "blur", () => this.#held.clear());
  }

  read(): GameInput {
    const left = [...LEFT].some((code) => this.#held.has(code));
    const right = [...RIGHT].some((code) => this.#held.has(code));
    const axis = left === right ? 0 : left ? -1 : 1;
    return { targetX: this.#targetX, axis };
  }

  /** Forget any steering, e.g. between runs. */
  reset(): void {
    this.#held.clear();
    this.#targetX = null;
  }

  dispose(): void {
    for (const off of this.#dispose.splice(0)) off();
  }
}
