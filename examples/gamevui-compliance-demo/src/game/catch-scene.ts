// The playing field, drawn with PixiJS.
//
// Everything is drawn from primitives in code: no images, fonts or audio files. That keeps
// the package small and, more to the point for a portal submission, means there is no
// third-party asset whose licence anyone has to vouch for.

import type { Scene } from "@wgf/game-core";
import type { PixiRenderer } from "@wgf/pixi-framework";
import { Container, Graphics } from "pixi.js";
import {
  basketHeight,
  basketTop,
  basketWidth,
  createRound,
  resize,
  startRound,
  steer,
  step,
  type RoundState,
  type StepEvents,
  type World,
} from "./rules.js";

export interface CatchSceneOptions {
  readonly renderer: PixiRenderer;
  readonly world: World;
  readonly seed: number;
  /** Called after every simulation step that changed score, lives or phase. */
  readonly onChange: (state: Readonly<RoundState>, events: StepEvents) => void;
}

const BACKGROUND_TOP = 0x1b2a4a;
const STAR_COLOUR = 0xffd54a;
const BASKET_COLOUR = 0x4fc3f7;

export class CatchScene implements Scene {
  readonly id = "catch";
  readonly state: RoundState;

  readonly #renderer: PixiRenderer;
  readonly #onChange: CatchSceneOptions["onChange"];
  readonly #layer = new Container();
  readonly #sky = new Graphics();
  readonly #stars = new Graphics();
  readonly #basket = new Graphics();
  #steps = 0;

  constructor(options: CatchSceneOptions) {
    this.#renderer = options.renderer;
    this.#onChange = options.onChange;
    this.state = createRound(options.world, options.seed);
  }

  /** Simulation steps taken while playing. The e2e suite reads it to see the round moving. */
  get steps(): number {
    return this.#steps;
  }

  enter(): void {
    this.#layer.addChild(this.#sky, this.#stars, this.#basket);
    this.#renderer.stage.addChild(this.#layer);
    this.#drawSky();
  }

  exit(): void {
    this.#renderer.stage.removeChild(this.#layer);
    this.#layer.destroy({ children: true });
  }

  start(): void {
    startRound(this.state);
    this.#onChange(this.state, { caught: 0, missed: 0 });
  }

  steer(x: number): void {
    steer(this.state, x);
  }

  resize(world: World): void {
    resize(this.state, world);
    this.#drawSky();
  }

  update(stepMs: number): void {
    if (this.state.phase !== "playing") return;
    this.#steps += 1;
    const before = this.state.phase;
    const events = step(this.state, stepMs);
    if (events.caught || events.missed || before !== this.state.phase) {
      this.#onChange(this.state, events);
    }
  }

  render(): void {
    const { world } = this.state;

    this.#stars.clear();
    for (const star of this.state.stars) {
      this.#stars.star(star.x, star.y, 5, star.radius, star.radius * 0.45).fill(STAR_COLOUR);
    }

    const width = basketWidth(world);
    const height = basketHeight(world);
    this.#basket
      .clear()
      .roundRect(this.state.basketX - width / 2, basketTop(world), width, height, height * 0.35)
      .fill(BASKET_COLOUR);

    this.#renderer.render();
  }

  #drawSky(): void {
    const { width, height } = this.state.world;
    this.#sky.clear().rect(0, 0, width, height).fill(BACKGROUND_TOP);
    // A few fixed background dots — seeded by position, so they do not flicker on resize.
    for (let i = 1; i <= 24; i++) {
      const x = ((i * 7919) % 1000) / 1000;
      const y = ((i * 104729) % 1000) / 1000;
      this.#sky.circle(x * width, y * height * 0.8, 1.2).fill({ color: 0xffffff, alpha: 0.35 });
    }
  }
}
