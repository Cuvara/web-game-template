// Keyboard and pointer steering for Neon Drift Arena.
//
// Translates raw browser events into a single steer direction in [-1, 1] and pushes it into
// the App. It holds no gameplay state — the direction it computes is the whole of its output
// — so the deterministic simulation stays the single source of truth and the unit tests can
// drive the App without any of this.

export interface InputTarget {
  steer(direction: number): void;
  play(): void;
}

const LEFT_KEYS = new Set(["ArrowLeft", "KeyA"]);
const RIGHT_KEYS = new Set(["ArrowRight", "KeyD"]);

export class Input {
  readonly #surface: HTMLElement;
  readonly #target: InputTarget;
  readonly #held = new Set<string>();
  #pointerDir = 0;
  #disposed = false;

  constructor(surface: HTMLElement, target: InputTarget) {
    this.#surface = surface;
    this.#target = target;

    window.addEventListener("keydown", this.#onKeyDown, { passive: true });
    window.addEventListener("keyup", this.#onKeyUp, { passive: true });
    surface.addEventListener("pointerdown", this.#onPointer);
    surface.addEventListener("pointermove", this.#onPointer);
    surface.addEventListener("pointerup", this.#onPointerEnd);
    surface.addEventListener("pointercancel", this.#onPointerEnd);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
    this.#surface.removeEventListener("pointerdown", this.#onPointer);
    this.#surface.removeEventListener("pointermove", this.#onPointer);
    this.#surface.removeEventListener("pointerup", this.#onPointerEnd);
    this.#surface.removeEventListener("pointercancel", this.#onPointerEnd);
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (LEFT_KEYS.has(event.code) || RIGHT_KEYS.has(event.code)) {
      this.#held.add(event.code);
      this.#pushKeyboard();
    } else if (event.code === "Space" || event.code === "Enter") {
      this.#target.play();
    }
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    this.#held.delete(event.code);
    this.#pushKeyboard();
  };

  #pushKeyboard(): void {
    let dir = 0;
    for (const code of this.#held) {
      if (LEFT_KEYS.has(code)) dir -= 1;
      if (RIGHT_KEYS.has(code)) dir += 1;
    }
    // Keyboard overrides an idle pointer; a held pointer is folded in below.
    this.#target.steer(dir + this.#pointerDir);
  }

  #onPointer = (event: PointerEvent): void => {
    const rect = this.#surface.getBoundingClientRect();
    if (rect.width === 0) return;
    // Map pointer X within the surface to [-1, 1]; centre is coast.
    const fraction = (event.clientX - rect.left) / rect.width;
    this.#pointerDir = clamp((fraction - 0.5) * 2, -1, 1);
    this.#target.steer(this.#pointerDir);
  };

  #onPointerEnd = (): void => {
    this.#pointerDir = 0;
    this.#pushKeyboard();
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
