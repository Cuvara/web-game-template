// PhaserRenderer's contract with @wgf/game-core's loop, against a fake Phaser.
//
// Phaser cannot be imported under Node — it reads `window` at module load — and it needs a
// real canvas to run, so this mocks the module and asserts the three things that are this
// binding's own responsibility rather than Phaser's:
//
//   1. the TimeStep is stopped once the game boots, so game-core's loop is the only one;
//   2. `render()` steps Phaser exactly once, with the frame delta it measures itself;
//   3. `destroy()` steps once more after `game.destroy(true)`, because Phaser defers its
//      teardown to the next step and a stopped TimeStep would never deliver one.
//
// The rest — that Phaser draws — is asserted in the browser by tests/e2e against a build
// made with `pnpm build:engine phaserjs`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const booted: FakeGame[] = [];

class FakeGame {
  readonly config: Record<string, unknown>;
  readonly events = {
    handlers: new Map<string, () => void>(),
    once(event: string, handler: () => void) {
      this.handlers.set(event, handler);
    },
    emit(event: string) {
      this.handlers.get(event)?.();
    },
  };
  readonly loop = { running: true, stop: vi.fn(() => (this.loop.running = false)) };
  readonly scale = { resize: vi.fn() };
  destroyed: boolean | null = null;
  steps: { time: number; delta: number }[] = [];

  constructor(config: Record<string, unknown>) {
    this.config = config;
    booted.push(this);
    // Phaser boots asynchronously and emits READY when it is done.
    queueMicrotask(() => this.events.emit("ready"));
  }

  step(time: number, delta: number): void {
    this.steps.push({ time, delta });
  }

  destroy(removeCanvas: boolean): void {
    this.destroyed = removeCanvas;
  }
}

vi.mock("phaser", () => ({
  default: {
    Game: FakeGame,
    AUTO: 0,
    Scale: { NONE: 0, NO_CENTER: 0 },
    Core: { Events: { READY: "ready" } },
  },
}));

const { PhaserRenderer } = await import("../src/index.js");

const options = { container: {} as HTMLElement, width: 320, height: 200 };

async function booted_renderer(): Promise<{
  renderer: InstanceType<typeof PhaserRenderer>;
  game: FakeGame;
}> {
  const renderer = new PhaserRenderer();
  await renderer.init(options);
  return { renderer, game: booted[booted.length - 1]! };
}

beforeEach(() => {
  booted.length = 0;
});

describe("PhaserRenderer", () => {
  it("is the phaserjs binding", () => {
    expect(new PhaserRenderer().kind).toBe("phaserjs");
  });

  it("refuses to be used before init resolves", () => {
    const renderer = new PhaserRenderer();
    expect(() => renderer.render(0)).toThrow(/init\(\) has not completed/);
    expect(() => renderer.resize(1, 1)).toThrow(/init\(\) has not completed/);
  });

  it("stops Phaser's own loop once it has booted", async () => {
    const { game } = await booted_renderer();
    expect(game.loop.stop).toHaveBeenCalledTimes(1);
    expect(game.loop.running).toBe(false);
  });

  it("builds the game at the size it was given", async () => {
    const { game } = await booted_renderer();
    expect(game.config["width"]).toBe(320);
    expect(game.config["height"]).toBe(200);
    expect(game.config["parent"]).toBe(options.container);
  });

  it("steps Phaser once per render, with no delta on the first frame", async () => {
    const { renderer, game } = await booted_renderer();
    renderer.render(0);
    renderer.render(0);
    expect(game.steps).toHaveLength(2);
    expect(game.steps[0]!.delta).toBe(0);
    expect(game.steps[1]!.delta).toBeGreaterThanOrEqual(0);
    expect(game.steps[1]!.time).toBeGreaterThanOrEqual(game.steps[0]!.time);
  });

  it("does not step while nothing calls render", async () => {
    const { game } = await booted_renderer();
    expect(game.steps).toHaveLength(0);
  });

  it("forwards a resize to the scale manager", async () => {
    const { renderer, game } = await booted_renderer();
    renderer.resize(640, 480);
    expect(game.scale.resize).toHaveBeenCalledWith(640, 480);
  });

  it("destroys the game and steps once so the teardown actually runs", async () => {
    const { renderer, game } = await booted_renderer();
    renderer.render(0);
    renderer.destroy();
    expect(game.destroyed).toBe(true);
    // One step after destroy(), and the render above: Phaser runs runDestroy() on that step.
    expect(game.steps).toHaveLength(2);
  });

  it("is unusable after destroy, and can be booted again", async () => {
    const first = await booted_renderer();
    first.renderer.destroy();
    expect(() => first.renderer.render(0)).toThrow(/init\(\) has not completed/);

    await first.renderer.init(options);
    const second = booted[booted.length - 1]!;
    expect(second).not.toBe(first.game);
    first.renderer.render(0);
    expect(second.steps).toHaveLength(1);
    expect(second.steps[0]!.delta).toBe(0);
  });

  it("destroying twice does nothing the second time", async () => {
    const { renderer, game } = await booted_renderer();
    renderer.destroy();
    renderer.destroy();
    expect(game.steps).toHaveLength(1);
  });
});
