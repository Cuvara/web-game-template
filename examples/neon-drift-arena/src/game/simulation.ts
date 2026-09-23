// The pure simulation for Neon Drift Arena.
//
// Everything gameplay-affecting lives here and nothing here touches Three.js, the DOM or
// the platform. Rendering (src/game/arena-view.ts) reads this state; it never writes it.
// That split is what lets the whole game be driven and asserted from a unit test and from
// Playwright without reading a single pixel.
//
// Determinism is a hard requirement: the same seed and the same sequence of `tick`/`steer`
// calls always produce the same run. So there is no `Math.random`, no `Date.now`, no
// `performance.now` — time only advances through `tick(stepMs)` and randomness only comes
// from a seeded RNG. A fixed step is expected (the game loop feeds 1000/60 ms), but the
// simulation clamps and integrates per call so an irregular step never desynchronises it.

/**
 * A small, fast, fully deterministic PRNG (mulberry32). Seedable so a test — or a replay —
 * gets the identical obstacle stream every time. Deliberately not `Math.random`: that would
 * make runs unreproducible and the tests flaky.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    // Keep the seed a uint32 so behaviour does not depend on how the caller produced it.
    this.#state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

export type SimState = "running" | "over";

export interface Obstacle {
  /** Stable id so a renderer can track meshes across frames. */
  readonly id: number;
  /** Lane centre on the X axis, in arena units. */
  x: number;
  /** Distance ahead of the player on the Z axis. Approaches 0 as it nears the player. */
  z: number;
  /** Half-width for collision (a box half-extent on X). */
  readonly halfWidth: number;
}

export interface SimOptions {
  /** Seed for the obstacle stream. Same seed + same inputs => identical run. */
  readonly seed?: number;
  /** Half-width of the arena on X. The player and obstacles stay within [-bound, bound]. */
  readonly arenaHalfWidth?: number;
  /** Player half-width for collision on X. */
  readonly playerHalfWidth?: number;
  /** How fast the player slides sideways, arena units per second, at full steer. */
  readonly steerSpeed?: number;
  /** Forward speed of obstacles at the start of a run, arena units per second. */
  readonly baseSpeed?: number;
  /** Extra forward speed added per second survived. This is the difficulty ramp. */
  readonly speedRampPerSecond?: number;
  /** Seconds between obstacle spawns at the start of a run. */
  readonly baseSpawnIntervalS?: number;
  /** Distance ahead at which obstacles spawn. */
  readonly spawnDistance?: number;
}

const DEFAULTS = {
  seed: 1,
  arenaHalfWidth: 4,
  playerHalfWidth: 0.5,
  steerSpeed: 6,
  baseSpeed: 8,
  speedRampPerSecond: 0.35,
  baseSpawnIntervalS: 0.9,
  spawnDistance: 40,
} as const;

/** Largest single step the simulation will integrate, ms. Guards against huge deltas. */
const MAX_STEP_MS = 100;
/** Z at or below which an obstacle is level with the player and can collide. */
const COLLISION_Z = 0.5;
/** Z below which a passed obstacle is removed and scored as avoided. */
const DESPAWN_Z = -2;

export interface SimSnapshot {
  readonly state: SimState;
  readonly score: number;
  readonly playerX: number;
  readonly speed: number;
  readonly elapsedS: number;
  readonly obstacles: readonly Obstacle[];
}

/**
 * The endless neon-arena dodger, as pure state. Construct with a seed, then drive it with
 * `steer` and `tick`. Nothing in here schedules time or draws anything.
 */
export class Simulation {
  readonly #o: Required<SimOptions>;
  #rng: Rng;

  #state: SimState = "running";
  #score = 0;
  #playerX = 0;
  #steer = 0;
  #elapsedS = 0;
  #speed: number;
  #spawnTimerS = 0;
  #nextObstacleId = 1;
  #obstacles: Obstacle[] = [];

  constructor(options: SimOptions = {}) {
    this.#o = { ...DEFAULTS, ...options };
    this.#rng = new Rng(this.#o.seed);
    this.#speed = this.#o.baseSpeed;
  }

