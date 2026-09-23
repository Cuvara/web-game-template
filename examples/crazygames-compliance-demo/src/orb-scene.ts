// The gameplay scene: input in, simulation stepped, Pixi drawing out.
//
// The only file in the demo that imports pixi.js. It knows nothing about CrazyGames — it
// reports what happened through callbacks and main.ts decides what the platform hears.

import type { Scene } from "@wgf/game-core";
import type { PixiRenderer } from "@wgf/pixi-framework";
import { Graphics } from "pixi.js";
import {
  ORB_RADIUS,
  OrbSimulation,
  PADDLE_HALF_WIDTH,
  PADDLE_Y,
  type LevelSpec,
} from "./simulation.js";

export interface OrbSceneOptions {
  readonly renderer: PixiRenderer;
  readonly spec: LevelSpec;
  /** Whether the controls hint should show — first level of a new player only. */
  readonly showHint: boolean;
  readonly onCatch: (caught: number, goal: number) => void;
  readonly onComplete: () => void;
  readonly onHintDone: () => void;
}

// Physical key positions, not characters: `KeyA`/`KeyD` sit where A and D are on QWERTY
// and where Q and D are on AZERTY, so the same hand position works on both — CrazyGames'
// restricted-keys guideline. Escape and Ctrl/Cmd+W are never bound.
const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);

export class OrbScene implements Scene {
  readonly id = "orbs";
  readonly simulation: OrbSimulation;

  readonly #options: OrbSceneOptions;
  readonly #graphics = new Graphics();
  readonly #held = new Set<string>();
  #pointerX: number | null = null;
  #hintVisible: boolean;
  #hintMs = 0;
  #completed = false;
  readonly #listeners: [string, EventListener][] = [];

  constructor(options: OrbSceneOptions) {
    this.#options = options;
    this.simulation = new OrbSimulation(options.spec);
    this.#hintVisible = options.showHint;
  }

  enter(): void {
    this.#options.renderer.stage.addChild(this.#graphics);
    this.#listen("pointermove", (event) => this.#onPointer(event as PointerEvent));
    this.#listen("pointerdown", (event) => this.#onPointer(event as PointerEvent));
    this.#listen("keydown", (event) => {
      const code = (event as KeyboardEvent).code;
      if (LEFT.has(code) || RIGHT.has(code)) {
        this.#held.add(code);
        this.#pointerX = null;
      }
    });
    this.#listen("keyup", (event) => this.#held.delete((event as KeyboardEvent).code));
    this.#listen("blur", () => this.#held.clear());
  }

  exit(): void {
    for (const [type, listener] of this.#listeners) window.removeEventListener(type, listener);
    this.#listeners.length = 0;
    this.#graphics.removeFromParent();
    this.#graphics.destroy();
  }

  // A key held when an ad starts must not still be "held" when it ends.
  pause(): void {
    this.#held.clear();
    this.#pointerX = null;
  }

  update(stepMs: number): void {
    if (this.#completed) return;
    let axis = 0;
    for (const code of this.#held) axis += LEFT.has(code) ? -1 : RIGHT.has(code) ? 1 : 0;
    const result = this.simulation.step(stepMs, {
      targetX: this.#pointerX,
      axis: Math.sign(axis),
    });

    if (this.#hintVisible) {
      this.#hintMs += stepMs;
      if (this.simulation.caught > 0 || this.#hintMs > 6000) {
        this.#hintVisible = false;
        this.#options.onHintDone();
      }
    }

    if (result.caught > 0) {
      this.#options.onCatch(this.simulation.caught, this.simulation.spec.goal);
    }
    if (this.simulation.complete) {
      this.#completed = true;
      this.#options.onComplete();
    }
  }

  render(): void {
    const { width, height } = this.#options.renderer.app.screen;
    const unit = Math.min(width, height);
    const g = this.#graphics.clear();

    const paddleW = PADDLE_HALF_WIDTH * 2 * width;
    const paddleH = Math.max(10, unit * 0.025);
    g.roundRect(
      this.simulation.paddleX * width - paddleW / 2,
      PADDLE_Y * height,
      paddleW,
      paddleH,
      paddleH / 2,
    ).fill(0x8b80ff);

    const radius = Math.max(6, ORB_RADIUS * unit);
    for (const orb of this.simulation.orbs) {
      g.circle(orb.x * width, orb.y * height, radius).fill(0xffd166);
    }
    this.#options.renderer.render();
  }

  #onPointer(event: PointerEvent): void {
    const width = this.#options.renderer.app.screen.width || window.innerWidth;
    this.#pointerX = event.clientX / width;
  }

  #listen(type: string, listener: EventListener): void {
    window.addEventListener(type, listener);
    this.#listeners.push([type, listener]);
  }
}
