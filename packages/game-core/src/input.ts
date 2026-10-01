// Player input, mapped to actions.
//
// Every game so far has rewritten the same layer: a held-key set, keydown/keyup on the
// window, pointer down/move/up on the canvas, a dispose list, and the two details that are
// only obvious after a portal rejection — clear held keys on blur (a key held while focus
// leaves never gets its keyup, so the player returns to a stuck control) and cancel the
// default action of the keys the game uses (Yandex 1.10.2: arrows and space must not scroll
// the page; Poki's HTML5 guide says the same for its iframe).
//
// What stays game-owned: what an action means. This maps physical input to named actions
// and reports which are held; movement, rules, physics and scenes read that and remain the
// game's own.
//
// Keys are `KeyboardEvent.code` — the physical key, not the character. Yandex 1.6.2.4
// requires the controls to survive a layout change, and "KeyA" is the key under A on QWERTY
// and under Q on AZERTY, which is what a WASD game means.
//
// No engine is involved. Pointer position is reported in the surface's own CSS pixels, so a
// game converts to world coordinates where it already knows its own camera.

/** The element pointer input is read from — #game in the template. */
export interface InputSurface extends EventTarget {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

export interface ActionBinding {
  /** `KeyboardEvent.code` values, e.g. ["ArrowLeft", "KeyA"]. */
  readonly keys?: readonly string[];
  /** Whether a pointer press on the surface triggers this action. */
  readonly pointer?: boolean;
  /**
   * Whether the action still fires while the game is paused. False for everything that
   * moves the world — an ad break that leaked input is a listed rejection cause on more
   * than one portal — and true for the one control that ends the pause.
   */
  readonly whilePaused?: boolean;
  /**
   * Cancel the browser's default for this action's keys. Defaults to true for the keys that
   * scroll a page (space, the arrows, page up/down) and false for everything else, which is
   * the rule both Yandex (1.10.2) and Poki state. Set it explicitly to override.
   */
  readonly preventDefault?: boolean;
}

/** Where the pointer is, in the surface's CSS pixels. Reported whether or not paused. */
export interface PointerState {
  /** True between a press on the surface and its release or cancel. */
  readonly down: boolean;
  /** Offset from the surface's left/top edge, or null before the first event. */
  readonly x: number | null;
  readonly y: number | null;
  /** {@link x} as a fraction of the surface's width, 0..1. Null with {@link x}. */
  readonly fractionX: number | null;
  readonly fractionY: number | null;
}

export type InputListener<A extends string> = (action: A) => void;
export type InputUnsubscribe = () => void;

export interface InputOptions<A extends string> {
  /** Pointer target. The template passes `context.container` (#game). */
  readonly surface: InputSurface;
  /** Every action the game reads, with what triggers it. */
  readonly actions: Readonly<Record<A, ActionBinding>>;
  /**
   * The game's pause state — pass `() => game.paused`. Pause is the Game's, never this
   * layer's: it is the same flag an ad break, a hidden tab and the pause menu all raise.
   */
  readonly paused?: () => boolean;
  /**
   * Keyboard and blur target. Defaults to `window`, which is where a game gets keys whether
   * or not the canvas has focus. Tests pass a fake.
   */
  readonly keyTarget?: EventTarget;
}

/** Keys whose default action scrolls the page. */
const SCROLL_CODES: ReadonlySet<string> = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
]);

const NO_POINTER: PointerState = {
  down: false,
  x: null,
  y: null,
  fractionX: null,
  fractionY: null,
};

interface KeyEventLike {
  readonly code: string;
  readonly repeat?: boolean;
  preventDefault?(): void;
}

interface PointerEventLike {
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * Reads the keyboard and the pointer, and reports named actions.
 *
 * Listeners are attached when it is constructed and removed by {@link Input.dispose}, which
 * is safe to call twice. Construct one per game, or one per scene that owns its own
 * controls; nothing is global, so two can coexist and disposing one never unbinds the other.
 */
export class Input<A extends string> {
  readonly #surface: InputSurface;
  readonly #keyTarget: EventTarget;
  readonly #paused: () => boolean;
  readonly #actions: Readonly<Record<A, ActionBinding>>;
  /** code → the actions it triggers. One key may drive several. */
  readonly #byCode: ReadonlyMap<string, readonly A[]>;
  readonly #preventedCodes: ReadonlySet<string>;
  readonly #pointerActions: readonly A[];

  /** Physical keys down right now, whatever the pause state. */
  readonly #heldCodes = new Set<string>();
  /** Actions held by a press on an element bound with {@link Input.bindElement}. */
  readonly #heldElements = new Set<A>();
  /** Actions pressed since the last {@link Input.consumePressed} for each. */
  readonly #edges = new Set<A>();
  #pointerDown = false;
  #pointerX: number | null = null;
  #pointerY: number | null = null;

