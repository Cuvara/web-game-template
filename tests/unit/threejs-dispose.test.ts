// disposeObject3D: what the GPU keeps after a level is torn down.
//
// Runs in the node project: three's scene graph and resources need no WebGL context, and
// `dispose()` is a plain method on each of them.

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeObject3D } from "@wgf/three-framework";

describe("disposeObject3D", () => {
  it("disposes geometry, material and material textures under the root", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const root = new Group();
    const child = new Group();
    child.add(new Mesh(geometry, material));
    root.add(child);

    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    disposeObject3D(root);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a shared resource once, however many meshes use it", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));

    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    disposeObject3D(root);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("leaves kept resources alone — a clone must not free the asset cache", () => {
    const shared = new BoxGeometry(1, 1, 1);
    const own = new BoxGeometry(2, 2, 2);
    const root = new Group();
    root.add(
      new Mesh(shared, new MeshStandardMaterial()),
      new Mesh(own, new MeshStandardMaterial()),
    );

    const sharedDispose = vi.spyOn(shared, "dispose");
    const ownDispose = vi.spyOn(own, "dispose");

    disposeObject3D(root, { keep: [shared] });

    expect(sharedDispose).not.toHaveBeenCalled();
    expect(ownDispose).toHaveBeenCalledTimes(1);
  });

  it("detaches the root from its parent", () => {
    const scene = new Group();
    const level = new Group();
    scene.add(level);

    disposeObject3D(level);

    expect(level.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
  });
});
