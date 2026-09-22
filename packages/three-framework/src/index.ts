// Three.js binding for `engine.type: threejs`.
//
// The pixel ratio is capped. GameVui's profile targets a market that is 80% mobile with a
// low-end Android floor and asserts a 30 FPS minimum; rendering at a phone's native 3x
// ratio is the cheapest way to miss that without anything looking wrong on a desktop.

import type { Renderer, RendererOptions } from "@wgf/game-core";
import { Color, PerspectiveCamera, Scene, WebGLRenderer } from "three";

const MAX_PIXEL_RATIO = 2;

export class ThreeRenderer implements Renderer {
  readonly kind = "threejs" as const;

  readonly scene = new Scene();
  #camera: PerspectiveCamera | null = null;
  #renderer: WebGLRenderer | null = null;

  get camera(): PerspectiveCamera {
    if (!this.#camera) throw new Error("ThreeRenderer.init() has not completed yet.");
    return this.#camera;
  }

  init(options: RendererOptions): Promise<void> {
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO));
    renderer.setSize(options.width, options.height);
    options.container.appendChild(renderer.domElement);

    this.scene.background = new Color(options.background ?? 0x101014);
    this.#camera = new PerspectiveCamera(60, options.width / options.height, 0.1, 1000);
    this.#camera.position.set(0, 0, 5);
    this.#renderer = renderer;
    return Promise.resolve();
  }

  resize(width: number, height: number): void {
    this.#require().setSize(width, height);
    if (this.#camera) {
      this.#camera.aspect = width / height;
      this.#camera.updateProjectionMatrix();
    }
  }

  render(): void {
    this.#require().render(this.scene, this.camera);
  }

  destroy(): void {
    this.#renderer?.dispose();
    this.#renderer?.domElement.remove();
    this.#renderer = null;
    this.#camera = null;
  }

  #require(): WebGLRenderer {
    if (!this.#renderer) throw new Error("ThreeRenderer.init() has not completed yet.");
    return this.#renderer;
  }
}
