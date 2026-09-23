// Tower Merge Rush — the whole game, as pure logic.
//
// No PixiJS, no DOM, no platform. Everything here is a plain function or a small class that
// owns nothing but numbers, which is what lets the unit tests drive it step by step and the
// e2e test assert on it without reading a single pixel. The renderer and the platform wiring
// live in other files and only ever read this state.
//
// The game is a single-row track of COLUMNS cells. The player drops a piece with a numeric
// level into a column; it lands on the nearest empty cell. Whenever two horizontally adjacent
// cells hold the same level they merge into one cell of level+1, and the merge cascades. Score
// grows with every merge and with the level produced. The dropped level ramps up as the score
// climbs, so the board fills faster over time. When a drop has nowhere to land and no merge is
// possible, the game is over.

export const COLUMNS = 7;

/** A cell holds a tower level (>= 1) or is empty (null). */
export type Cell = number | null;

export type State = "start" | "playing" | "over";

/** Merges produced per level the drop level advances. */
const MERGES_PER_LEVEL_UP = 4;
/** The highest level the drop ramp will hand out. */
const MAX_DROP_LEVEL = 4;

export interface Snapshot {
  readonly state: State;
  readonly score: number;
  readonly merges: number;
  readonly dropLevel: number;
  readonly board: readonly Cell[];
}

export interface RulesOptions {
  /** Injected so tests are deterministic; only used to vary the very first drop level. */
  readonly random?: () => number;
}

/**
 * The base level of the piece the player is about to drop, as a function of how many merges
 * have happened. Pure and deterministic: the same merge count always yields the same level.
 */
export function dropLevelForMerges(merges: number): number {
  return Math.min(1 + Math.floor(merges / MERGES_PER_LEVEL_UP), MAX_DROP_LEVEL);
}

/** The lowest empty index in a column-as-cell track: here, the cell itself if empty. */
export function canDropAt(board: readonly Cell[], col: number): boolean {
  return col >= 0 && col < board.length && board[col] === null;
}

/** True when no column is free — the only way a drop can be refused. */
export function isBoardFull(board: readonly Cell[]): boolean {
  return board.every((cell) => cell !== null);
}

/**
 * Whether the current board can still accept a drop of `level`. Full boards are only truly
 * lost when no adjacent equal pair exists that a drop could trigger — but this game drops into
 * empty cells only, so a full board is unconditionally a game over. Kept as its own function
 * so the lose rule is named and testable.
 */
export function hasLegalMove(board: readonly Cell[]): boolean {
  return !isBoardFull(board);
}

/**
 * Resolve all cascading merges on `board`, mutating a copy. Returns the settled board, the
 * number of merges performed and the score gained. A merge combines the left cell of an equal
 * adjacent pair into level+1 and empties the right one; the pass repeats until stable, so a
 * newly formed pair merges too. Scanning left-to-right and restarting on any change keeps the
 * result independent of scan direction for the shapes this game produces.
 */
export function resolveMerges(input: readonly Cell[]): {
  board: Cell[];
  merges: number;
  score: number;
} {
  const board = [...input];
  let merges = 0;
  let score = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < board.length - 1; i++) {
      const a = board[i];
      const b = board[i + 1];
      if (typeof a === "number" && a === b) {
        const merged = a + 1;
        board[i] = merged;
        board[i + 1] = null;
        merges += 1;
        // A merge is worth the value it created; higher towers are worth more.
        score += merged;
        changed = true;
        break;
      }
    }
    // Close the gap a merge left, so a pair separated only by the emptied cell can meet.
    if (changed) compactTowardEmpties(board);
  }
  return { board, merges, score };
}

/**
 * Slide every filled cell left into the nearest empty cell to its left, once. This is what
 * turns "1 _ 1" (after a merge emptied the middle) into "1 1", letting the cascade continue,
 * and it gives the track its gravity-toward-the-left feel.
 */
function compactTowardEmpties(board: Cell[]): void {
  const filled = board.filter((cell): cell is number => cell !== null);
  for (let i = 0; i < board.length; i++) {
    board[i] = i < filled.length ? filled[i]! : null;
  }
}

