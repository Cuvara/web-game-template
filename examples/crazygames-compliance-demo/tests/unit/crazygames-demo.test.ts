// The demo's pure parts: the simulation's refresh-rate independence and the save format.

import { GameLoop, ManualScheduler } from "@wgf/game-core";
import { MemoryStorageBackend } from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
import { NEW_PROGRESS, loadProgress, parseProgress, saveProgress } from "../../src/save.js";
import { OrbSimulation, levelSpec } from "../../src/simulation.js";
import { pickLocale } from "../../src/i18n.js";
import { keyLabels } from "../../src/keys.js";

/** Run a level for `seconds` of wall time at `hz`, steering right, through the real loop. */
function runAt(hz: number, seconds: number): OrbSimulation {
  const simulation = new OrbSimulation(levelSpec(2));
  const scheduler = new ManualScheduler();
  const loop = new GameLoop(
    {
      update: (stepMs) => void simulation.step(stepMs, { targetX: 0.7, axis: 0 }),
      render: () => {},
    },
    { scheduler },
  );
  loop.start();
  const frames = Math.round(hz * seconds);
  for (let i = 0; i < frames; i++) scheduler.advance(1000 / hz);
  loop.stop();
  return simulation;
}

describe("Orb Catcher simulation", () => {
  it("plays identically at 60, 144 and 165 Hz — consistent physics across refresh rates", () => {
    const at60 = runAt(60, 10);
    for (const hz of [144, 165]) {
      const other = runAt(hz, 10);
      expect(other.caught).toBe(at60.caught);
      expect(other.orbs.length).toBe(at60.orbs.length);
      expect(other.paddleX).toBeCloseTo(at60.paddleX, 6);
    }
  });

  it("keeps the paddle on screen", () => {
    const simulation = new OrbSimulation(levelSpec(1));
    for (let i = 0; i < 200; i++) simulation.step(16, { targetX: null, axis: 1 });
    expect(simulation.paddleX).toBeLessThanOrEqual(1);
    for (let i = 0; i < 400; i++) simulation.step(16, { targetX: null, axis: -1 });
    expect(simulation.paddleX).toBeGreaterThanOrEqual(0);
  });

  it("completes a level by catching its goal", () => {
    const simulation = new OrbSimulation(levelSpec(1));
    for (let i = 0; i < 5000 && !simulation.complete; i++) {
      const lowest = [...simulation.orbs].sort((a, b) => b.y - a.y)[0];
      const next = lowest?.x ?? null;
      simulation.step(1000 / 60, { targetX: next, axis: 0 });
    }
    expect(simulation.complete).toBe(true);
    expect(simulation.caught).toBe(levelSpec(1).goal);
  });
});

describe("Orb Catcher progress", () => {
  it("starts fresh on missing or corrupt saves", () => {
    expect(parseProgress(null)).toEqual(NEW_PROGRESS);
    expect(parseProgress("{not json")).toEqual(NEW_PROGRESS);
    expect(parseProgress('{"level":-3,"coins":5}')).toEqual(NEW_PROGRESS);
  });

  it("round-trips through platform storage", async () => {
    const storage = new MemoryStorageBackend();
    const progress = { version: 1 as const, level: 4, coins: 31, levelsSinceOffer: 2 };
    await expect(saveProgress(storage, progress)).resolves.toBe(true);
    await expect(loadProgress(storage)).resolves.toEqual(progress);
  });

  it("reports a failed save instead of pretending", async () => {
    const failing = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("CrazyGames data module: dataLimitExcedeed")),
      remove: () => Promise.resolve(),
    };
    const warn = console.warn;
    console.warn = () => {};
    await expect(saveProgress(failing, NEW_PROGRESS)).resolves.toBe(false);
    console.warn = warn;
  });
});

describe("Orb Catcher key labels", () => {
  const layout = (letters: Record<string, string>) => ({
    keyboard: { getLayoutMap: () => Promise.resolve(new Map(Object.entries(letters))) },
  });

  it("names the letters on the player's keyboard — Q D on AZERTY", async () => {
    await expect(keyLabels(layout({ KeyA: "a", KeyD: "d" }))).resolves.toBe("← → / A D");
    await expect(keyLabels(layout({ KeyA: "q", KeyD: "d" }))).resolves.toBe("← → / Q D");
  });

  it("shows only the arrows when the layout is unknown or refused", async () => {
    await expect(keyLabels({})).resolves.toBe("← →");
    await expect(
      keyLabels({ keyboard: { getLayoutMap: () => Promise.reject(new Error("SecurityError")) } }),
    ).resolves.toBe("← →");
  });
});

describe("Orb Catcher locale", () => {
  it("prefers the portal locale, falls back to English", () => {
    expect(pickLocale("en-US", ["de-DE"])).toBe("en");
    expect(pickLocale("de-DE", ["fr"])).toBe("en");
    expect(pickLocale(null, [])).toBe("en");
  });
});
