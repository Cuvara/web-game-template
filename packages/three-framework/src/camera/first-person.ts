// First-person camera, on pointer lock.
//
// The rig owns the camera and the pointer, never the keyboard: it is driven by a movement
// intent the game produces from whatever input it has (keys, a touch stick, an AI). That
// keeps input a game concern — `src/input/` belongs to the game — while the part every
// first-person title would otherwise rewrite, pointer lock plus frame-rate-independent
// movement on the fixed step, lives here.

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import type { ThreeRenderer } from "../renderer.js";

export interface MoveIntent {
  /** -1 back … 1 forward. */
  readonly forward: number;
  /** -1 left … 1 right. */
  readonly right: number;
  /** Apply the run multiplier this step. */
  readonly run?: boolean;
}

export interface FirstPersonRigOptions {
  /** Walking speed in world units per second. */
  readonly speed?: number;
  /** Multiplier applied while `intent.run` is set. */
  readonly runMultiplier?: number;
  /** Mouse sensitivity; three's default is 1. */
  readonly pointerSpeed?: number;
  /** Eye height above the camera's ground position. Applied by `placeAt`. */
  readonly eyeHeight?: number;
}

/**
 * ```ts
 * const rig = new FirstPersonRig(three, { speed: 5 });
 * ui.addEventListener("click", () => rig.requestLock());   // a gesture is required
 * // in Scene.update(stepMs): rig.update(stepMs, { forward: keys.axisY, right: keys.axisX });
 * ```
 *
 * Gravity, collision and head bob are the game's: they are the design, not the plumbing.
 */
export class FirstPersonRig {
  readonly controls: PointerLockControls;
  readonly #speed: number;
  readonly #runMultiplier: number;
  readonly #eyeHeight: number;

  constructor(renderer: ThreeRenderer, options: FirstPersonRigOptions = {}) {
    this.controls = new PointerLockControls(renderer.camera, renderer.webgl.domElement);
    this.controls.pointerSpeed = options.pointerSpeed ?? 1;
    this.#speed = options.speed ?? 4;
    this.#runMultiplier = options.runMultiplier ?? 1.8;
    this.#eyeHeight = options.eyeHeight ?? 1.7;
  }

  /** True while the pointer is captured. Hide the "click to play" prompt on it. */
  get locked(): boolean {
    return this.controls.isLocked;
  }

  /** Ask for pointer lock. Browsers require a user gesture, so call it from a click or key. */
  requestLock(): void {
    this.controls.lock();
  }

  releaseLock(): void {
    this.controls.unlock();
  }

  /** Called on lock and unlock — pause the game, show the prompt. Returns the unsubscribe. */
  onLockChange(listener: (locked: boolean) => void): () => void {
    const onLock = (): void => listener(true);
    const onUnlock = (): void => listener(false);
    this.controls.addEventListener("lock", onLock);
    this.controls.addEventListener("unlock", onUnlock);
    return (): void => {
      this.controls.removeEventListener("lock", onLock);
      this.controls.removeEventListener("unlock", onUnlock);
    };
  }

  /** Put the camera at a ground position; eye height is added. Use on spawn and respawn. */
  placeAt(x: number, z: number, groundY = 0): void {
    this.controls.object.position.set(x, groundY + this.#eyeHeight, z);
  }

  /**
   * Move by one simulation step. Diagonal input is normalised, so walking at 45° is not
   * 1.41× faster than walking straight — the classic first-person bug.
   */
  update(stepMs: number, intent: MoveIntent): void {
    if (!this.controls.isLocked) return;
    const forward = clamp(intent.forward);
    const right = clamp(intent.right);
    const magnitude = Math.hypot(forward, right);
    if (magnitude === 0) return;
    const scale = Math.min(1, magnitude) / magnitude;
    const distance =
      ((intent.run ? this.#speed * this.#runMultiplier : this.#speed) * stepMs) / 1000;
    this.controls.moveForward(forward * scale * distance);
    this.controls.moveRight(right * scale * distance);
  }

  dispose(): void {
    this.controls.dispose();
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}