  get state(): SimState {
    return this.#state;
  }
  get score(): number {
    return Math.floor(this.#score);
  }
  get playerX(): number {
    return this.#playerX;
  }
  get speed(): number {
    return this.#speed;
  }
  get elapsedS(): number {
    return this.#elapsedS;
  }
  get obstacles(): readonly Obstacle[] {
    return this.#obstacles;
  }
  get arenaHalfWidth(): number {
    return this.#o.arenaHalfWidth;
  }
  get playerHalfWidth(): number {
    return this.#o.playerHalfWidth;
  }

  /** A plain, cloneable view of the whole run. Handy for the window probe and assertions. */
  snapshot(): SimSnapshot {
    return {
      state: this.#state,
      score: this.score,
      playerX: this.#playerX,
      speed: this.#speed,
      elapsedS: this.#elapsedS,
      obstacles: this.#obstacles.map((o) => ({ ...o })),
    };
  }

  /**
   * Set the steering direction: -1 full left, +1 full right, 0 coast. Values are clamped, so
   * an analog pointer can pass a fraction. Stateful — the last value persists across ticks
   * until changed, which is how a held key steers continuously.
   */
  steer(direction: number): void {
    this.#steer = clamp(direction, -1, 1);
  }

  /**
   * Inject an obstacle at a lane and distance. The normal spawner uses the seeded RNG; this
   * is the deterministic hook a test (or Playwright) uses to place a collision or a near miss
   * exactly where it wants one, with no dependence on the RNG stream.
   */
  spawnObstacleAt(x: number, z: number, halfWidth = 0.6): Obstacle {
    const obstacle: Obstacle = {
      id: this.#nextObstacleId++,
      x: clamp(x, -this.#o.arenaHalfWidth, this.#o.arenaHalfWidth),
      z,
      halfWidth,
    };
    this.#obstacles.push(obstacle);
    return obstacle;
  }

  /**
   * Resume a crashed run: clear every obstacle currently near the player so the continue is
   * survivable, and return the state to `running`. Deterministic — it removes obstacles by
   * position, consumes no RNG, and leaves the seeded stream untouched, so the rest of the run
   * unfolds identically to one that was never interrupted. No-op unless the run is over.
   * Returns true when the run was revived.
   */
  revive(): boolean {
    if (this.#state !== "over") return false;
    // Drop anything still ahead of or level with the player; keep only what is safely behind.
    this.#obstacles = this.#obstacles.filter((o) => o.z <= DESPAWN_Z);
    this.#state = "running";
    return true;
  }

  /**
   * Advance the whole simulation by `stepMs` of simulation time. Called once per fixed step
   * by the game loop. A no-op once the run is over, so a paused/finished loop that keeps
   * ticking does nothing. Returns true while still running.
   */
  tick(stepMs: number): boolean {
    if (this.#state !== "running") return false;
    // Clamp: a single enormous delta (a backgrounded tab handed straight to the sim) must
    // not teleport obstacles through the player and skip the collision test.
    const dt = Math.min(Math.max(stepMs, 0), MAX_STEP_MS) / 1000;
    if (dt === 0) return true;

    this.#elapsedS += dt;
    // Score ticks up with survival time; passing obstacles adds a bonus below.
    this.#score += dt * 10;
    // Difficulty ramp: obstacles get steadily faster the longer the run lasts.
    this.#speed = this.#o.baseSpeed + this.#elapsedS * this.#o.speedRampPerSecond;

    this.#integratePlayer(dt);
    this.#spawn(dt);
    this.#advanceObstacles(dt);

    return this.#state === "running";
  }

  #integratePlayer(dt: number): void {
    const bound = this.#o.arenaHalfWidth - this.#o.playerHalfWidth;
    this.#playerX = clamp(this.#playerX + this.#steer * this.#o.steerSpeed * dt, -bound, bound);
  }

  #spawn(dt: number): void {
    // Spawn cadence tightens as speed rises, so the arena stays busy without the interval
    // ever collapsing to zero.
    const interval = this.#o.baseSpawnIntervalS * (this.#o.baseSpeed / this.#speed);
    this.#spawnTimerS += dt;
    while (this.#spawnTimerS >= interval) {
      this.#spawnTimerS -= interval;
      const lane = this.#rng.range(-this.#o.arenaHalfWidth, this.#o.arenaHalfWidth);
      this.spawnObstacleAt(lane, this.#o.spawnDistance, this.#rng.range(0.4, 0.8));
    }
  }

  #advanceObstacles(dt: number): void {
    const dz = this.#speed * dt;
    const survivors: Obstacle[] = [];
    for (const obstacle of this.#obstacles) {
      obstacle.z -= dz;
      if (obstacle.z <= COLLISION_Z && obstacle.z > DESPAWN_Z) {
        if (this.#collides(obstacle)) {
          this.#state = "over";
          // Keep the offending obstacle in the list so the renderer can show the crash.
          survivors.push(obstacle);
          continue;
        }
      }
      if (obstacle.z <= DESPAWN_Z) {
        // Cleared without a hit: a small reward on top of the survival score.
        this.#score += 5;
        continue;
      }
      survivors.push(obstacle);
    }
    this.#obstacles = survivors;
  }

  #collides(obstacle: Obstacle): boolean {
    return (
      Math.abs(obstacle.x - this.#playerX) < obstacle.halfWidth + this.#o.playerHalfWidth
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
