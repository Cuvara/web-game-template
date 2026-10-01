// The 2D asset loader: manifest rules and the loading progress a portal counts.
//
// Progress is not cosmetic here. main.ts maps AssetLoader's fraction into
// platform.reportLoadingProgress, and tests/verify/facts.spec.ts asserts calls_loading_api
// from the number of those calls — so "ends at exactly 1" and "never goes backwards" are
// release facts, not polish.
//
// Everything runs against a fake AssetBackend: the arithmetic and the manifest rules are
// what this suite is about, and Pixi's own Assets needs a browser.

import { describe, expect, it } from "vitest";
import { AssetLoader, assetKind, type AssetBackend, type AssetManifest } from "@wgf/pixi-framework";

const MANIFEST: AssetManifest = {
  bundles: [
    {
      name: "boot",
      assets: [
        { alias: "hero", src: "assets/hero.png" },
        { alias: "tiles", src: "assets/tiles.json", kind: "spritesheet" },
      ],
    },
    {
      name: "level",
      assets: [
        { alias: "bg", src: "assets/bg.webp" },
        { alias: "fx", src: "assets/fx.png" },
        { alias: "waves", src: "assets/waves.json" },
        { alias: "font", src: "assets/font.json", kind: "bitmapFont" },
      ],
    },
  ],
};

interface FakeOptions {
  /** Bundle name that rejects instead of loading. */
  readonly failing?: string;
  /** Fractions each bundle reports before it finishes. */
  readonly steps?: readonly number[];
}

class FakeBackend implements AssetBackend {
  readonly loadedBundles: string[] = [];
  readonly unloadedBundles: string[] = [];
  initCalls = 0;
  basePath = "";

  readonly #options: FakeOptions;
  readonly #values = new Map<string, unknown>();

  constructor(options: FakeOptions = {}) {
    this.#options = options;
  }

  async init(manifest: AssetManifest, basePath: string): Promise<void> {
    this.initCalls += 1;
    this.basePath = basePath;
    for (const bundle of manifest.bundles) {
      for (const entry of bundle.assets) this.#values.set(entry.alias, `<${entry.alias}>`);
    }
  }

