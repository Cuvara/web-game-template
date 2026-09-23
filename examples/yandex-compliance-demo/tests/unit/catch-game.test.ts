import { describe, expect, it } from "vitest";
import { BASKET_WIDTH, CatchGame, START_LIVES, type GameInput } from "../../src/game/catch-game.js";
import { PLAYFIELD_MAX_ASPECT, playfieldRect, toPlayfieldX } from "../../src/layout.js";
import { formatter } from "../../src/format.js";

const STEP = 1000 / 60;
const idle: GameInput = { targetX: null, axis: 0 };

function runUntil(game: CatchGame, input: GameInput, done: () => boolean, maxSteps = 5_000) {
  const events: string[] = [];
  for (let i = 0; i < maxSteps && !done(); i++) events.push(...game.update(STEP, input));
  return events;
}

describe("CatchGame", () => {
  it("loses a life per missed star and ends after three", () => {
    const game = new CatchGame({ random: () => 0.99 });
    const events = runUntil(game, { targetX: 0, axis: 0 }, () => game.over);
    expect(events.filter((e) => e === "miss")).toHaveLength(START_LIVES);
    expect(events.at(-1)).toBe("over");
    expect(game.lives).toBe(0);
    expect(game.update(STEP, idle)).toEqual([]);
  });

  it("scores a star that lands in the basket", () => {
    const game = new CatchGame({ random: () => 0.5 });
    const events = runUntil(game, { targetX: 0.5, axis: 0 }, () => game.score > 0);
    expect(events).toContain("catch");
    expect(game.lives).toBe(START_LIVES);
  });

  it("keeps the basket inside the field", () => {
    const game = new CatchGame();
    game.update(STEP, { targetX: -5, axis: 0 });
    expect(game.basketX).toBeCloseTo(BASKET_WIDTH / 2);
    for (let i = 0; i < 600; i++) game.update(STEP, { targetX: null, axis: 1 });
    expect(game.basketX).toBeCloseTo(1 - BASKET_WIDTH / 2);
  });

  it("the keyboard outranks a stale pointer target", () => {
    const game = new CatchGame();
    game.update(STEP, { targetX: 0.5, axis: -1 });
    expect(game.basketX).toBeLessThan(0.5);
  });

  it("revives once, with one life", () => {
    const game = new CatchGame({ random: () => 0.99 });
    runUntil(game, { targetX: 0, axis: 0 }, () => game.over);
    expect(game.canRevive).toBe(true);
    expect(game.revive()).toBe(true);
    expect(game.lives).toBe(1);
    expect(game.over).toBe(false);
    expect(game.stars).toHaveLength(0);
    runUntil(game, { targetX: 0, axis: 0 }, () => game.over);
    expect(game.canRevive).toBe(false);
    expect(game.revive()).toBe(false);
  });

  it("gets faster as the score rises", () => {
    const slow = new CatchGame({ random: () => 0.5 });
    runUntil(slow, idle, () => slow.stars.length > 0);
    const fast = new CatchGame({ random: () => 0.5 });
    runUntil(fast, { targetX: 0.5, axis: 0 }, () => fast.score >= 20);
    runUntil(fast, { targetX: 0.5, axis: 0 }, () => fast.stars.length > 0);
    expect(fast.stars.at(-1)!.speed).toBeGreaterThan(slow.stars[0]!.speed);
  });
});

describe("layout", () => {
  it("caps a wide desktop playfield and centres it", () => {
    const field = playfieldRect(1920, 1080);
    expect(field.width).toBeCloseTo(1080 * PLAYFIELD_MAX_ASPECT);
    expect(field.x).toBeCloseTo((1920 - field.width) / 2);
  });

  it("uses the whole of a portrait phone", () => {
    expect(playfieldRect(390, 844)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  it("maps and clamps pointer x", () => {
    const field = { x: 100, y: 0, width: 200, height: 100 };
    expect(toPlayfieldX(200, field)).toBe(0.5);
    expect(toPlayfieldX(0, field)).toBe(0);
    expect(toPlayfieldX(999, field)).toBe(1);
  });
});

describe("formatter", () => {
  it("fills placeholders and leaves unknown ones", () => {
    const t = formatter((key) => ({ a: "Score: {score} {x}" })[key] ?? key);
    expect(t("a", { score: 3 })).toBe("Score: 3 {x}");
    expect(t("missing")).toBe("missing");
  });
});
