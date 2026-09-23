// Orb Catcher's rules, with no engine, DOM or platform in sight.
//
// Positions are normalised to [0, 1] on both axes so the same level plays identically at
// 800x450 and at 1920x1080, and the simulation only ever advances in the fixed steps the
// game loop hands it — CrazyGames requires consistent physics across refresh rates (144 Hz,
// 165 Hz), which a per-frame delta would break.

export interface Orb {
  x: number;
  y: number;
  readonly speed: number;
}

export interface LevelSpec {
  readonly level: number;
  readonly goal: number;
  readonly spawnEveryMs: number;
  readonly fallPerS: number;
}

export const PADDLE_HALF_WIDTH = 0.09;
export const PADDLE_Y = 0.9;
export const ORB_RADIUS = 0.025;
const PADDLE_SPEED_PER_S = 1.1;

export function levelSpec(level: number): LevelSpec {
  return {
    level,
    // The first level is short so a new player reaches a first success quickly. It is not
    // what protects against an early ad: main.ts requests no midgame before level 3.
    goal: 6 + (level - 1) * 3,
    spawnEveryMs: Math.max(380, 720 - (level - 1) * 40),
    fallPerS: 0.32 + (level - 1) * 0.04,
  };
}

/** Deterministic, so a test can replay a level exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StepInput {
  /** Pointer target in [0, 1], or null when the pointer is not steering. */
  readonly targetX: number | null;
  /** -1 left, 0 none, 1 right. */
  readonly axis: number;
}

export interface StepResult {
  readonly caught: number;
  readonly missed: number;
}

export class OrbSimulation {
  readonly spec: LevelSpec;
  readonly orbs: Orb[] = [];
  paddleX = 0.5;
  caught = 0;
  #sinceSpawnMs = 0;
  readonly #random: () => number;

  constructor(spec: LevelSpec, seed = spec.level * 7919) {
    this.spec = spec;
    this.#random = mulberry32(seed);
    // Something to catch within the first second.
    this.#sinceSpawnMs = spec.spawnEveryMs - 250;
  }

  get complete(): boolean {
    return this.caught >= this.spec.goal;
  }

  step(stepMs: number, input: StepInput): StepResult {
    const dt = stepMs / 1000;
    this.#movePaddle(dt, input);

    this.#sinceSpawnMs += stepMs;
    if (this.#sinceSpawnMs >= this.spec.spawnEveryMs && !this.complete) {
      this.#sinceSpawnMs -= this.spec.spawnEveryMs;
      this.orbs.push({
        x: 0.08 + this.#random() * 0.84,
        y: -ORB_RADIUS,
        speed: this.spec.fallPerS * (0.85 + this.#random() * 0.3),
      });
    }

    let caught = 0;
    let missed = 0;
    for (let index = this.orbs.length - 1; index >= 0; index -= 1) {
      const orb = this.orbs[index]!;
      const previousY = orb.y;
      orb.y += orb.speed * dt;
      const crossedPaddle = previousY < PADDLE_Y && orb.y >= PADDLE_Y;
      if (crossedPaddle && Math.abs(orb.x - this.paddleX) <= PADDLE_HALF_WIDTH + ORB_RADIUS) {
        this.orbs.splice(index, 1);
        caught += 1;
      } else if (orb.y > 1 + ORB_RADIUS) {
        this.orbs.splice(index, 1);
        missed += 1;
      }
    }

    this.caught = Math.min(this.caught + caught, this.spec.goal);
    return { caught, missed };
  }

  #movePaddle(dt: number, input: StepInput): void {
    const min = PADDLE_HALF_WIDTH;
    const max = 1 - PADDLE_HALF_WIDTH;
    if (input.axis !== 0) {
      this.paddleX += input.axis * PADDLE_SPEED_PER_S * dt;
    } else if (input.targetX !== null) {
      // Ease toward the pointer rather than teleporting, at a rate independent of step size.
      const follow = 1 - Math.exp(-dt * 18);
      this.paddleX += (input.targetX - this.paddleX) * follow;
    }
    this.paddleX = Math.min(Math.max(this.paddleX, min), max);
  }
}