  async loadBundle(name: string, onProgress: (fraction: number) => void): Promise<void> {
    if (name === this.#options.failing) throw new Error("404 assets/hero.png");
    for (const step of this.#options.steps ?? [0.5]) onProgress(step);
    this.loadedBundles.push(name);
  }

  async unloadBundle(name: string): Promise<void> {
    this.unloadedBundles.push(name);
  }

  get(alias: string): unknown {
    return this.#values.get(alias);
  }
}

function recorder(): { fractions: number[]; onProgress: (fraction: number) => void } {
  const fractions: number[] = [];
  return { fractions, onProgress: (fraction) => fractions.push(fraction) };
}

describe("AssetLoader progress", () => {
  it("ends at exactly 1 and never goes backwards", async () => {
    const { fractions, onProgress } = recorder();
    const loader = new AssetLoader({
      manifest: MANIFEST,
      backend: new FakeBackend({ steps: [0.25, 0.5, 0.75] }),
      onProgress,
    });

    await loader.load("boot", "level");

    expect(fractions.at(-1)).toBe(1);
    expect(fractions.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
    // Strictly increasing: a repeated value is a call the portal counts for nothing.
    expect(new Set(fractions).size).toBe(fractions.length);
  });

  it("weights bundles by how many assets they hold", async () => {
    const { fractions, onProgress } = recorder();
    const loader = new AssetLoader({
      manifest: MANIFEST,
      backend: new FakeBackend({ steps: [] }),
      onProgress,
    });

    await loader.load("boot", "level");

    // boot is 2 of the 6 assets, so it completes a third of the way through — not half.
    expect(fractions[0]).toBeCloseTo(2 / 6, 10);
  });

  it("loads every bundle when none is named", async () => {
    const backend = new FakeBackend();
    const loader = new AssetLoader({ manifest: MANIFEST, backend });

    await loader.load();

    expect(backend.loadedBundles).toEqual(["boot", "level"]);
    expect(loader.loaded).toEqual(["boot", "level"]);
  });

  it("skips a bundle it already loaded but still reaches 1", async () => {
    const { fractions, onProgress } = recorder();
    const backend = new FakeBackend();
    const loader = new AssetLoader({ manifest: MANIFEST, backend, onProgress });

    await loader.load("boot");
    fractions.length = 0;
    await loader.load("boot", "level");

    expect(backend.loadedBundles).toEqual(["boot", "level"]);
    expect(fractions.at(-1)).toBe(1);
  });

  it("initialises the backend once, with the base path", async () => {
    const backend = new FakeBackend();
    const loader = new AssetLoader({ manifest: MANIFEST, backend, basePath: "cdn/" });

    await loader.load("boot");
    await loader.load("level");

    expect(backend.initCalls).toBe(1);
    expect(backend.basePath).toBe("cdn/");
  });
});

describe("AssetLoader failures", () => {
  it("names the bundle and keeps the original error, without claiming to be done", async () => {
    const { fractions, onProgress } = recorder();
    const loader = new AssetLoader({
      manifest: MANIFEST,
      backend: new FakeBackend({ failing: "level" }),
      onProgress,
    });

    await expect(loader.load("boot", "level")).rejects.toThrow(/asset bundle "level" failed/);
    await expect(loader.load("boot", "level")).rejects.toThrow(/bg, fx, waves, font/);
    expect(fractions).not.toContain(1);
    expect(loader.loaded).toEqual(["boot"]);
  });

  it("keeps the backend's own message, which holds the URL", async () => {
    const loader = new AssetLoader({
      manifest: MANIFEST,
      backend: new FakeBackend({ failing: "boot" }),
    });

    const error = await loader.load("boot").catch((caught: unknown) => caught);

    expect((error as Error).message).toContain("404 assets/hero.png");
  });

  it("names the bundles it does have when asked for one it does not", async () => {
    const loader = new AssetLoader({ manifest: MANIFEST, backend: new FakeBackend() });

    await expect(loader.load("levle")).rejects.toThrow(
      /asset bundle "levle" is not in the manifest \(have: boot, level\)/,
    );
  });
});

describe("AssetLoader manifest rules", () => {
  it("rejects an alias declared in two bundles", () => {
    const manifest: AssetManifest = {
      bundles: [
        { name: "a", assets: [{ alias: "hero", src: "a.png" }] },
        { name: "b", assets: [{ alias: "hero", src: "b.png" }] },
      ],
    };

    expect(() => new AssetLoader({ manifest, backend: new FakeBackend() })).toThrow(
      /alias "hero" is declared in both "a" and "b"/,
    );
  });

  it("rejects two bundles with the same name", () => {
    const manifest: AssetManifest = {
      bundles: [
        { name: "a", assets: [] },
        { name: "a", assets: [] },
      ],
    };

    expect(() => new AssetLoader({ manifest, backend: new FakeBackend() })).toThrow(
      /two bundles are named "a"/,
    );
  });

  it("rejects an asset with no src and one with no alias", () => {
    const noSrc: AssetManifest = { bundles: [{ name: "a", assets: [{ alias: "hero", src: "" }] }] };
    const noAlias: AssetManifest = {
      bundles: [{ name: "a", assets: [{ alias: "", src: "hero.png" }] }],
    };

    expect(() => new AssetLoader({ manifest: noSrc, backend: new FakeBackend() })).toThrow(
      /asset "hero" has no src/,
    );
    expect(() => new AssetLoader({ manifest: noAlias, backend: new FakeBackend() })).toThrow(
      /an asset in bundle "a" has no alias/,
    );
  });

  it("accepts the template's empty scaffold manifest", () => {
    expect(
      () => new AssetLoader({ manifest: { bundles: [] }, backend: new FakeBackend() }),
    ).not.toThrow();
  });
});

describe("AssetLoader lookup", () => {
  it("says which bundle to load when an asset is not loaded yet", async () => {
    const loader = new AssetLoader({ manifest: MANIFEST, backend: new FakeBackend() });

    expect(loader.has("fx")).toBe(false);
    expect(() => loader.get("fx")).toThrow(/await load\("level"\)/);
    expect(() => loader.get("nope")).toThrow(/asset "nope" is not in the manifest/);

    await loader.load("level");

    expect(loader.has("fx")).toBe(true);
    expect(loader.get("fx")).toBe("<fx>");
  });

  it("refuses texture() for an alias that is not an image", async () => {
    const loader = new AssetLoader({ manifest: MANIFEST, backend: new FakeBackend() });
    await loader.load("boot");

    expect(loader.texture("hero")).toBe("<hero>");
    expect(() => loader.texture("tiles")).toThrow(/declared as spritesheet, not a texture/);
  });

  it("forgets a bundle it unloaded", async () => {
    const backend = new FakeBackend();
    const loader = new AssetLoader({ manifest: MANIFEST, backend });
    await loader.load("boot");

    await loader.unload("boot");
    await loader.unload("boot"); // already gone: a no-op, not a second backend call

    expect(backend.unloadedBundles).toEqual(["boot"]);
    expect(loader.has("hero")).toBe(false);
  });
});

describe("assetKind", () => {
  it("prefers the declared kind and otherwise reads the extension", () => {
    expect(assetKind({ alias: "a", src: "a.json", kind: "spritesheet" })).toBe("spritesheet");
    expect(assetKind({ alias: "a", src: "a.png" })).toBe("texture");
    expect(assetKind({ alias: "a", src: "a.WEBP" })).toBe("texture");
    expect(assetKind({ alias: "a", src: "a.json?v=2" })).toBe("json");
    expect(assetKind({ alias: "a", src: "a.ogg" })).toBeUndefined();
  });
});
