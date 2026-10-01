// The input foundation: action mapping, held state, pause and listener lifetime.
//
// Driven through fake event targets rather than a browser. Registration and removal are
// what a leak looks like, and a fake target can be asked how many listeners it still holds
// — jsdom cannot, and the e2e suite runs a real browser but cannot see a detached listener
// at all.

import { describe, expect, it } from "vitest";
import { Input, type InputSurface } from "@wgf/game-core";

class FakeTarget implements EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  /** Total listeners still attached, across every type. */
  get count(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** Call every listener of `type` with a plain object, as the browser would. */
  fire(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      (listener as (event: unknown) => void)(event);
    }
  }
}

class FakeSurface extends FakeTarget implements InputSurface {
  left = 20;
  top = 10;
  width = 200;
  height = 100;

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: this.left, top: this.top, width: this.width, height: this.height };
  }
}

type Action = "left" | "right" | "fire" | "pause" | "tap";

interface Harness {
  readonly input: Input<Action>;
  readonly keys: FakeTarget;
  readonly surface: FakeSurface;
  readonly pressed: Action[];
  readonly released: Action[];
  paused: boolean;
}

function harness(): Harness {
  const keys = new FakeTarget();
  const surface = new FakeSurface();
  const pressed: Action[] = [];
  const released: Action[] = [];
  const state = { paused: false };
  const input = new Input<Action>({
    surface,
    keyTarget: keys,
    paused: () => state.paused,
    actions: {
      left: { keys: ["ArrowLeft", "KeyA"] },
      right: { keys: ["ArrowRight", "KeyD"] },
      fire: { keys: ["Space"] },
      // The one control that must survive a pause, as the examples' Escape/P does.
      pause: { keys: ["Escape", "KeyP"], whilePaused: true },
      tap: { pointer: true },
    },
  });
  input.onPressed((action) => pressed.push(action));
  input.onReleased((action) => released.push(action));
  return {
    input,
    keys,
    surface,
    pressed,
    released,
    get paused() {
      return state.paused;
    },
    set paused(value: boolean) {
      state.paused = value;
    },
  };
}

describe("Input keyboard", () => {
  it("holds a key between keydown and keyup and reports both edges", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "ArrowLeft" });
    expect(h.input.held("left")).toBe(true);
    expect(h.pressed).toEqual(["left"]);

    h.keys.fire("keyup", { code: "ArrowLeft" });
    expect(h.input.held("left")).toBe(false);
    expect(h.released).toEqual(["left"]);
  });

  it("maps several keys to one action and stays held while either is down", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.keys.fire("keydown", { code: "KeyA" });
    h.keys.fire("keyup", { code: "ArrowLeft" });

    expect(h.input.held("left")).toBe(true);
    expect(h.pressed).toEqual(["left", "left"]);
  });

  it("ignores auto-repeat, by the event flag and by the key already being down", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "Space" });
    h.keys.fire("keydown", { code: "Space", repeat: true });
    h.keys.fire("keydown", { code: "Space" });

    expect(h.pressed).toEqual(["fire"]);
  });

  it("ignores keys no action binds", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "KeyZ" });
    h.keys.fire("keyup", { code: "KeyZ" });

    expect(h.pressed).toEqual([]);
    expect(h.released).toEqual([]);
  });

  it("computes an axis from two opposing actions", () => {
    const h = harness();

    expect(h.input.axis("left", "right")).toBe(0);
    h.keys.fire("keydown", { code: "KeyD" });
    expect(h.input.axis("left", "right")).toBe(1);
    h.keys.fire("keydown", { code: "KeyA" });
    // Both down cancel out, which is what a player pressing left and right expects.
    expect(h.input.axis("left", "right")).toBe(0);
    h.keys.fire("keyup", { code: "KeyD" });
    expect(h.input.axis("left", "right")).toBe(-1);
  });

  it("drops held keys on blur, because their keyup never arrives", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.keys.fire("blur");

    expect(h.input.held("left")).toBe(false);
    // Not reported as a release: nothing the player did ended the action.
    expect(h.released).toEqual([]);
  });

  it("cancels the default of scrolling keys only", () => {
    const h = harness();
    const prevented: string[] = [];
    const event = (code: string): unknown => ({
      code,
      preventDefault: () => prevented.push(code),
    });

    for (const code of ["Space", "ArrowLeft", "KeyA", "Escape", "KeyP"]) {
      h.keys.fire("keydown", event(code));
    }

    expect(prevented).toEqual(["Space", "ArrowLeft"]);
  });

  it("honours an explicit preventDefault on a non-scrolling key", () => {
    const keys = new FakeTarget();
    const input = new Input<"shoot">({
      surface: new FakeSurface(),
      keyTarget: keys,
      actions: { shoot: { keys: ["KeyF"], preventDefault: true } },
    });
    const prevented: string[] = [];

    keys.fire("keydown", { code: "KeyF", preventDefault: () => prevented.push("KeyF") });

    expect(prevented).toEqual(["KeyF"]);
    input.dispose();
  });

  it("survives a keyboard layout change, because bindings are physical codes", () => {
    const h = harness();

    // AZERTY: the key under "A" on QWERTY types "q" but still reports code KeyA.
    h.keys.fire("keydown", { code: "KeyA", key: "q" });

    expect(h.input.held("left")).toBe(true);
  });
});