  readonly #pressed = new Set<InputListener<A>>();
  readonly #released = new Set<InputListener<A>>();
  readonly #unbind: Array<() => void> = [];
  #disposed = false;

  constructor(options: InputOptions<A>) {
    this.#surface = options.surface;
    this.#keyTarget = options.keyTarget ?? globalThis.window;
    this.#paused = options.paused ?? (() => false);
    this.#actions = options.actions;

    const byCode = new Map<string, A[]>();
    const prevented = new Set<string>();
    const pointerActions: A[] = [];
    for (const [name, binding] of Object.entries(options.actions) as [A, ActionBinding][]) {
      if (!binding.keys?.length && !binding.pointer) {
        throw new Error(`input action "${name}" has neither keys nor pointer`);
      }
      for (const code of binding.keys ?? []) {
        if (!code) throw new Error(`input action "${name}" has an empty key code`);
        // A code bound twice in one action would report the key released on the first keyup
        // of a pair that never happens; a code shared between actions is legitimate.
        const existing = byCode.get(code);
        if (existing?.includes(name)) {
          throw new Error(`input action "${name}" lists key "${code}" twice`);
        }
        if (existing) existing.push(name);
        else byCode.set(code, [name]);
        if (binding.preventDefault ?? SCROLL_CODES.has(code)) prevented.add(code);
      }
      if (binding.pointer) pointerActions.push(name);
    }
    this.#byCode = byCode;
    this.#preventedCodes = prevented;
    this.#pointerActions = pointerActions;

    this.#listen(this.#keyTarget, "keydown", this.#onKeyDown);
    this.#listen(this.#keyTarget, "keyup", this.#onKeyUp);
    // A key held while focus leaves never gets its keyup: without this the player comes back
    // to a control stuck on.
    this.#listen(this.#keyTarget, "blur", this.#onBlur);
    this.#listen(this.#surface, "pointerdown", this.#onPointerDown);
    this.#listen(this.#surface, "pointermove", this.#onPointerMove);
    this.#listen(this.#surface, "pointerup", this.#onPointerUp);
    this.#listen(this.#surface, "pointercancel", this.#onPointerUp);
    // The pointer leaving the canvas with the button down: the release lands elsewhere, so
    // treat it as one.
    this.#listen(this.#surface, "pointerleave", this.#onPointerUp);
  }

