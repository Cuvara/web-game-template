import { describe, expect, it } from "vitest";
import {
  GenericWebPlatform,
  KNOWN_PLATFORM_IDS,
  MemoryStorageBackend,
  createPlatform,
  isPlatformId,
} from "@wgf/platform-sdk";

describe("platform registry", () => {
  it("builds the generic-web platform", () => {
    const platform = createPlatform("generic-web", { namespace: "test" });
    expect(platform.id).toBe("generic-web");
    expect(platform.capabilities.ads).toEqual([]);
  });

  it("has an adapter for every id that has a profile", () => {
    for (const id of KNOWN_PLATFORM_IDS) {
      expect(createPlatform(id, { namespace: "test" }).id).toBe(id);
    }
  });

  it("fails loudly for an id with no profile at all", () => {
    expect(() => createPlatform("newgrounds", { namespace: "test" })).toThrow(/Unknown platform/);
  });

  it("recognises exactly the ids that have profiles", () => {
    for (const id of KNOWN_PLATFORM_IDS) expect(isPlatformId(id)).toBe(true);
    expect(isPlatformId("newgrounds")).toBe(false);
  });
});

describe("GenericWebPlatform", () => {
  it("reports loading progress clamped to [0, 1]", async () => {
    const platform = new GenericWebPlatform({ namespace: "test" });
    await platform.initialize();

    platform.reportLoadingProgress(-1);
    expect(platform.loadingFraction).toBe(0);
    platform.reportLoadingProgress(2);
    expect(platform.loadingFraction).toBe(1);

    platform.reportLoadingProgress(0.5);
    await platform.signalReady();
    expect(platform.ready).toBe(true);
    expect(platform.loadingFraction).toBe(1);
  });

  it("declines ads rather than throwing, because it has no portal", async () => {
    const platform = new GenericWebPlatform({ namespace: "test" });
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "unsupported",
    });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "unsupported",
    });
  });

  it("falls back to memory when localStorage is unavailable", async () => {
    // Node has no localStorage; the backend must degrade rather than throw.
    const platform = new GenericWebPlatform({ namespace: "test" });
    await platform.storage.set("save", "{}");
    await expect(platform.storage.get("save")).resolves.toBe("{}");
    await platform.storage.remove("save");
    await expect(platform.storage.get("save")).resolves.toBeNull();
  });
});

describe("MemoryStorageBackend", () => {
  it("round-trips and forgets", async () => {
    const storage = new MemoryStorageBackend();
    await expect(storage.get("missing")).resolves.toBeNull();
    await storage.set("k", "v");
    await expect(storage.get("k")).resolves.toBe("v");
    await storage.remove("k");
    await expect(storage.get("k")).resolves.toBeNull();
  });
});
