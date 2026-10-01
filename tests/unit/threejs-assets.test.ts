// ThreeAssets: caching, progress and disposal. The loaders are injected, so nothing here
// touches the network or a WebGL context.

import { BoxGeometry, Group, LoadingManager, Mesh, MeshStandardMaterial, Texture } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { ThreeAssets } from "@wgf/three-framework";

function fakeGltf(): GLTF {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: new Texture() })));
  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: {},
    parser: {},
    userData: {},
  } as unknown as GLTF;
}

describe("ThreeAssets", () => {
  it("loads a model once and hands the same promise back", async () => {
    const loadGltf = vi.fn(() => Promise.resolve(fakeGltf()));
    const assets = new ThreeAssets({ loadGltf });

    const first = assets.loadGltf("hero.glb");
    const second = assets.loadGltf("hero.glb");

    expect(await first).toBe(await second);
    expect(loadGltf).toHaveBeenCalledTimes(1);
  });

  it("prefixes relative urls with basePath and leaves absolute ones alone", async () => {
    const loadGltf = vi.fn(() => Promise.resolve(fakeGltf()));
    const assets = new ThreeAssets({ basePath: "./assets/models", loadGltf });

    await assets.loadGltf("hero.glb");
    await assets.loadGltf("https://cdn.example/other.glb");

    expect(loadGltf.mock.calls.map((call) => (call as unknown as string[])[0])).toEqual([
      "./assets/models/hero.glb",
      "https://cdn.example/other.glb",
    ]);
  });

  it("routes a batch by extension", async () => {
    const loadGltf = vi.fn(() => Promise.resolve(fakeGltf()));
    const loadTexture = vi.fn(() => Promise.resolve(new Texture()));
    const assets = new ThreeAssets({ loadGltf, loadTexture });

    await assets.loadAll(["level.glb", "sky.png"]);

    expect(loadGltf).toHaveBeenCalledTimes(1);
    expect(loadTexture).toHaveBeenCalledTimes(1);
  });

  it("reports progress in [0,1], never decreasing, ending at 1", async () => {
    const manager = new LoadingManager();
    const seen: number[] = [];
    const assets = new ThreeAssets({
      manager,
      onProgress: (fraction) => seen.push(fraction),
      loadGltf: () => Promise.resolve(fakeGltf()),
    });

    manager.itemStart("a");
    manager.itemStart("b");
    manager.itemEnd("a");
    manager.itemEnd("b");
    // A second batch reports fewer items than the first; the bar must not walk backwards.
    manager.itemStart("c");
    manager.itemEnd("c");

    expect(seen.length).toBeGreaterThan(0);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    await assets.loadGltf("unused.glb");
  });

  it("tracks and then frees what a model put on the GPU", async () => {
    const gltf = fakeGltf();
    const assets = new ThreeAssets({ loadGltf: () => Promise.resolve(gltf) });
    await assets.loadGltf("hero.glb");

    const tracked = [...assets.resources];
    expect(tracked).toHaveLength(3); // geometry, material, its texture
    const spies = tracked.map((resource) => vi.spyOn(resource, "dispose"));

    assets.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect([...assets.resources]).toHaveLength(0);
  });

  it("instantiates a copy that shares the cached geometry", async () => {
    const gltf = fakeGltf();
    const assets = new ThreeAssets({ loadGltf: () => Promise.resolve(gltf) });

    const copy = await assets.instantiate("hero.glb");

    expect(copy).not.toBe(gltf.scene);
    const source = gltf.scene.children[0] as Mesh;
    const clone = copy.children[0] as Mesh;
    expect(clone.geometry).toBe(source.geometry);
  });
});
