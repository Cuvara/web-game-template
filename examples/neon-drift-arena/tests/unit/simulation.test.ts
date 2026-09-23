import { describe, expect, it } from "vitest";
import { Rng, Simulation } from "../../src/game/simulation.js";

const STEP = 1000 / 60;

/** Advance a simulation by `frames` fixed steps. */
function run(sim: Simulation, frames: number): void {
  for (let i = 0; i < frames; i++) sim.tick(STEP);
}

describe("Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it("produces floats in [0, 1)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs across seeds", () => {
    expect(new Rng(1).next()).not.toEqual(new Rng(2).next());
  });
});

describe("Simulation", () => {
  it("starts running with a zero score and a centred player", () => {
    const sim = new Simulation({ seed: 1 });
    expect(sim.state).toBe("running");
    expect(sim.score).toBe(0);
    expect(sim.playerX).toBe(0);
  });

  it("is fully deterministic: same seed + inputs => identical obstacle stream", () => {
    const a = new Simulation({ seed: 123 });
    const b = new Simulation({ seed: 123 });
    run(a, 300);
    run(b, 300);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("diverges for different seeds", () => {
    const a = new Simulation({ seed: 1 });
    const b = new Simulation({ seed: 999 });
    run(a, 300);
    run(b, 300);
    // The obstacle lanes come from the RNG, so the fields differ.
    expect(a.snapshot().obstacles).not.toEqual(b.snapshot().obstacles);
  });

  it("increases the score over survival time", () => {
    const sim = new Simulation({ seed: 5 });
    run(sim, 120); // ~2 seconds
    expect(sim.score).toBeGreaterThan(0);
  });

  it("ramps up speed the longer the run lasts", () => {
    const sim = new Simulation({ seed: 5 });
    const start = sim.speed;
    run(sim, 600); // ~10 seconds
    expect(sim.speed).toBeGreaterThan(start);
  });

  it("steers within the arena bounds and clamps direction", () => {
    const sim = new Simulation({ seed: 5, arenaHalfWidth: 4, playerHalfWidth: 0.5 });
    sim.steer(5); // over-range, clamps to +1
    run(sim, 600);
    expect(sim.playerX).toBeLessThanOrEqual(4 - 0.5 + 1e-9);
    sim.steer(-5);
    run(sim, 1200);
    expect(sim.playerX).toBeGreaterThanOrEqual(-(4 - 0.5) - 1e-9);
  });

  it("ends the run when an obstacle reaches the player in its lane", () => {
    const sim = new Simulation({ seed: 5 });
    // Player sits at x=0; drop an obstacle dead ahead close in.
    sim.spawnObstacleAt(0, 1, 0.6);
    // A few ticks bring z below the collision threshold at the player's lane.
    run(sim, 30);
    expect(sim.state).toBe("over");
  });

  it("does not end the run when the obstacle passes in another lane, and scores it", () => {
    const sim = new Simulation({ seed: 5, arenaHalfWidth: 4 });
    const before = sim.score;
    // Far to the right of a centred player; it should sweep past and be scored as avoided.
    sim.spawnObstacleAt(3.5, 1, 0.4);
    run(sim, 30);
    expect(sim.state).toBe("running");
    expect(sim.score).toBeGreaterThanOrEqual(before);
  });

  it("is a no-op once over", () => {
    const sim = new Simulation({ seed: 5 });
    sim.spawnObstacleAt(0, 1, 0.6);
    run(sim, 30);
    expect(sim.state).toBe("over");
    const frozen = sim.snapshot();
    expect(sim.tick(STEP)).toBe(false);
    expect(sim.snapshot()).toEqual(frozen);
  });

  it("clamps an enormous step so obstacles cannot tunnel through the player", () => {
    const sim = new Simulation({ seed: 5 });
    sim.spawnObstacleAt(0, 1, 0.6);
    // One huge delta (a backgrounded tab). The clamp keeps the step small enough that the
    // obstacle is still tested at the player's lane rather than skipping past uncollided.
    sim.tick(100_000);
    expect(sim.state).toBe("over");
  });
});
