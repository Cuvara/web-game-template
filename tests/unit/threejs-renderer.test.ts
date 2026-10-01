// The parts of the Three.js renderer binding that need no WebGL context: the pixel-ratio
// cap (re-applied on every resize, so a window moved to another screen redraws at the new
// ratio) and the narrowing every 3D game does on context.renderer.

import type { Renderer } from "@wgf/game-core";
import { describe, expect, it } from "vitest";
import { ThreeRenderer, asThreeRenderer, pixelRatioFor } from "@wgf/three-framework";

describe("pixelRatioFor", () => {
  it("caps the device ratio", () => {
    expect(pixelRatioFor(3, 2)).toBe(2);
    expect(pixelRatioFor(1.5, 2)).toBe(1.5);
    expect(pixelRatioFor(1, 2)).toBe(1);
  });

  it("falls back to 1 for a missing or nonsense ratio", () => {
    expect(pixelRatioFor(Number.NaN, 2)).toBe(1);
    expect(pixelRatioFor(0, 2)).toBe(1);
    expect(pixelRatioFor(-2, 2)).toBe(1);
    expect(pixelRatioFor(2, 0)).toBe(1);
  });
});

describe("asThreeRenderer", () => {
  it("returns a Three.js renderer", () => {
    const renderer = new ThreeRenderer();
    expect(asThreeRenderer(renderer)).toBe(renderer);
  });

  it("names the config when the build is for the other engine", () => {
    const pixi = { kind: "pixijs" } as unknown as Renderer;
    expect(() => asThreeRenderer(pixi)).toThrow(/engine.type in game.config.yaml/);
  });
});

describe("ThreeRenderer before init", () => {
  it("says so rather than failing on a null", () => {
    const renderer = new ThreeRenderer();
    expect(renderer.kind).toBe("threejs");
    expect(renderer.contextLost).toBe(false);
    expect(() => renderer.camera).toThrow(/init\(\) has not completed/);
    expect(() => renderer.webgl).toThrow(/init\(\) has not completed/);
  });
});
