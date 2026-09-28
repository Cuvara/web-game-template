// The GLB path, against three's real GLTFLoader.
//
// The other asset tests inject a fake loader to check caching and progress; this one parses an
// actual GLB container, so a change to how ThreeAssets tracks and frees what a model loaded is
// checked against a model three itself produced. A GLB needs no network and no DOM: its buffer
// travels in the binary chunk, so GLTFLoader never reaches for FileLoader.

import { Mesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { ThreeAssets, disposeObject3D } from "@wgf/three-framework";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** A one-triangle GLB, built here so the suite needs no binary fixture in the repository. */
function minimalGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };

  // Every chunk is padded to four bytes: JSON with spaces, binary with zeroes.
  const pad = (data: Buffer, filler: number): Buffer =>
    Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4, filler)]);
  const chunk = (data: Buffer, type: number): Buffer => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(data.length, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, data]);
  };

  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const glb = Buffer.concat([header, chunk(jsonChunk, CHUNK_JSON), chunk(binChunk, CHUNK_BIN)]);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length) as ArrayBuffer;
}

/** ThreeAssets wired to the real loader, parsing bytes instead of fetching them. */
function assetsOverGlb(): ThreeAssets {
  const glb = minimalGlb();
  return new ThreeAssets({
    loadGltf: (_url, manager) => new GLTFLoader(manager).parseAsync(glb, ""),
  });
}

describe("ThreeAssets over a real GLB", () => {
  it("loads the model three parsed and tracks its geometry", async () => {
    const assets = assetsOverGlb();

    const gltf = await assets.loadGltf("triangle.glb");
    const mesh = gltf.scene.children[0] as Mesh;

    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect([...assets.resources]).toContain(mesh.geometry);
  });

  it("instantiates copies that share the parsed geometry", async () => {
    const assets = assetsOverGlb();

    const first = (await assets.instantiate("triangle.glb")).children[0] as Mesh;
    const second = (await assets.instantiate("triangle.glb")).children[0] as Mesh;

    expect(first).not.toBe(second);
    expect(first.geometry).toBe(second.geometry);
  });

  it("frees the geometry on dispose, and a torn-down copy leaves the cache alone", async () => {
    const assets = assetsOverGlb();
    const gltf = await assets.loadGltf("triangle.glb");
    const geometry = (gltf.scene.children[0] as Mesh).geometry;
    const dispose = vi.spyOn(geometry, "dispose");

    const copy = await assets.instantiate("triangle.glb");
    disposeObject3D(copy, { keep: assets.resources });
    expect(dispose).not.toHaveBeenCalled();

    assets.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
