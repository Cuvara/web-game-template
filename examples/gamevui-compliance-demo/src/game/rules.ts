// Star Catcher's rules, with no rendering and no DOM.
//
// Kept pure so the unit tests can play whole rounds without a browser, and so a replay with
// the same seed and inputs is the same round. Units are CSS pixels of the play area; the
// area changes size with the viewport, so every size here is derived from it rather than
// fixed.

export type Phase = "title" | "playing" | "over";

export interface Star {
  readonly id: number;
  x: number;
  y: number;
  readonly radius: number;
  readonly speed: number;
}

export interface World {
  width: number;
  height: number;
}

export interface RoundState {
  phase: Phase;
  world: World;
  basketX: number;
  /** Where the pointer or keyboard wants the basket to be. The basket eases toward it. */
  targetX: number;
  stars: Star[];
  score: number;
  lives: number;
  spawnInMs: number;
  nextStarId: number;
  seed: number;
}

export const START_LIVES = 3;
/** Fraction of the remaining distance the basket closes per millisecond. */
const BASKET_EASE_PER_MS = 0.07;
const BASE_SPAWN_MS = 750;
const MIN_SPAWN_MS = 320;

/** mulberry32 — small, seedable, and good enough to scatter stars. */
export function nextRandom(state: { seed: number }): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The shorter side drives every size, so portrait and landscape play the same. */
function unit(world: World): number {
  return Math.max(Math.min(world.width, world.height), 1);
}

export function basketWidth(world: World): number {
  return unit(world) * 0.26;
}

export function basketHeight(world: World): number {
  return unit(world) * 0.07;
}

/** Top edge of the basket. */
export function basketTop(world: World): number {
  return world.height - basketHeight(world) - unit(world) * 0.05;
}

export function createRound(world: World, seed: number): RoundState {
  return {
    phase: "title",
    world: { ...world },
    basketX: world.width / 2,
    targetX: world.width / 2,
    stars: [],
    score: 0,
    lives: START_LIVES,
    spawnInMs: BASE_SPAWN_MS,
    nextStarId: 1,
    seed: seed | 0,
  };
}

export function startRound(state: RoundState): void {
  const { world, seed } = state;
  Object.assign(state, createRound(world, seed), { phase: "playing" as Phase });
}

export function steer(state: RoundState, x: number): void {
  state.targetX = clampBasket(state.world, x);
}

function clampBasket(world: World, x: number): number {
  const half = basketWidth(world) / 2;
  return Math.min(Math.max(x, half), Math.max(world.width - half, half));
}

/** Keep the round playable when the viewport changes: rotate a phone, resize a window. */
export function resize(state: RoundState, world: World): void {
  const sx = world.width / Math.max(state.world.width, 1);
  const sy = world.height / Math.max(state.world.height, 1);
  state.world = { ...world };
  state.basketX = clampBasket(world, state.basketX * sx);
  state.targetX = clampBasket(world, state.targetX * sx);
  for (const star of state.stars) {
    star.x *= sx;
    star.y *= sy;
  }
}

function spawnInterval(score: number): number {
  return Math.max(MIN_SPAWN_MS, BASE_SPAWN_MS - score * 12);
}

function spawn(state: RoundState): void {
  const u = unit(state.world);
  const radius = u * 0.035;
  const x = radius + nextRandom(state) * Math.max(state.world.width - radius * 2, 0);
  // Pixels per ms. A star crosses the shorter side in roughly 2.4 s at the start and
  // speeds up with the score.
  const speed =
    (u / 2400) * (1 + Math.min(state.score, 40) * 0.03) * (0.85 + nextRandom(state) * 0.3);
  state.stars.push({ id: state.nextStarId++, x, y: -radius, radius, speed });
}

export interface StepEvents {
  caught: number;
  missed: number;
}

/** Advance the round by `stepMs`. Returns what happened, for sound or effects. */
export function step(state: RoundState, stepMs: number): StepEvents {
  const events: StepEvents = { caught: 0, missed: 0 };
  if (state.phase !== "playing") return events;

  const ease = 1 - Math.pow(1 - BASKET_EASE_PER_MS, stepMs);
  state.basketX += (state.targetX - state.basketX) * ease;

  state.spawnInMs -= stepMs;
  while (state.spawnInMs <= 0) {
    spawn(state);
    state.spawnInMs += spawnInterval(state.score);
  }

  const top = basketTop(state.world);
  const half = basketWidth(state.world) / 2;
  const kept: Star[] = [];
  for (const star of state.stars) {
    const previousY = star.y;
    star.y += star.speed * stepMs;
    const crossedRim = previousY + star.radius < top && star.y + star.radius >= top;
    if (crossedRim && Math.abs(star.x - state.basketX) <= half + star.radius * 0.5) {
      events.caught += 1;
      state.score += 1;
      continue;
    }
    if (star.y - star.radius > state.world.height) {
      events.missed += 1;
      state.lives -= 1;
      continue;
    }
    kept.push(star);
  }
  state.stars = kept;

  if (state.lives <= 0) {
    state.lives = 0;
    state.phase = "over";
  }
  return events;
}