describe("Input.consumePressed", () => {
  it("reports a press once and then not again", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "Space" });

    expect(h.input.consumePressed("fire")).toBe(true);
    expect(h.input.consumePressed("fire")).toBe(false);
  });

  it("collapses presses that arrive between two reads into one", () => {
    const h = harness();

    // Two full press/release pairs inside one frame: update() sees one action, not a burst.
    h.keys.fire("keydown", { code: "Space" });
    h.keys.fire("keyup", { code: "Space" });
    h.keys.fire("keydown", { code: "Space" });

    expect(h.input.consumePressed("fire")).toBe(true);
    expect(h.input.consumePressed("fire")).toBe(false);
  });

  it("keeps a press waiting until it is read, not until the key is released", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "Space" });
    h.keys.fire("keyup", { code: "Space" });

    expect(h.input.held("fire")).toBe(false);
    expect(h.input.consumePressed("fire")).toBe(true);
  });

  it("records a pointer press too", () => {
    const h = harness();

    h.surface.fire("pointerdown", { clientX: 40, clientY: 20 });

    expect(h.input.consumePressed("tap")).toBe(true);
    expect(h.input.consumePressed("tap")).toBe(false);
  });

  it("records nothing for an action suppressed by pause", () => {
    const h = harness();
    h.paused = true;

    h.keys.fire("keydown", { code: "Space" });
    h.keys.fire("keydown", { code: "Escape" });

    expect(h.input.consumePressed("fire")).toBe(false);
    expect(h.input.consumePressed("pause")).toBe(true);
  });

  it("drops a waiting press on clear and on dispose", () => {
    const h = harness();
    h.keys.fire("keydown", { code: "Space" });
    h.input.clear();
    expect(h.input.consumePressed("fire")).toBe(false);

    h.keys.fire("keydown", { code: "Space" });
    h.input.dispose();
    expect(h.input.consumePressed("fire")).toBe(false);
  });

  it("names an action that was never bound", () => {
    const h = harness();

    expect(() => h.input.consumePressed("jump" as Action)).toThrow(
      /input action "jump" is not bound/,
    );
  });
});

describe("Input pointer", () => {
  it("reports position relative to the surface, in CSS pixels and as a fraction", () => {
    const h = harness();

    h.surface.fire("pointerdown", { clientX: 120, clientY: 60 });

    expect(h.input.pointer).toEqual({
      down: true,
      x: 100,
      y: 50,
      fractionX: 0.5,
      fractionY: 0.5,
    });
    expect(h.pressed).toEqual(["tap"]);
    expect(h.input.held("tap")).toBe(true);
  });

  it("follows a move and releases on pointerup", () => {
    const h = harness();

    h.surface.fire("pointerdown", { clientX: 20, clientY: 10 });
    h.surface.fire("pointermove", { clientX: 220, clientY: 110 });
    expect(h.input.pointer.fractionX).toBe(1);

    h.surface.fire("pointerup", { clientX: 220, clientY: 110 });
    expect(h.input.pointer.down).toBe(false);
    expect(h.input.held("tap")).toBe(false);
    expect(h.released).toEqual(["tap"]);
  });

  it("treats cancel and leave as a release, since the real one lands elsewhere", () => {
    for (const type of ["pointercancel", "pointerleave"]) {
      const h = harness();
      h.surface.fire("pointerdown", { clientX: 40, clientY: 20 });
      h.surface.fire(type, { clientX: 40, clientY: 20 });

      expect(h.input.pointer.down).toBe(false);
      expect(h.released).toEqual(["tap"]);
    }
  });

  it("reports one press for a touch that is already down (touch runs on pointer events)", () => {
    const h = harness();

    h.surface.fire("pointerdown", { clientX: 40, clientY: 20 });
    h.surface.fire("pointerdown", { clientX: 60, clientY: 30 });

    expect(h.pressed).toEqual(["tap"]);
    // The second finger still moves the reported position.
    expect(h.input.pointer.x).toBe(40);
  });

  it("reports no fraction for a zero-width surface instead of dividing by it", () => {
    const h = harness();
    h.surface.width = 0;
    h.surface.height = 0;

    h.surface.fire("pointerdown", { clientX: 20, clientY: 10 });

    expect(h.input.pointer).toMatchObject({ down: true, x: 0, y: 0, fractionX: null });
  });

  it("reports nothing before the first pointer event", () => {
    const h = harness();

    expect(h.input.pointer).toEqual({
      down: false,
      x: null,
      y: null,
      fractionX: null,
      fractionY: null,
    });
  });
});

