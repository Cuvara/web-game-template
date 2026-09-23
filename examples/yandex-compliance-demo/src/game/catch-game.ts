// The demo's whole game: catch falling stars, miss three and it is over.
//
// Pure simulation. No PixiJS, no DOM, no platform — which is what lets the unit tests drive
// it step by step, and what keeps anything portal-specific out of gameplay code. Coordinates
// are normalised: x and y both run 0..1 across the playfield, and the view scales them.

export const BASKET_WIDTH = 0.2;
export const BASKET_Y = 0.9;
export const STAR_RADIUS = 0.03;
export const START_LIVES = 3;

/** Normalised playfield widths per second the basket moves under keyboard control. */
const KEYBOARD_SPEED = 1.1;
const FIRST_SPAWN_MS = 600;
const SPAWN_MS_START = 1100;
const SPAWN_MS_MIN = 420;
const FALL_SPEED_START = 0.28;
const FALL_SPEED_MAX = 0.75;
/** Score at which the ramp reaches its ceiling. */
const RAMP_SCORE = 40;

export interface Star {
  readonly id: number;
  readonly x: number;
  y: number;
  readonly speed: number;
}

export interface GameInput {
  /** Pointer or touch target, normalised. `null` when no pointer is steering. */
  readonly targetX: number | null;
  /** Keyboard steering: -1 left, 1 right, 0 none. */
  readonly axis: -1 | 0 | 1;
}

export type GameEvent = "catch" | "miss" | "over";

export interface CatchGameOptions {
  /** Injected so tests are deterministic. */
  readonly random?: () => number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export class CatchGame {
  readonly #random: () => number;
  #stars: Star[] = [];
  #nextId = 1;
  #spawnInMs = FIRST_SPAWN_MS;
  #basketX = 0.5;
  #score = 0;
  #lives = START_LIVES;
  #over = false;
  #revived = false;

  constructor(options: CatchGameOptions = {}) {
    this.#random = options.random ?? Math.random;
  }

  get stars(): readonly Star[] {
    return this.#stars;
  }
  get basketX(): number {
    return this.#basketX;
  }
  get score(): number {
    return this.#score;
  }
  get lives(): number {
    return this.#lives;
  }
  get over(): boolean {
    return this.#over;
  }
  /** A run may be continued once, after a rewarded ad. */
  get canRevive(): boolean {
    return this.#over && !this.#revived;
  }

  /** Advance one fixed step. Returns what happened, for sound and UI. */
  update(stepMs: number, input: GameInput): GameEvent[] {
    if (this.#over) return [];
    const events: GameEvent[] = [];
    const seconds = stepMs / 1000;

    this.#steer(seconds, input);

    this.#spawnInMs -= stepMs;
    if (this.#spawnInMs <= 0) {
      this.#spawn();
      this.#spawnInMs += this.#spawnIntervalMs();
    }

    const half = BASKET_WIDTH / 2;
    const survivors: Star[] = [];
    for (const star of this.#stars) {
      const previousY = star.y;
      star.y += star.speed * seconds;
      const crossedBasket = previousY < BASKET_Y && star.y >= BASKET_Y;
      if (crossedBasket && Math.abs(star.x - this.#basketX) <= half + STAR_RADIUS) {
        this.#score += 1;
        events.push("catch");
      } else if (star.y - STAR_RADIUS > 1) {
        this.#lives -= 1;
        events.push("miss");
      } else {
        survivors.push(star);
      }
    }
    this.#stars = survivors;

    if (this.#lives <= 0) {
      this.#lives = 0;
      this.#over = true;
      events.push("over");
    }
    return events;
  }

  /** Continue a finished run with one life. Only once per run; the caller grants it. */
  revive(): boolean {
    if (!this.canRevive) return false;
    this.#revived = true;
    this.#over = false;
    this.#lives = 1;
    this.#stars = [];
    this.#spawnInMs = FIRST_SPAWN_MS;
    return true;
  }

  #steer(seconds: number, input: GameInput): void {
    const half = BASKET_WIDTH / 2;
    if (input.axis !== 0) {
      this.#basketX += input.axis * KEYBOARD_SPEED * seconds;
    } else if (input.targetX !== null) {
      this.#basketX = input.targetX;
    }
    this.#basketX = clamp(this.#basketX, half, 1 - half);
  }

  #ramp(): number {
    return clamp(this.#score / RAMP_SCORE, 0, 1);
  }

  #spawnIntervalMs(): number {
    return SPAWN_MS_START - (SPAWN_MS_START - SPAWN_MS_MIN) * this.#ramp();
  }

  #spawn(): void {
    const speed = FALL_SPEED_START + (FALL_SPEED_MAX - FALL_SPEED_START) * this.#ramp();
    const x = STAR_RADIUS + this.#random() * (1 - 2 * STAR_RADIUS);
    this.#stars.push({ id: this.#nextId++, x, y: -STAR_RADIUS, speed });
  }
}
