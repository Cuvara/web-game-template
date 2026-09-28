// AnimationController: animation advanced by the loop's fixed step, not by a frame delta.

import { AnimationClip, Object3D, VectorKeyframeTrack } from "three";
import { describe, expect, it, vi } from "vitest";
import { AnimationController } from "@wgf/three-framework";

const STEP_MS = 1000 / 60;

/** A one-second clip that slides the object along x. Name it, since clips are played by name. */
function clip(name: string, durationSeconds = 1): AnimationClip {
  const track = new VectorKeyframeTrack(".position", [0, durationSeconds], [0, 0, 0, 1, 0, 0]);
  return new AnimationClip(name, durationSeconds, [track]);
}

describe("AnimationController", () => {
  it("advances the mixer by the fixed step, in seconds", () => {
    const controller = new AnimationController(new Object3D(), [clip("walk")]);
    controller.play("walk");

    for (let i = 0; i < 30; i += 1) controller.update(STEP_MS);

    expect(controller.mixer.time).toBeCloseTo(0.5, 3);
  });

  it("lists its clips and reports what is playing", () => {
    const controller = new AnimationController(new Object3D(), [clip("idle"), clip("run")]);
    expect(controller.names).toEqual(["idle", "run"]);
    expect(controller.playing).toBeNull();

    controller.play("idle");
    expect(controller.playing).toBe("idle");
  });

  it("refuses an unknown clip by name", () => {
    const controller = new AnimationController(new Object3D(), [clip("idle")]);
    expect(() => controller.play("sprint")).toThrow(/no clip named "sprint"/);
  });

  it("re-playing the running clip does not restart it", () => {
    const controller = new AnimationController(new Object3D(), [clip("run")]);
    const action = controller.play("run");
    for (let i = 0; i < 10; i += 1) controller.update(STEP_MS);
    const elapsed = action.time;

    expect(controller.play("run")).toBe(action);
    expect(action.time).toBeCloseTo(elapsed, 6);
  });

  it("crossfades: the outgoing clip loses weight as the incoming one gains it", () => {
    const controller = new AnimationController(new Object3D(), [clip("idle"), clip("run")]);
    const idle = controller.play("idle");
    controller.update(STEP_MS);
    const run = controller.play("run", { fadeMs: 200 });

    for (let i = 0; i < 6; i += 1) controller.update(STEP_MS);

    expect(run.getEffectiveWeight()).toBeGreaterThan(0);
    expect(idle.getEffectiveWeight()).toBeLessThan(1);
    expect(run.getEffectiveWeight() + idle.getEffectiveWeight()).toBeCloseTo(1, 3);
  });

  it("reports a one-shot clip finishing, once", () => {
    const controller = new AnimationController(new Object3D(), [clip("attack")]);
    const finished = vi.fn();
    controller.onFinished("attack", finished);
    controller.play("attack", { loop: false });

    for (let i = 0; i < 90; i += 1) controller.update(STEP_MS);

    expect(finished).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledWith("attack");
    expect(controller.playing).toBeNull();
  });

  it("unsubscribes a finish listener", () => {
    const controller = new AnimationController(new Object3D(), [clip("attack")]);
    const finished = vi.fn();
    controller.onFinished("attack", finished)();
    controller.play("attack", { loop: false });

    for (let i = 0; i < 90; i += 1) controller.update(STEP_MS);

    expect(finished).not.toHaveBeenCalled();
  });

  it("stops everything on dispose", () => {
    const controller = new AnimationController(new Object3D(), [clip("run")]);
    const action = controller.play("run");
    controller.dispose();

    expect(action.isRunning()).toBe(false);
    expect(controller.playing).toBeNull();
    expect(controller.names).toEqual([]);
  });
});
