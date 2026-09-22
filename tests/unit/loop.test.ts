import { describe, expect, it } from "vitest";
import { GameLoop, ManualScheduler } from "@wgf/game-core";

function makeLoop(options: { stepMs?: number; maxFrameMs?: number } = {}) {
  const scheduler = new ManualScheduler();
  const updates: number[] = [];
  const renders: number[] = [];
  const loop = new GameLoop(
    {
      update: (stepMs) => updates.push(stepMs),
      render: (alpha) => renders.push(alpha),
    },
    { stepMs: options.stepMs ?? 10, maxFrameMs: options.maxFrameMs ?? 100, scheduler },
  );
  return { scheduler, updates, renders, loop };
}

describe("GameLoop", () => {
  it("rejects a step of zero or less", () => {
    expect(() => new GameLoop({ update: () => {}, render: () => {} }, { stepMs: 0 })).toThrow(
      RangeError,
    );
  });

  it("rejects a max frame shorter than one step", () => {
    expect(
      () => new GameLoop({ update: () => {}, render: () => {} }, { stepMs: 20, maxFrameMs: 10 }),
    ).toThrow(RangeError);
  });

  it("runs one update per elapsed step and always renders", () => {
    const { scheduler, updates, renders, loop } = makeLoop();
    loop.start();

    scheduler.advance(10);
    expect(updates).toEqual([10]);
    expect(renders).toHaveLength(1);

    scheduler.advance(35);
    // 35 ms is three whole steps with 5 ms left over.
    expect(updates).toHaveLength(4);
    expect(renders).toHaveLength(2);
    expect(renders[1]).toBeCloseTo(0.5);
  });

  it("keeps the simulation step fixed regardless of frame time", () => {
    const { scheduler, updates, loop } = makeLoop();
    loop.start();
    scheduler.advance(7);
    scheduler.advance(13);
    expect(updates).toEqual([10, 10]);
  });

  it("clamps a long frame instead of running unbounded catch-up", () => {
    const { scheduler, updates, loop } = makeLoop({ stepMs: 10, maxFrameMs: 100 });
    loop.start();
    scheduler.advance(5_000);
    expect(updates).toHaveLength(10);
  });

  it("does not update while paused, and discards the paused time on resume", () => {
    const { scheduler, updates, loop } = makeLoop();
    loop.start();
    loop.pause();

    scheduler.advance(500);
    expect(updates).toHaveLength(0);

    loop.resume();
    scheduler.advance(10);
    expect(updates).toEqual([10]);
  });

  it("stops scheduling once stopped", () => {
    const { scheduler, updates, loop } = makeLoop();
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
    scheduler.advance(100);
    expect(updates).toHaveLength(0);
  });
});