describe("Input.bindElement", () => {
  it("holds an action while an on-screen button is pressed", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("left", button);

    button.fire("pointerdown", { preventDefault: () => undefined });
    expect(h.input.held("left")).toBe(true);
    expect(h.pressed).toEqual(["left"]);

    button.fire("pointerup");
    expect(h.input.held("left")).toBe(false);
    expect(h.released).toEqual(["left"]);
  });

  it("cancels the touch default, which would otherwise press the button twice", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("left", button);
    let prevented = 0;

    button.fire("pointerdown", { preventDefault: () => (prevented += 1) });

    expect(prevented).toBe(1);
  });

  it("releases when the press leaves or is cancelled", () => {
    for (const type of ["pointercancel", "pointerleave"]) {
      const h = harness();
      const button = new FakeTarget();
      h.input.bindElement("left", button);

      button.fire("pointerdown", { preventDefault: () => undefined });
      button.fire(type);

      expect(h.input.held("left")).toBe(false);
      expect(h.released).toEqual(["left"]);
    }
  });

  it("reports one press for a second pointerdown on the same button", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("left", button);

    button.fire("pointerdown", { preventDefault: () => undefined });
    button.fire("pointerdown", { preventDefault: () => undefined });

    expect(h.pressed).toEqual(["left"]);
  });

  it("is suppressed by pause like any other source", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("left", button);
    h.paused = true;

    button.fire("pointerdown", { preventDefault: () => undefined });

    expect(h.pressed).toEqual([]);
    expect(h.input.held("left")).toBe(false);
  });

  it("records the press for consumePressed", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("fire", button);

    button.fire("pointerdown", { preventDefault: () => undefined });

    expect(h.input.consumePressed("fire")).toBe(true);
    expect(h.input.consumePressed("fire")).toBe(false);
  });

  it("unbinds one button without touching the rest of the input", () => {
    const h = harness();
    const button = new FakeTarget();
    const off = h.input.bindElement("left", button);

    button.fire("pointerdown", { preventDefault: () => undefined });
    off();

    expect(button.count).toBe(0);
    expect(h.input.held("left")).toBe(false);
    h.keys.fire("keydown", { code: "ArrowLeft" });
    expect(h.input.held("left")).toBe(true);
  });

  it("removes button listeners on dispose as well", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("left", button);

    h.input.dispose();

    expect(button.count).toBe(0);
  });

  it("names an action that was never bound", () => {
    const h = harness();

    expect(() => h.input.bindElement("jump" as Action, new FakeTarget())).toThrow(
      /input action "jump" is not bound/,
    );
  });

  it("forgets a held button on clear, without reporting a release", () => {
    const h = harness();
    const button = new FakeTarget();
    h.input.bindElement("left", button);
    button.fire("pointerdown", { preventDefault: () => undefined });

    h.input.clear();

    expect(h.input.held("left")).toBe(false);
    expect(h.released).toEqual([]);
  });
});

describe("Input pause", () => {
  it("stops gameplay actions but not the one that ends the pause", () => {
    const h = harness();
    h.paused = true;

    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.surface.fire("pointerdown", { clientX: 40, clientY: 20 });
    h.keys.fire("keydown", { code: "Escape" });

    expect(h.pressed).toEqual(["pause"]);
    expect(h.input.held("left")).toBe(false);
    expect(h.input.held("tap")).toBe(false);
  });

  it("keeps tracking the physical key, so a control held across a break survives it", () => {
    const h = harness();

    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.paused = true;
    expect(h.input.held("left")).toBe(false);

    h.paused = false;
    // The player never let go; the game must not need a fresh press.
    expect(h.input.held("left")).toBe(true);
  });

  it("still reports pointer position while paused, so a menu can use it", () => {
    const h = harness();
    h.paused = true;

    h.surface.fire("pointerdown", { clientX: 120, clientY: 60 });

    expect(h.input.pointer).toMatchObject({ down: true, x: 100, y: 50 });
  });

  it("does not report a release that happened while paused", () => {
    const h = harness();
    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.paused = true;

    h.keys.fire("keyup", { code: "ArrowLeft" });

    expect(h.released).toEqual([]);
    h.paused = false;
    expect(h.input.held("left")).toBe(false);
  });
});

