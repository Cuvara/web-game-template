// The renderer seam.
//
// game.config.yaml picks `engine.type` — pixijs or phaserjs for 2D, threejs for 3D — and the
// tech plan records why. Everything above this interface is engine-agnostic, which is what
// keeps the choice a one-line configuration change rather than a rewrite.
//
// A binding never drives frames itself: this loop is the only one. An engine that ships its
// own (Phaser) has it stopped at boot and is stepped from `render()`.

export interface RendererOptions {
  readonly container: HTMLElement;
  readonly width: number;
  readonly height: number;
  /** CSS colour or 0xRRGGBB. Engine adapters normalise it. */
  readonly background?: string | number;
}

export interface Renderer {
  readonly kind: "pixijs" | "phaserjs" | "threejs";
  /** Create the drawing surface and attach it to the container. */
  init(options: RendererOptions): Promise<void>;
  resize(width: number, height: number): void;
  /** Draw one frame. `alpha` is the loop's interpolation factor. */
  render(alpha: number): void;
  destroy(): void;
}
