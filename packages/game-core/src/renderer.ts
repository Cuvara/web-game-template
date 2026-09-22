// The renderer seam.
//
// game.config.yaml picks `engine.type` — pixijs for 2D, threejs for 3D — and the tech plan
// records why. Everything above this interface is engine-agnostic, which is what keeps the
// choice a one-line configuration change rather than a rewrite.

export interface RendererOptions {
  readonly container: HTMLElement;
  readonly width: number;
  readonly height: number;
  /** CSS colour or 0xRRGGBB. Engine adapters normalise it. */
  readonly background?: string | number;
}

export interface Renderer {
  readonly kind: "pixijs" | "threejs";
  /** Create the drawing surface and attach it to the container. */
  init(options: RendererOptions): Promise<void>;
  resize(width: number, height: number): void;
  /** Draw one frame. `alpha` is the loop's interpolation factor. */
  render(alpha: number): void;
  destroy(): void;
}
