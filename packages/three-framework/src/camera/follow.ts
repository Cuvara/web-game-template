// Third-person camera.
//
// Damping is exponential and computed from the step, not applied as a fixed fraction per
// frame: `position += (target - position) * 0.1` looks right at 60 Hz and is a different
// camera entirely at 30 or 144. The loop's step is fixed, but a title that changes `stepMs`
// should not have to retune its camera.

import { Quaternion, Vector3, type Camera, type Object3D } from "three";

export interface FollowCameraOptions {
  /** Where the camera sits relative to the target, in the target's local space. */
  readonly offset?: readonly [number, number, number];
  /** What it looks at, relative to the target. Usually head height, or slightly ahead. */
  readonly lookAtOffset?: readonly [number, number, number];
  /**
   * How fast it catches up, per second. A high value pins the camera to the offset; 8 is a
   * responsive chase, 2 a lazy drift. It closes 63% of the gap in 1/stiffness seconds.
   */
  readonly stiffness?: number;
  /** Follow the target's yaw as well as its position (a chase camera). Default true. */
  readonly followRotation?: boolean;
}

/** Scratch vectors: `update` runs every step for every rig and must not allocate. */
const POSITION = new Vector3();

/**
 * Keeps a camera behind a moving object.
 *
 * ```ts
 * const follow = new FollowCamera(three.camera, { offset: [0, 3, -6] });
 * follow.setTarget(player);
 * follow.snap();               // on spawn and on restart, so it does not fly in
 * // in Scene.update(stepMs): follow.update(stepMs);
 * ```
 */
export class FollowCamera {
  readonly #camera: Camera;
  readonly #offset: Vector3;
  readonly #lookAtOffset: Vector3;
  readonly #stiffness: number;
  readonly #followRotation: boolean;

  #target: Object3D | null = null;
  readonly #desired = new Vector3();
  readonly #lookAt = new Vector3();
  readonly #rotation = new Quaternion();

  constructor(camera: Camera, options: FollowCameraOptions = {}) {
    this.#camera = camera;
    const [ox, oy, oz] = options.offset ?? [0, 4, -8];
    this.#offset = new Vector3(ox, oy, oz);
    const [lx, ly, lz] = options.lookAtOffset ?? [0, 1, 0];
    this.#lookAtOffset = new Vector3(lx, ly, lz);
    this.#stiffness = options.stiffness ?? 6;
    this.#followRotation = options.followRotation ?? true;
  }

  get target(): Object3D | null {
    return this.#target;
  }

  /** Follow `target`, or nothing. Does not move the camera until the next `update`. */
  setTarget(target: Object3D | null): void {
    this.#target = target;
  }

  /** Place the camera at its resting position immediately — spawn, restart, teleport. */
  snap(): void {
    if (!this.#target) return;
    this.#resolve();
    this.#camera.position.copy(this.#desired);
    this.#camera.lookAt(this.#lookAt);
  }

  /** Advance the camera by one simulation step. Call from `Scene.update(stepMs)`. */
  update(stepMs: number): void {
    if (!this.#target) return;
    this.#resolve();
    // 1 - e^(-k·dt): the same catch-up for the same elapsed time, whatever the step size.
    const blend = 1 - Math.exp((-this.#stiffness * stepMs) / 1000);
    this.#camera.position.lerp(this.#desired, blend);
    this.#camera.lookAt(this.#lookAt);
  }

  /** Where the camera wants to be, and what it wants to look at, in world space. */
  #resolve(): void {
    const target = this.#target;
    if (!target) return;
    target.updateWorldMatrix(true, false);
    target.getWorldPosition(POSITION);
    if (this.#followRotation) target.getWorldQuaternion(this.#rotation);
    else this.#rotation.identity();
    this.#desired.copy(this.#offset).applyQuaternion(this.#rotation).add(POSITION);
    this.#lookAt.copy(this.#lookAtOffset).applyQuaternion(this.#rotation).add(POSITION);
  }
}
