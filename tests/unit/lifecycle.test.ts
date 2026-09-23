import { describe, expect, it } from "vitest";
import { GameplayLifecycle } from "@wgf/platform-sdk";

// The sequences are Poki's, from https://developers.poki.com/guide/sdk-overview.

describe("GameplayLifecycle", () => {
  it("allows startup: gameLoadingFinished -> gameplayStart", () => {
    const lifecycle = new GameplayLifecycle();
    expect(lifecycle.loadingFinished()).toBe(true);
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.playing).toBe(true);
    expect(lifecycle.rejected).toEqual([]);
  });

  it("refuses gameplayStart before gameLoadingFinished", () => {
    const lifecycle = new GameplayLifecycle();
    expect(lifecycle.start()).toBe(false);
    expect(lifecycle.rejected).toEqual([
      { call: "gameplayStart", reason: "before-loading-finished" },
    ]);
  });

  it("sends gameLoadingFinished only once", () => {
    const lifecycle = new GameplayLifecycle();
    expect(lifecycle.loadingFinished()).toBe(true);
    expect(lifecycle.loadingFinished()).toBe(false);
  });

  it("never lets the same gameplay event fire twice in a row", () => {
    const lifecycle = new GameplayLifecycle();
    lifecycle.loadingFinished();
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.start()).toBe(false);
    expect(lifecycle.stop()).toBe(true);
    expect(lifecycle.stop()).toBe(false);
    expect(lifecycle.rejected.map((r) => r.reason)).toEqual(["duplicate", "not-playing"]);
  });

  it("allows death/restart: gameplayStop -> commercialBreak -> gameplayStart", () => {
    const lifecycle = new GameplayLifecycle();
    lifecycle.loadingFinished();
    lifecycle.start();
    expect(lifecycle.stop()).toBe(true);
    expect(lifecycle.beginAd("commercialBreak")).toEqual({ allowed: true, stopFirst: false });
    lifecycle.endAd();
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.rejected).toEqual([]);
  });

  it("stops running gameplay before an ad that interrupts it", () => {
    const lifecycle = new GameplayLifecycle();
    lifecycle.loadingFinished();
    lifecycle.start();
    expect(lifecycle.beginAd("rewardedBreak")).toEqual({ allowed: true, stopFirst: true });
    expect(lifecycle.playing).toBe(false);
  });

  it("refuses every gameplay event and a second break during an ad", () => {
    const lifecycle = new GameplayLifecycle();
    lifecycle.loadingFinished();
    lifecycle.beginAd("commercialBreak");
    expect(lifecycle.start()).toBe(false);
    expect(lifecycle.stop()).toBe(false);
    expect(lifecycle.beginAd("rewardedBreak").allowed).toBe(false);
    expect(lifecycle.rejected.every((r) => r.reason === "during-ad")).toBe(true);
    lifecycle.endAd();
    expect(lifecycle.start()).toBe(true);
  });

  it("reports rejections to the callback", () => {
    const seen: string[] = [];
    const lifecycle = new GameplayLifecycle((r) => seen.push(`${r.call}:${r.reason}`));
    lifecycle.stop();
    expect(seen).toEqual(["gameplayStop:not-playing"]);
  });
});
