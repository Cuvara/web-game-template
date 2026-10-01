// Three.js binding for `engine.type: threejs`.
//
// The pixel ratio is capped. GameVui's profile targets a market that is 80% mobile with a
// low-end Android floor and asserts a 30 FPS minimum; rendering at a phone's native 3x
// ratio is the cheapest way to miss that without anything looking wrong on a desktop.
//
// src/rendering/create-renderer.ts constructs this with no arguments — it is template-owned
// and a game may not edit it — so everything here defaults to something shippable and is
// adjustable afterwards through the setters. A game reaches the instance with
// `asThreeRenderer(context.renderer)`.

import type { Renderer, RendererOptions } from "@wgf/game-core";
import {
  BasicShadowMap,
  Color,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type ShadowMapType,
} from "three";
import { disposeObject3D } from "./dispose.js";

const MAX_PIXEL_RATIO = 2;

/** Shadow map quality. `off` is the default: shadows cost fill rate the low-end floor lacks. */
export type ShadowQuality = "off" | "basic" | "soft";

export interface CameraSettings {
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

/**
 * The drawing buffer scale to use. Pure so it can be tested without a WebGL context, which is
 * the only part of this file a unit test can reach.
 */
export function pixelRatioFor(devicePixelRatio: number, max: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cap = Number.isFinite(max) && max > 0 ? max : 1;
  return Math.min(ratio, cap);
}

export class ThreeRenderer implements Renderer {
  readonly kind = "threejs" as const;

  readonly scene = new Scene();
  #camera: PerspectiveCamera | null = null;
  #renderer: WebGLRenderer | null = null;
  #maxPixelRatio = MAX_PIXEL_RATIO;
  #contextLost = false;
  #detachContextListeners: (() => void) | null = null;

  get camera(): PerspectiveCamera {
    if (!this.#camera) throw new Error("ThreeRenderer.init() has not completed yet.");
    return this.#camera;
  }

  /** The three.js renderer itself, for anything the seam does not cover. */
  get webgl(): WebGLRenderer {
    return this.#require();
  }

  /** True between `webglcontextlost` and `webglcontextrestored`; `render()` is a no-op then. */
  get contextLost(): boolean {
    return this.#contextLost;
  }

  init(options: RendererOptions): Promise<void> {
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(pixelRatioFor(globalThis.devicePixelRatio ?? 1, this.#maxPixelRatio));
    renderer.setSize(options.width, options.height);
    options.container.appendChild(renderer.domElement);
    this.#watchContext(renderer);

    this.scene.background = new Color(options.background ?? 0x101014);
    this.#camera = new PerspectiveCamera(60, options.width / options.height, 0.1, 1000);
    this.#camera.position.set(0, 0, 5);
    this.#renderer = renderer;
    return Promise.resolve();
  }

  resize(width: number, height: number): void {
    const renderer = this.#require();
    // main.ts re-arms a `(resolution: Ndppx)` media query and resizes when the ratio changes
    // (the window moved to another screen). Without re-applying it here the drawing buffer
    // stays at the ratio the page loaded with, and the canvas is soft or needlessly large.
    renderer.setPixelRatio(pixelRatioFor(globalThis.devicePixelRatio ?? 1, this.#maxPixelRatio));
    renderer.setSize(width, height);
    if (this.#camera) {
      this.#camera.aspect = width / height;
      this.#camera.updateProjectionMatrix();
    }
  }

  /**
   * Draw one frame. The loop's interpolation factor is accepted and ignored — there is
   * nothing generic to interpolate in a 3D scene, so a game that wants smoothing applies
   * `alpha` to its own transforms before calling this.
   */
  render(_alpha?: number): void {
    // Drawing into a lost context throws on some drivers and is pointless on all of them.
    if (this.#contextLost) return;
    this.#require().render(this.scene, this.camera);
  }

  destroy(): void {
    this.#detachContextListeners?.();
    this.#detachContextListeners = null;
    // The scene graph is not the WebGLRenderer's to free: without this every geometry,
    // material and texture the game loaded stays on the GPU until the tab closes, which is
    // what a restart-leak measurement finds.
    disposeObject3D(this.scene);
    this.scene.clear();
    this.#renderer?.dispose();
    this.#renderer?.forceContextLoss();
    this.#renderer?.domElement.remove();
    this.#renderer = null;
    this.#camera = null;
    this.#contextLost = false;
  }

  /** Cap on the drawing buffer scale. Lower it on a title that runs out of fill rate. */
  setMaxPixelRatio(max: number): void {
    this.#maxPixelRatio = max;
    const renderer = this.#renderer;
    if (!renderer) return;
    renderer.setPixelRatio(pixelRatioFor(globalThis.devicePixelRatio ?? 1, max));
  }

  /**
   * Turn shadow mapping on. Off by default — casting and receiving stay the game's to set on
   * its own lights and meshes, and a title that needs none should not pay for the pass.
   */
  setShadows(quality: ShadowQuality): void {
    const renderer = this.#require();
    renderer.shadowMap.enabled = quality !== "off";
    if (quality !== "off") {
      const type: ShadowMapType = quality === "soft" ? PCFSoftShadowMap : BasicShadowMap;
      renderer.shadowMap.type = type;
    }
    renderer.shadowMap.needsUpdate = true;
  }

  /** The scene's backdrop. `null` clears it (a transparent canvas over the page). */
  setBackground(color: string | number | null): void {
    this.scene.background = color === null ? null : new Color(color);
  }

  /** Change the lens. Position and orientation stay the game's (or a camera rig's). */
  configureCamera(settings: CameraSettings): void {
    const camera = this.camera;
    if (settings.fov !== undefined) camera.fov = settings.fov;
    if (settings.near !== undefined) camera.near = settings.near;
    if (settings.far !== undefined) camera.far = settings.far;
    camera.updateProjectionMatrix();
  }

  /**
   * A lost context (a backgrounded mobile tab, a GPU reset, a driver update) is recoverable
   * only if the default is prevented: the browser then fires `webglcontextrestored` and
   * three.js re-uploads its state. Without this the canvas stays black for the rest of the
   * session — on a portal that reads as a crash.
   */
  #watchContext(renderer: WebGLRenderer): void {
    const canvas = renderer.domElement;
    const onLost = (event: Event): void => {
      event.preventDefault();
      this.#contextLost = true;
      console.warn("WebGL context lost; rendering paused until it is restored");
    };
    const onRestored = (): void => {
      this.#contextLost = false;
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    this.#detachContextListeners = (): void => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }

  #require(): WebGLRenderer {
    if (!this.#renderer) throw new Error("ThreeRenderer.init() has not completed yet.");
    return this.#renderer;
  }
}
