import { describe, expect, it } from "vitest";
import {
  START_LIVES,
  basketTop,
  basketWidth,
  createRound,
  resize,
  startRound,
  steer,
  step,
  type RoundState,
} from "../../src/game/rules.js";

const WORLD = { width: 400, height: 700 };

function run(
  state: RoundState,
  ms: number,
  stepMs = 1000 / 60,
): { caught: number; missed: number } {
  const total = { caught: 0, missed: 0 };
  for (let t = 0; t < ms && state.phase === "playing"; t += stepMs) {
    const events = step(state, stepMs);
    total.caught += events.caught;
    total.missed += events.missed;
  }
  return total;
}

describe("Star Catcher rules", () => {
  it("does nothing until the round starts", () => {
    const state = createRound(WORLD, 1);
    expect(state.phase).toBe("title");
    run(state, 5000);
    expect(state.stars).toHaveLength(0);
    expect(state.score).toBe(0);
  });

  it("spawns stars once playing", () => {
    const state = createRound(WORLD, 1);
    startRound(state);
    run(state, 2000);
    expect(state.stars.length + state.score + (START_LIVES - state.lives)).toBeGreaterThan(0);
  });

  it("a basket that follows every star never loses a life", () => {
    const state = createRound(WORLD, 42);
    startRound(state);
    for (let i = 0; i < 60 * 20; i++) {
      // Aim at the lowest star still above the rim.
      const next = state.stars
        .filter((star) => star.y < basketTop(state.world))
        .sort((a, b) => b.y - a.y)[0];
      if (next) {
        steer(state, next.x);
        state.basketX = state.targetX;
      }
      step(state, 1000 / 60);
    }
    expect(state.lives).toBe(START_LIVES);
    expect(state.score).toBeGreaterThan(10);
  });

  it("ends the round after three misses", () => {
    const state = createRound(WORLD, 7);
    startRound(state);
    steer(state, 0);
    // Keep the basket away from every star by parking it where none are.
    const events = run(state, 60_000);
    expect(state.phase).toBe("over");
    expect(state.lives).toBe(0);
    expect(events.missed).toBeGreaterThanOrEqual(START_LIVES);
  });

  it("is deterministic for a seed", () => {
    const a = createRound(WORLD, 99);
    const b = createRound(WORLD, 99);
    startRound(a);
    startRound(b);
    run(a, 10_000);
    run(b, 10_000);
    expect(a).toEqual(b);
  });

  it("restarting resets score and lives", () => {
    const state = createRound(WORLD, 3);
    startRound(state);
    run(state, 60_000);
    startRound(state);
    expect(state.phase).toBe("playing");
    expect(state.score).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.stars).toHaveLength(0);
  });

  it("keeps the basket inside the play area", () => {
    const state = createRound(WORLD, 1);
    steer(state, -500);
    expect(state.targetX).toBe(basketWidth(WORLD) / 2);
    steer(state, 5000);
    expect(state.targetX).toBe(WORLD.width - basketWidth(WORLD) / 2);
  });

  it("rescales on rotation and stays in bounds", () => {
    const state = createRound(WORLD, 1);
    startRound(state);
    run(state, 1500);
    steer(state, WORLD.width);
    resize(state, { width: 900, height: 400 });
    expect(state.world).toEqual({ width: 900, height: 400 });
    expect(state.targetX).toBeLessThanOrEqual(900 - basketWidth(state.world) / 2);
    for (const star of state.stars) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(900);
    }
  });
});
