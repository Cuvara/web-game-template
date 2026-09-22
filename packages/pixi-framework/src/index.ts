// PixiJS binding for `engine.type: pixijs`.
//
// Pixi's own ticker is left stopped. The fixed-timestep loop in @wgf/game-core is the only
// thing allowed to drive frames — two tickers means the simulation and the drawing disagree
// about how much time passed, and the bug that produces only shows up under load.

import type { Renderer, RendererOptions } from "@wgf/game-core";
import { Application, type Container } from "pixi.js";

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
      resolution: globalThis.devicePixelRatio ?? 1,
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
