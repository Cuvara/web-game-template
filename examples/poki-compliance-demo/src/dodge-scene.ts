// The game: move along the bottom, dodge what falls.
//
// Small on purpose — it exists to exercise every lifecycle path Poki documents, and a
// death every twenty seconds or so is what makes restart and revive reachable in a test.
// It knows nothing about Poki; it reports a death through `onDeath` and nothing else.

import type { Scene } from "@wgf/game-core";
import { Container, Graphics } from "pixi.js";
import type { WorldLayout } from "./layout.js";

const PLAYER_WIDTH = 90;
const PLAYER_HEIGHT = 24;
const PLAYER_SPEED = 0.9; // world units per ms
const BLOCK_SIZE = 44;

interface Block {
  readonly sprite: Graphics;
  x: number;
  y: number;
  speed: number;
}

export interface DodgeInput {
  /** -1, 0 or 1. */
  readonly axis: number;
  /** A held pointer's target, in world units, or null. */
  readonly targetX: number | null;
}

export interface DodgeSceneOptions {
  readonly stage: Container;
  readonly input: () => DodgeInput;
  readonly onScore: (score: number) => void;
  readonly onDeath: (score: number) => void;
  /** The player's position in world units, whenever it changes by a whole unit. */
  readonly onMove?: (x: number) => void;
  /** 0..1, replaced in tests so a run is reproducible. */
  readonly random?: () => number;
}

export class DodgeScene implements Scene {
  readonly id = "dodge";

  readonly #root = new Container();
  readonly #background = new Graphics();
  readonly #player = new Graphics();
  readonly #blocks: Block[] = [];
  readonly #options: DodgeSceneOptions;
  readonly #random: () => number;

  #layout: WorldLayout = { width: 1280, height: 720, scale: 1, offsetX: 0 };
  #running = false;
  #playerX = 640;
  #spawnInMs = 0;
  #elapsedMs = 0;
  #score = 0;

  constructor(options: DodgeSceneOptions) {
    this.#options = options;
    this.#random = options.random ?? Math.random;
    this.#root.addChild(this.#background, this.#player);
    this.#player
      .roundRect(-PLAYER_WIDTH / 2, -PLAYER_HEIGHT / 2, PLAYER_WIDTH, PLAYER_HEIGHT, 8)
      .fill(0x3d7eff);
  }

  get score(): number {
    return this.#score;
  }

  get running(): boolean {
    return this.#running;
  }

  enter(): void {
    this.#options.stage.addChild(this.#root);
    this.#draw();
  }

  exit(): void {
    this.#options.stage.removeChild(this.#root);
  }

  resize(layout: WorldLayout): void {
    this.#layout = layout;
    this.#root.scale.set(layout.scale);
    this.#root.x = layout.offsetX;
    this.#playerX = Math.min(
      Math.max(this.#playerX, PLAYER_WIDTH / 2),
      layout.width - PLAYER_WIDTH / 2,
    );
    this.#background.clear().rect(0, 0, layout.width, layout.height).fill(0x1b1e2b);
    this.#draw();
  }

  /** A fresh run. */
  reset(): void {
    for (const block of this.#blocks.splice(0)) block.sprite.destroy();
    this.#playerX = this.#layout.width / 2;
    this.#spawnInMs = 600;
    this.#elapsedMs = 0;
    this.#score = 0;
    this.#options.onScore(0);
    this.#options.onMove?.(Math.round(this.#playerX));
    this.#running = true;
    this.#draw();
  }

  /** Continue the same run after a reward: the score stays, the danger overhead goes. */
  revive(): void {
    for (const block of this.#blocks.splice(0)) block.sprite.destroy();
    this.#spawnInMs = 900;
    this.#running = true;
    this.#draw();
  }

  update(stepMs: number): void {
    if (!this.#running) return;
    this.#elapsedMs += stepMs;

    const input = this.#options.input();
    let direction = input.axis;
    if (input.targetX !== null && Math.abs(input.targetX - this.#playerX) > 6) {
      direction = Math.sign(input.targetX - this.#playerX);
    }
    const half = PLAYER_WIDTH / 2;
    const before = Math.round(this.#playerX);
    this.#playerX = Math.min(
      Math.max(this.#playerX + direction * PLAYER_SPEED * stepMs, half),
      this.#layout.width - half,
    );
    if (Math.round(this.#playerX) !== before) this.#options.onMove?.(Math.round(this.#playerX));

    this.#spawnInMs -= stepMs;
    if (this.#spawnInMs <= 0) {
      const difficulty = Math.min(this.#elapsedMs / 30_000, 1);
      this.#spawnInMs = 520 - 300 * difficulty;
      const sprite = new Graphics()
        .rect(-BLOCK_SIZE / 2, -BLOCK_SIZE / 2, BLOCK_SIZE, BLOCK_SIZE)
        .fill(0xff8a3d);
      this.#root.addChild(sprite);
      this.#blocks.push({
        sprite,
        x: BLOCK_SIZE / 2 + this.#random() * (this.#layout.width - BLOCK_SIZE),
        y: -BLOCK_SIZE,
        speed: 0.25 + 0.3 * difficulty + this.#random() * 0.15,
      });
    }

    const playerY = this.#layout.height - 60;
    for (let index = this.#blocks.length - 1; index >= 0; index -= 1) {
      const block = this.#blocks[index]!;
      block.y += block.speed * stepMs;
      const hit =
        Math.abs(block.x - this.#playerX) < (BLOCK_SIZE + PLAYER_WIDTH) / 2 &&
        Math.abs(block.y - playerY) < (BLOCK_SIZE + PLAYER_HEIGHT) / 2;
      if (hit) {
        this.#running = false;
        this.#options.onDeath(this.#score);
        return;
      }
      if (block.y > this.#layout.height + BLOCK_SIZE) {
        block.sprite.destroy();
        this.#blocks.splice(index, 1);
        this.#score += 1;
        this.#options.onScore(this.#score);
      }
    }
  }

  render(): void {
    this.#draw();
  }

  #draw(): void {
    this.#player.position.set(this.#playerX, this.#layout.height - 60);
    for (const block of this.#blocks) block.sprite.position.set(block.x, block.y);
  }
}
