import { describe, expect, it, vi } from "vitest";
import { Game, ManualScheduler, type Scene } from "@wgf/game-core";

function makeGame() {
  const scheduler = new ManualScheduler();
  const game = new Game({ stepMs: 10, maxFrameMs: 100, scheduler });
  return { game, scheduler };
}

function recordingScene(id: string) {
  return {
    id,
    enter: vi.fn(),
    exit: vi.fn(),
    update: vi.fn(),
    render: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  } satisfies Scene & Record<string, unknown>;
}

describe("Game", () => {
  it("drives the active scene and accumulates simulation time", async () => {
    const { game, scheduler } = makeGame();
    const scene = recordingScene("a");
    await game.changeScene(scene);

    game.start();
    scheduler.advance(30);

    expect(scene.update).toHaveBeenCalledTimes(3);
    expect(scene.render).toHaveBeenCalledTimes(1);
    expect(game.elapsedMs).toBe(30);
  });

  it("exits the old scene before entering the new one", async () => {
    const { game } = makeGame();
    const order: string[] = [];
    const first = { id: "first", exit: () => void order.push("exit first") };
    const second = { id: "second", enter: () => void order.push("enter second") };

    await game.changeScene(first);
    await game.changeScene(second);

    expect(order).toEqual(["exit first", "enter second"]);
    expect(game.scenes.current?.id).toBe("second");
  });

  it("serialises overlapping transitions", async () => {
    const { game } = makeGame();
    const order: string[] = [];
    const slow: Scene = {
      id: "slow",
      enter: async () => {
        order.push("enter slow");
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      exit: () => void order.push("exit slow"),
    };
    const fast: Scene = { id: "fast", enter: () => void order.push("enter fast") };

    await Promise.all([game.changeScene(slow), game.changeScene(fast)]);

    expect(order).toEqual(["enter slow", "exit slow", "enter fast"]);
    expect(game.scenes.current?.id).toBe("fast");
  });

  it("stays paused until every reason is released", async () => {
    const { game, scheduler } = makeGame();
    const scene = recordingScene("a");
    await game.changeScene(scene);
    game.start();

    game.pause("hidden");
    game.pause("ad");
    scheduler.advance(50);
    expect(scene.update).not.toHaveBeenCalled();
    expect(scene.pause).toHaveBeenCalledTimes(1);

    // The ad ends while the tab is still hidden: the game must not resume.
    game.resume("ad");
    scheduler.advance(50);
    expect(scene.update).not.toHaveBeenCalled();
    expect(game.paused).toBe(true);

    game.resume("hidden");
    expect(game.paused).toBe(false);
    scheduler.advance(10);
    expect(scene.update).toHaveBeenCalledTimes(1);
    expect(scene.resume).toHaveBeenCalledTimes(1);
  });

  it("ignores a release of a reason that was never taken", () => {
    const { game } = makeGame();
    const resumed = vi.fn();
    game.events.on("resumed", resumed);

    game.resume("ad");

    expect(game.paused).toBe(false);
    expect(resumed).not.toHaveBeenCalled();
  });

  it("does not count paused wall-clock time as simulation time", async () => {
    const { game, scheduler } = makeGame();
    await game.changeScene(recordingScene("a"));
    game.start();

    game.pause("ad");
    scheduler.advance(10_000);
    game.resume("ad");
    scheduler.advance(20);

    expect(game.elapsedMs).toBe(20);
  });
});
