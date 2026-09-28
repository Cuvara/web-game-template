// Orbit camera.
//
// three's OrbitControls with the settings a shipped game wants rather than the ones an editor
// wants: damping on (it is off by default and the camera feels stiff without it), no pan by
// default (a player who pans loses the playfield and cannot get back), and a distance range.
// Damped controls must be updated every frame, which is why `update` exists here at all.

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ThreeRenderer } from "../renderer.js";

export interface OrbitRigOptions {
  /** What the camera orbits. Default the origin. */
  readonly target?: readonly [number, number, number];
  readonly minDistance?: number;
  readonly maxDistance?: number;
  /** Lower/upper pitch limits in radians. The default keeps the camera above the ground. */
  readonly minPolarAngle?: number;
  readonly maxPolarAngle?: number;
  /** Let the player pan the pivot. Off by default. */
  readonly enablePan?: boolean;
  /** Damping strength, 0–1. Lower is smoother and slower. */
  readonly dampingFactor?: number;
}

/**
 * ```ts
 * const orbit = new OrbitRig(three, { minDistance: 4, maxDistance: 20 });
 * // in Scene.render(): orbit.update();   // damping is a per-frame effect, not simulation
 * ```
 */
export class OrbitRig {
  readonly controls: OrbitControls;

  constructor(renderer: ThreeRenderer, options: OrbitRigOptions = {}) {
    const controls = new OrbitControls(renderer.camera, renderer.webgl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = options.dampingFactor ?? 0.08;
    controls.enablePan = options.enablePan ?? false;
    controls.minDistance = options.minDistance ?? 2;
    controls.maxDistance = options.maxDistance ?? 40;
    controls.minPolarAngle = options.minPolarAngle ?? 0.1;
    // Just above the horizon: below it the camera ends up under the floor.
    controls.maxPolarAngle = options.maxPolarAngle ?? Math.PI / 2 - 0.05;
    const [x, y, z] = options.target ?? [0, 0, 0];
    controls.target.set(x, y, z);
    controls.update();
    this.controls = controls;
  }

  /** Move the pivot. Follow a player with it for a soft over-the-shoulder view. */
  setTarget(x: number, y: number, z: number): void {
    this.controls.target.set(x, y, z);
  }

  /** Apply damping. Call once per rendered frame, not per simulation step. */
  update(): void {
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