export interface DropResult {
  /** False when the drop was refused (illegal column or already over). */
  readonly placed: boolean;
  /** Merges triggered by this drop. */
  readonly merges: number;
  /** Score gained by this drop. */
  readonly gained: number;
  /** True when this drop ended the game. */
  readonly over: boolean;
}

/**
 * The playable game. A thin, mutable shell around the pure functions above so the app has one
 * object to talk to, but every rule that decides an outcome is a pure function that the unit
 * tests exercise directly.
 */
export class MergeGame {
  readonly #random: () => number;
  #board: Cell[] = new Array<Cell>(COLUMNS).fill(null);
  #state: State = "start";
  #score = 0;
  #merges = 0;

  constructor(options: RulesOptions = {}) {
    this.#random = options.random ?? Math.random;
  }

  get board(): readonly Cell[] {
    return this.#board;
  }
  get state(): State {
    return this.#state;
  }
  get score(): number {
    return this.#score;
  }
  get merges(): number {
    return this.#merges;
  }

  /** The level the next drop will place, before any merge it triggers. */
  get dropLevel(): number {
    const ramp = dropLevelForMerges(this.#merges);
    // The first drop of a fresh game is seeded from the injected random so a run is not
    // perfectly identical every time; tests inject a fixed value.
    if (this.#merges === 0 && this.#score === 0) {
      return Math.max(1, Math.min(ramp, 1 + Math.floor(this.#random() * ramp)));
    }
    return ramp;
  }

  /** Level currently in a column, or null. Exposed for the deterministic test hooks. */
  levelAt(col: number): Cell {
    return col >= 0 && col < this.#board.length ? this.#board[col]! : null;
  }

  /** Begin play. Idempotent: only the first call from "start" moves into "playing". */
  begin(): void {
    if (this.#state === "start") this.#state = "playing";
  }

  /**
   * Drop the current piece into `col`. Places it if the column is empty, resolves the merge
   * cascade, advances the score and drop ramp, then checks the lose condition. A drop into a
   * full column or after game over is refused and leaves the state untouched.
   */
  dropAt(col: number): DropResult {
    if (this.#state !== "playing") return { placed: false, merges: 0, gained: 0, over: false };
    if (!canDropAt(this.#board, col)) {
      return { placed: false, merges: 0, gained: 0, over: false };
    }
    const level = this.dropLevel;
    const next = [...this.#board];
    next[col] = level;

    const resolved = resolveMerges(next);
    this.#board = resolved.board;
    this.#merges += resolved.merges;
    this.#score += resolved.score + level; // the placed piece is worth its own level too

    const over = !hasLegalMove(this.#board);
    if (over) this.#state = "over";
    return { placed: true, merges: resolved.merges, gained: resolved.score + level, over };
  }

  /**
   * The lowest-indexed empty column, or null when the board is full. The renderer and the
   * "tap anywhere" input use this so a plain tap still makes a legal move.
   */
  firstOpenColumn(): number | null {
    const index = this.#board.findIndex((cell) => cell === null);
    return index === -1 ? null : index;
  }

  /** Full reset back to the start screen. Used by restart and by revive-to-continue. */
  reset(): void {
    this.#board = new Array<Cell>(COLUMNS).fill(null);
    this.#state = "start";
    this.#score = 0;
    this.#merges = 0;
  }

  /**
   * Continue a lost run: clear the board but keep the score and merge ramp, and go straight
   * back to playing. This is what a granted rewarded ad buys the player.
   */
  continueRun(): void {
    if (this.#state !== "over") return;
    this.#board = new Array<Cell>(COLUMNS).fill(null);
    this.#state = "playing";
  }

  /** Double the score. Granted only by a confirmed rewarded ad at game over. */
  doubleScore(): void {
    if (this.#state !== "over") return;
    this.#score *= 2;
  }

  snapshot(): Snapshot {
    return {
      state: this.#state,
      score: this.#score,
      merges: this.#merges,
      dropLevel: this.dropLevel,
      board: this.board,
    };
  }
}
