// PixiJS binding for `engine.type: pixijs`.
//
// Pixi's own ticker is left stopped. The fixed-timestep loop in @wgf/game-core is the only
// thing allowed to drive frames — two tickers means the simulation and the drawing disagree
// about how much time passed, and the bug that produces only shows up under load.

import type { Renderer, RendererOptions } from "@wgf/game-core";
import { Application, type Container } from "pixi.js";
// PixiJS 8 registers a display object's render pipe when that object's module is imported,
// and a renderer only picks up pipes registered before its own init(). A game whose scene
// code arrives in a chunk loaded after init - the normal shape of a lazily imported engine
// seam - would otherwise throw "Cannot read properties of undefined (reading
// 'validateRenderable')" on every frame, in production builds only. These are PixiJS's own
// side-effect entry points for exactly this; they cost only what the game did not already use.
import "pixi.js/graphics";
import "pixi.js/text";
import "pixi.js/text-bitmap";
import "pixi.js/mesh";
import "pixi.js/sprite-tiling";
import "pixi.js/sprite-nine-slice";
import "pixi.js/particle-container";

/**
 * Same cap as the Three.js renderer. A 2.75x phone screen costs nearly twice the fill of a
 * 2x one for no visible gain in a game, and fill rate is what low-end Android runs out of.
 */
const MAX_RESOLUTION = 2;

export class PixiRenderer implements Renderer {
  readonly kind = "pixijs" as const;

  #app: Application | null = null;

  /** The scene graph root. Game code adds its display objects here. */
  get stage(): Container {
    return this.#require().stage;
  }

  get app(): Application {
    return this.#require();
  }

  async init(options: RendererOptions): Promise<void> {
    const app = new Application();
    await app.init({
      width: options.width,
      height: options.height,
      background: options.background ?? 0x101014,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(globalThis.devicePixelRatio ?? 1, MAX_RESOLUTION),
    });
    // The loop drives rendering; Pixi must not also drive it.
    app.ticker.stop();
    options.container.appendChild(app.canvas);
    this.#app = app;
  }

  resize(width: number, height: number): void {
    this.#require().renderer.resize(width, height);
  }

  render(): void {
    const app = this.#require();
    app.renderer.render(app.stage);
  }

  destroy(): void {
    this.#app?.destroy(true, { children: true });
    this.#app = null;
  }

  #require(): Application {
    if (!this.#app) throw new Error("PixiRenderer.init() has not completed yet.");
    return this.#app;
  }
}