describe("Input lifecycle", () => {
  it("removes every listener it added, and adds none back", () => {
    const keys = new FakeTarget();
    const surface = new FakeSurface();
    const before = keys.count + surface.count;

    const input = new Input<"fire">({
      surface,
      keyTarget: keys,
      actions: { fire: { keys: ["Space"] } },
    });
    expect(keys.count + surface.count).toBeGreaterThan(before);

    input.dispose();
    expect(keys.count).toBe(0);
    expect(surface.count).toBe(0);
  });

  it("does not accumulate listeners over repeated create and dispose", () => {
    const keys = new FakeTarget();
    const surface = new FakeSurface();

    for (let i = 0; i < 10; i += 1) {
      const input = new Input<"fire">({
        surface,
        keyTarget: keys,
        actions: { fire: { keys: ["Space"] } },
      });
      input.dispose();
    }

    expect(keys.count).toBe(0);
    expect(surface.count).toBe(0);
  });

  it("is safe to dispose twice and reports nothing held afterwards", () => {
    const h = harness();
    h.keys.fire("keydown", { code: "ArrowLeft" });

    h.input.dispose();
    h.input.dispose();

    expect(h.input.disposed).toBe(true);
    expect(h.input.held("left")).toBe(false);
    expect(h.keys.count).toBe(0);
  });

  it("stops reporting actions once disposed, even if an event still arrives", () => {
    const h = harness();
    h.input.dispose();

    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.surface.fire("pointerdown", { clientX: 40, clientY: 20 });

    expect(h.pressed).toEqual([]);
  });

  it("lets two instances coexist, and disposing one leaves the other bound", () => {
    const keys = new FakeTarget();
    const surface = new FakeSurface();
    const options = { surface, keyTarget: keys, actions: { fire: { keys: ["Space"] } } } as const;
    const first = new Input<"fire">(options);
    const second = new Input<"fire">(options);

    first.dispose();
    keys.fire("keydown", { code: "Space" });

    expect(first.held("fire")).toBe(false);
    expect(second.held("fire")).toBe(true);
    second.dispose();
  });

  it("unsubscribes one listener without disturbing the others", () => {
    const h = harness();
    const seen: string[] = [];
    const off = h.input.onPressed(() => seen.push("extra"));

    h.keys.fire("keydown", { code: "Space" });
    off();
    h.keys.fire("keydown", { code: "Escape" });

    expect(seen).toEqual(["extra"]);
    expect(h.pressed).toEqual(["fire", "pause"]);
  });

  it("keeps delivering to later listeners when one unsubscribes itself mid-emit", () => {
    const h = harness();
    const seen: string[] = [];
    const off = h.input.onPressed(() => {
      seen.push("self");
      off();
    });
    h.input.onPressed(() => seen.push("after"));

    h.keys.fire("keydown", { code: "Space" });

    expect(seen).toEqual(["self", "after"]);
  });

  it("forgets held state on clear without reporting releases", () => {
    const h = harness();
    h.keys.fire("keydown", { code: "ArrowLeft" });
    h.surface.fire("pointerdown", { clientX: 40, clientY: 20 });

    h.input.clear();

    expect(h.input.held("left")).toBe(false);
    expect(h.input.pointer.down).toBe(false);
    expect(h.released).toEqual([]);
  });
});

describe("Input binding rules", () => {
  const surface = (): FakeSurface => new FakeSurface();

  it("rejects an action with neither keys nor pointer", () => {
    expect(
      () =>
        new Input<"ghost">({
          surface: surface(),
          actions: { ghost: {} },
          keyTarget: new FakeTarget(),
        }),
    ).toThrow(/input action "ghost" has neither keys nor pointer/);
  });

  it("rejects an empty key code", () => {
    expect(
      () =>
        new Input<"ghost">({
          surface: surface(),
          keyTarget: new FakeTarget(),
          actions: { ghost: { keys: [""] } },
        }),
    ).toThrow(/input action "ghost" has an empty key code/);
  });

  it("rejects the same code listed twice in one action", () => {
    expect(
      () =>
        new Input<"ghost">({
          surface: surface(),
          keyTarget: new FakeTarget(),
          actions: { ghost: { keys: ["Space", "Space"] } },
        }),
    ).toThrow(/input action "ghost" lists key "Space" twice/);
  });

  it("allows one code to drive two actions, and fires both", () => {
    const keys = new FakeTarget();
    const pressed: string[] = [];
    const input = new Input<"back" | "menu">({
      surface: surface(),
      keyTarget: keys,
      actions: { back: { keys: ["Escape"] }, menu: { keys: ["Escape"] } },
    });
    input.onPressed((action) => pressed.push(action));

    keys.fire("keydown", { code: "Escape" });

    expect(pressed).toEqual(["back", "menu"]);
    input.dispose();
  });

  it("names an action that was never bound instead of reporting it as not held", () => {
    const h = harness();

    expect(() => h.input.held("jump" as Action)).toThrow(/input action "jump" is not bound/);
  });
});
