// Game.steps: the fixed-step counter main.ts publishes as #hud[data-steps].
//
// The inherited smoke tests read that attribute for every game, whatever its scenes do, so
// the counter must advance with the simulation and stand still while the game is paused.

import { describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";

describe("Game.steps", () => {
  it("counts fixed steps with no scene at all", () => {
    const scheduler = new ManualScheduler();
    const game = new Game({ stepMs: 10, maxFrameMs: 100, scheduler });
    expect(game.steps).toBe(0);
    game.start();
    scheduler.advance(30);
    expect(game.steps).toBe(3);
  });

  it("does not advance while paused", () => {
    const scheduler = new ManualScheduler();
    const game = new Game({ stepMs: 10, maxFrameMs: 100, scheduler });
    game.start();
    scheduler.advance(20);
    game.pause("hidden");
    scheduler.advance(1_000);
    expect(game.steps).toBe(2);
    game.resume("hidden");
    scheduler.advance(10);
    expect(game.steps).toBe(3);
  });
});
