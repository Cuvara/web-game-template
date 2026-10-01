// Skeletal and keyframe animation, driven by the loop's fixed step.
//
// `AnimationMixer.update` takes seconds, and the obvious thing to hand it — the delta between
// two render frames — makes every animation run at a speed that depends on the frame rate.
// The template's loop already guarantees a fixed step (packages/game-core/src/loop.ts), so
// this takes milliseconds and is called from `Scene.update(stepMs)`, never from `render`.

import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";

export interface PlayOptions {
  /** Crossfade from whatever is playing, in milliseconds. 0 cuts. */
  readonly fadeMs?: number;
  /** Loop forever (the default) or play once. */
  readonly loop?: boolean;
  /** Hold the last frame when a one-shot ends instead of snapping back. */
  readonly clampWhenFinished?: boolean;
  /** Playback rate; 1 is the clip's authored speed. */
  readonly timeScale?: number;
}

/**
 * The animations of one model. Build it from a loaded GLTF:
 *
 * ```ts
 * const gltf = await assets.loadGltf("hero.glb");
 * const animation = new AnimationController(gltf.scene, gltf.animations);
 * animation.play("idle");
 * // in Scene.update(stepMs): animation.update(stepMs);
 * ```
 */
export class AnimationController {
  readonly mixer: AnimationMixer;
  readonly #clips = new Map<string, AnimationClip>();
  readonly #actions = new Map<string, AnimationAction>();
  readonly #finished = new Map<string, Set<(name: string) => void>>();
  #current: AnimationAction | null = null;
  #currentName: string | null = null;

  constructor(root: Object3D, clips: readonly AnimationClip[]) {
    this.mixer = new AnimationMixer(root);
    for (const clip of clips) this.#clips.set(clip.name, clip);
    this.mixer.addEventListener("finished", this.#onFinished);
  }

  /** The clip names this model shipped with. */
  get names(): readonly string[] {
    return [...this.#clips.keys()];
  }

  /** The clip currently playing, or null. */
  get playing(): string | null {
    return this.#currentName;
  }

  /**
   * Play a clip, crossfading from the current one. Playing the clip that is already playing
   * is a no-op, so calling this every step from a state machine is fine.
   */
  play(name: string, options: PlayOptions = {}): AnimationAction {
    const clip = this.#clips.get(name);
    if (!clip) throw new Error(`AnimationController: no clip named "${name}"`);
    const action = this.#actions.get(name) ?? this.mixer.clipAction(clip);
    this.#actions.set(name, action);
    if (this.#current === action && action.isRunning()) return action;

    const loop = options.loop ?? true;
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = options.clampWhenFinished ?? !loop;
    action.timeScale = options.timeScale ?? 1;
    action.reset();
    action.enabled = true;

    const fadeSeconds = (options.fadeMs ?? 0) / 1000;
    if (this.#current && fadeSeconds > 0) {
      action.crossFadeFrom(this.#current, fadeSeconds, false).play();
    } else {
      this.#current?.stop();
      action.play();
    }
    this.#current = action;
    this.#currentName = name;
    return action;
  }

  /** Advance by one simulation step. Call from `Scene.update(stepMs)`. */
  update(stepMs: number): void {
    this.mixer.update(stepMs / 1000);
  }

  /** Stop everything. The model holds its last pose. */
  stop(): void {
    this.mixer.stopAllAction();
    this.#current = null;
    this.#currentName = null;
  }

  /** Called when a one-shot clip ends. Returns the unsubscribe. */
  onFinished(name: string, listener: (name: string) => void): () => void {
    const listeners = this.#finished.get(name) ?? new Set<(name: string) => void>();
    listeners.add(listener);
    this.#finished.set(name, listeners);
    return (): void => {
      listeners.delete(listener);
    };
  }

  /** Release the mixer's cached actions. The model itself is the caller's to dispose. */
  dispose(): void {
    this.mixer.removeEventListener("finished", this.#onFinished);
    this.mixer.stopAllAction();
    for (const clip of this.#clips.values()) this.mixer.uncacheClip(clip);
    this.#actions.clear();
    this.#finished.clear();
    this.#clips.clear();
    this.#current = null;
    this.#currentName = null;
  }

  // Bound field, not a method: it is added and removed as the same listener reference.
  readonly #onFinished = (event: { action: AnimationAction }): void => {
    const name = event.action.getClip().name;
    if (this.#currentName === name) {
      this.#current = null;
      this.#currentName = null;
    }
    for (const listener of this.#finished.get(name) ?? []) listener(name);
  };
}