  /** True once {@link dispose} has run. Every read then reports nothing held. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Where the pointer is, in the surface's CSS pixels. */
  get pointer(): PointerState {
    // Every pointer handler records a position before it changes `down`, so no position with
    // the button down is not a state this can be in.
    if (this.#pointerX === null || this.#pointerY === null) return NO_POINTER;
    const rect = this.#surface.getBoundingClientRect();
    return {
      down: this.#pointerDown,
      x: this.#pointerX,
      y: this.#pointerY,
      fractionX: rect.width > 0 ? this.#pointerX / rect.width : null,
      fractionY: rect.height > 0 ? this.#pointerY / rect.height : null,
    };
  }

  /**
   * Whether the action is held. False while the game is paused unless the binding says
   * `whilePaused` — the key stays tracked underneath, so a control held across an ad break
   * reads correctly the moment the game resumes rather than needing to be pressed again.
   */
  held(action: A): boolean {
    const binding = this.#binding(action);
    if (this.#disposed) return false;
    if (this.#suppressed(binding)) return false;
    if (this.#heldElements.has(action)) return true;
    if (binding.pointer && this.#pointerDown) return true;
    for (const code of binding.keys ?? []) {
      if (this.#heldCodes.has(code)) return true;
    }
    return false;
  }

  /** -1, 0 or 1 from two opposing actions. The axis every movement game computes by hand. */
  axis(negative: A, positive: A): number {
    return (this.held(positive) ? 1 : 0) - (this.held(negative) ? 1 : 0);
  }

  /**
   * Whether the action was pressed since this was last asked, clearing the record.
   *
   * The deterministic way to read a one-shot control — a jump, a drop, a shot. A browser
   * event arrives between frames, so acting on it in {@link Input.onPressed} advances the
   * game outside the fixed step; draining it here, from `update()`, keeps the simulation
   * where the loop can reproduce it. Use {@link Input.onPressed} for menus and anything
   * else outside the simulation.
   */
  consumePressed(action: A): boolean {
    this.#binding(action);
    return this.#edges.delete(action);
  }

  /**
   * Called when an action starts. Auto-repeat from a held key is not reported, and nothing
   * fires while the game is paused unless the binding says `whilePaused`.
   */
  onPressed(listener: InputListener<A>): InputUnsubscribe {
    this.#pressed.add(listener);
    return () => this.#pressed.delete(listener);
  }

  /**
   * Make an element an extra press source for an action — an on-screen button, which is how
   * a keyboard game is played on a phone. Held while the button is pressed, released when
   * the press ends or leaves it.
   *
   * The returned unsubscribe removes only this element's listeners; {@link Input.dispose}
   * removes them too, so a caller that disposes need not unbind each button first.
   */
  bindElement(action: A, element: EventTarget): InputUnsubscribe {
    this.#binding(action);
    const press = (raw: Event): void => {
      // A touch on a button otherwise scrolls the page and then synthesises a mouse event
      // that presses it a second time.
      (raw as unknown as { preventDefault?(): void }).preventDefault?.();
      if (this.#heldElements.has(action)) return;
      this.#heldElements.add(action);
      this.#emit("pressed", action);
    };
    const release = (): void => {
      if (!this.#heldElements.delete(action)) return;
      this.#emit("released", action);
    };
    const bound: Array<[string, EventListener]> = [
      ["pointerdown", press as EventListener],
      ["pointerup", release as EventListener],
      ["pointercancel", release as EventListener],
      ["pointerleave", release as EventListener],
    ];
    for (const [type, listener] of bound) this.#listen(element, type, listener);
    return () => {
      for (const [type, listener] of bound) element.removeEventListener(type, listener);
      this.#heldElements.delete(action);
    };
  }

  /** Called when an action ends. Not called by {@link clear} or by losing focus. */
  onReleased(listener: InputListener<A>): InputUnsubscribe {
    this.#released.add(listener);
    return () => this.#released.delete(listener);
  }

  /**
   * Forget everything held, without reporting releases. For a restart or a scene change,
   * where the new state should not inherit a key the last one was holding.
   */
  clear(): void {
    this.#heldCodes.clear();
    this.#heldElements.clear();
    this.#edges.clear();
    this.#pointerDown = false;
    this.#pointerX = null;
    this.#pointerY = null;
  }

  /** Remove every listener this instance added. Safe to call more than once. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const off of this.#unbind.splice(0)) off();
    this.#pressed.clear();
    this.#released.clear();
    this.clear();
  }

  #binding(action: A): ActionBinding {
    const binding = this.#actions[action];
    // Typed callers cannot reach this; a plain-JavaScript one asking for an action that was
    // never bound gets the name rather than a silent false.
    if (!binding) throw new Error(`input action "${String(action)}" is not bound`);
    return binding;
  }

  #suppressed(binding: ActionBinding): boolean {
    return !binding.whilePaused && this.#paused();
  }

  #emit(phase: "pressed" | "released", action: A): void {
    if (this.#suppressed(this.#actions[action])) return;
    if (phase === "pressed") this.#edges.add(action);
    // Copied: a listener that unsubscribes itself must not skip the next one.
    for (const listener of [...(phase === "pressed" ? this.#pressed : this.#released)]) {
      listener(action);
    }
  }

  #onKeyDown = (raw: Event): void => {
    // The browser hands over a KeyboardEvent; the structural type is what this actually
    // reads, and is what a test can construct without a DOM.
    const event = raw as unknown as KeyEventLike;
    if (this.#preventedCodes.has(event.code)) event.preventDefault?.();
    const actions = this.#byCode.get(event.code);
    if (!actions) return;
    // The operating system's auto-repeat is not a new press.
    if (event.repeat === true || this.#heldCodes.has(event.code)) return;
    this.#heldCodes.add(event.code);
    for (const action of actions) this.#emit("pressed", action);
  };

  #onKeyUp = (raw: Event): void => {
    const event = raw as unknown as KeyEventLike;
    if (!this.#heldCodes.delete(event.code)) return;
    const actions = this.#byCode.get(event.code);
    if (!actions) return;
    for (const action of actions) this.#emit("released", action);
  };

  #onBlur = (): void => {
    this.clear();
  };

  #onPointerDown = (raw: Event): void => {
    this.#track(raw);
    if (this.#pointerDown) return;
    this.#pointerDown = true;
    for (const action of this.#pointerActions) this.#emit("pressed", action);
  };

  #onPointerMove = (raw: Event): void => {
    this.#track(raw);
  };

  #onPointerUp = (raw: Event): void => {
    this.#track(raw);
    if (!this.#pointerDown) return;
    this.#pointerDown = false;
    for (const action of this.#pointerActions) this.#emit("released", action);
  };

  #track(raw: Event): void {
    const event = raw as unknown as PointerEventLike;
    const rect = this.#surface.getBoundingClientRect();
    this.#pointerX = event.clientX - rect.left;
    this.#pointerY = event.clientY - rect.top;
  }

  #listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.#unbind.push(() => target.removeEventListener(type, listener));
  }
}
