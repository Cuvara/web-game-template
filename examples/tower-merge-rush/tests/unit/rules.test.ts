// Unit tests for the pure rules module. No PixiJS, no DOM, no platform — the whole point of
// keeping the game logic pure is that it can be driven and asserted here, step by step.

import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  MergeGame,
  canDropAt,
  dropLevelForMerges,
  hasLegalMove,
  isBoardFull,
  resolveMerges,
} from "../../src/game/rules.js";

// A game whose first drop is deterministically level 1 (see MergeGame.dropLevel).
const fresh = (): MergeGame => new MergeGame({ random: () => 0 });

describe("resolveMerges", () => {
  it("leaves a board with no adjacent equal pair untouched", () => {
    const result = resolveMerges([1, 2, 3, null, null, null, null]);
    expect(result.board).toEqual([1, 2, 3, null, null, null, null]);
    expect(result.merges).toBe(0);
    expect(result.score).toBe(0);
  });

  it("merges an adjacent equal pair into level+1 and scores the new value", () => {
    const result = resolveMerges([1, 1, null, null, null, null, null]);
    expect(result.board[0]).toBe(2);
    expect(result.merges).toBe(1);
    expect(result.score).toBe(2);
  });

  it("cascades: three ones become a two and a one after compaction", () => {
    // 1 1 1 -> merge left pair to 2, compact -> 2 1 (no further merge)
    const result = resolveMerges([1, 1, 1, null, null, null, null]);
    expect(result.board.slice(0, 3)).toEqual([2, 1, null]);
    expect(result.merges).toBe(1);
  });

  it("cascades a full chain: 2 1 1 -> 2 2 -> 3", () => {
    const result = resolveMerges([2, 1, 1, null, null, null, null]);
    expect(result.board[0]).toBe(3);
    expect(result.merges).toBe(2);
    expect(result.score).toBe(2 + 3);
  });
});

describe("board predicates", () => {
  it("canDropAt is true only for an in-range empty cell", () => {
    const board = [1, null, 2, null, null, null, null];
    expect(canDropAt(board, 1)).toBe(true);
    expect(canDropAt(board, 0)).toBe(false);
    expect(canDropAt(board, -1)).toBe(false);
    expect(canDropAt(board, COLUMNS)).toBe(false);
  });

  it("isBoardFull / hasLegalMove agree on a packed board", () => {
    const full = [1, 2, 1, 2, 1, 2, 1];
    expect(isBoardFull(full)).toBe(true);
    expect(hasLegalMove(full)).toBe(false);
    expect(hasLegalMove([1, 2, 1, 2, 1, 2, null])).toBe(true);
  });
});

describe("dropLevelForMerges ramp", () => {
  it("starts at 1 and rises one level every four merges, capped at 4", () => {
    expect(dropLevelForMerges(0)).toBe(1);
    expect(dropLevelForMerges(3)).toBe(1);
    expect(dropLevelForMerges(4)).toBe(2);
    expect(dropLevelForMerges(8)).toBe(3);
    expect(dropLevelForMerges(100)).toBe(4);
  });
});

describe("MergeGame lifecycle", () => {
  it("begins only from the start state", () => {
    const game = fresh();
    expect(game.state).toBe("start");
    game.begin();
    expect(game.state).toBe("playing");
    game.begin();
    expect(game.state).toBe("playing");
  });

  it("refuses drops before begin and after game over", () => {
    const game = fresh();
    expect(game.dropAt(0).placed).toBe(false);
  });

  it("a scripted merge increases the score", () => {
    const game = fresh();
    game.begin();
    const first = game.dropAt(0); // level 1 at col 0
    expect(first.placed).toBe(true);
    const before = game.score;
    const second = game.dropAt(1); // level 1 at col 1 -> merges with col 0
    expect(second.merges).toBe(1);
    expect(game.score).toBeGreaterThan(before);
    expect(game.levelAt(0)).toBe(2);
  });

  it("refuses a drop into an occupied column", () => {
    const game = fresh();
    game.begin();
    game.dropAt(3);
    const again = game.dropAt(3);
    expect(again.placed).toBe(false);
  });

  it("reaches game over when the board fills with no merge", () => {
    const game = fresh();
    game.begin();
    let guard = 0;
    while (game.state === "playing" && guard++ < 1000) {
      const open = game.firstOpenColumn();
      if (open === null) break;
      game.dropAt(open);
    }
    expect(game.state).toBe("over");
    expect(isBoardFull(game.board)).toBe(true);
  });

  it("restart via reset returns to start with a zero score", () => {
    const game = fresh();
    game.begin();
    game.dropAt(0);
    game.dropAt(1);
    expect(game.score).toBeGreaterThan(0);
    game.reset();
    expect(game.state).toBe("start");
    expect(game.score).toBe(0);
    expect(game.board.every((c) => c === null)).toBe(true);
  });

  it("continueRun keeps the score and clears the board, only from over", () => {
    const game = fresh();
    game.begin();
    let guard = 0;
    while (game.state === "playing" && guard++ < 1000) {
      const open = game.firstOpenColumn();
      if (open === null) break;
      game.dropAt(open);
    }
    const score = game.score;
    game.continueRun();
    expect(game.state).toBe("playing");
    expect(game.score).toBe(score);
    expect(game.board.every((c) => c === null)).toBe(true);
  });

  it("doubleScore doubles only from the over state", () => {
    const game = fresh();
    game.begin();
    game.dropAt(0);
    game.dropAt(1);
    const before = game.score;
    game.doubleScore(); // still playing -> no-op
    expect(game.score).toBe(before);
  });
});
