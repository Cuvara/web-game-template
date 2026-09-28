// FollowCamera: the same motion for the same elapsed time, whatever the step size.

import { Object3D, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { FollowCamera } from "@wgf/three-framework";

function targetAt(x: number, y: number, z: number): Object3D {
  const object = new Object3D();
  object.position.set(x, y, z);
  object.updateMatrixWorld(true);
  return object;
}

describe("FollowCamera", () => {
  it("snaps to the offset behind the target", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(100, 100, 100);
    const follow = new FollowCamera(camera, { offset: [0, 3, -6], followRotation: false });
    follow.setTarget(targetAt(2, 0, 5));

    follow.snap();

    expect(camera.position.x).toBeCloseTo(2, 6);
    expect(camera.position.y).toBeCloseTo(3, 6);
    expect(camera.position.z).toBeCloseTo(-1, 6);
  });

  it("is frame-rate independent: 60 small steps land where 20 large ones do", () => {
    const build = (): { camera: PerspectiveCamera; follow: FollowCamera } => {
      const camera = new PerspectiveCamera();
      camera.position.set(0, 0, 50);
      const follow = new FollowCamera(camera, {
        offset: [0, 4, -8],
        followRotation: false,
        stiffness: 6,
      });
      follow.setTarget(targetAt(0, 0, 0));
      return { camera, follow };
    };

    const fast = build();
    for (let i = 0; i < 60; i += 1) fast.follow.update(1000 / 60);
    const slow = build();
    for (let i = 0; i < 20; i += 1) slow.follow.update(1000 / 20);

    expect(fast.camera.position.z).toBeCloseTo(slow.camera.position.z, 3);
    expect(fast.camera.position.y).toBeCloseTo(slow.camera.position.y, 3);
  });

  it("converges on the resting position and looks at the target", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 40);
    const follow = new FollowCamera(camera, { offset: [0, 5, -10], followRotation: false });
    follow.setTarget(targetAt(0, 0, 0));

    for (let i = 0; i < 300; i += 1) follow.update(1000 / 60);

    expect(camera.position.y).toBeCloseTo(5, 3);
    expect(camera.position.z).toBeCloseTo(-10, 3);
  });

  it("does nothing without a target", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(1, 2, 3);
    const follow = new FollowCamera(camera);

    follow.update(1000 / 60);
    follow.snap();

    expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(follow.target).toBeNull();
  });

  it("follows the target's rotation when asked", () => {
    const camera = new PerspectiveCamera();
    const target = targetAt(0, 0, 0);
    target.rotation.y = Math.PI / 2;
    target.updateMatrixWorld(true);
    const follow = new FollowCamera(camera, { offset: [0, 0, -10], followRotation: true });
    follow.setTarget(target);

    follow.snap();

    // Rotated a quarter turn about Y: the camera's local -Z offset is now world -X.
    expect(camera.position.x).toBeCloseTo(-10, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
  });
});
