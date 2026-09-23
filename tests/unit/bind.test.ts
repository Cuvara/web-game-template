import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import { MemoryStorageBackend, PokiPlatform, type PokiSdk } from "@wgf/platform-sdk";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";

// bind.ts runs in the browser. Under node it needs only somewhere to add listeners and a
// visibility state, so plain EventTargets stand in for window and document.

let visibility: "visible" | "hidden" = "visible";

beforeEach(() => {
  visibility = "visible";
  const doc = new EventTarget();
  Object.defineProperty(doc, "visibilityState", { get: () => visibility });
  Object.assign(globalThis, { window: new EventTarget(), document: doc });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

function recordingSdk(): { sdk: PokiSdk; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sdk: {
      init: () => Promise.resolve(),
      gameLoadingFinished: () => void calls.push("gameLoadingFinished"),
      gameplayStart: () => void calls.push("gameplayStart"),
      gameplayStop: () => void calls.push("gameplayStop"),
      commercialBreak: () => (calls.push("commercialBreak"), Promise.resolve()),
      rewardedBreak: () => (calls.push("rewardedBreak"), Promise.resolve(true)),
    },
  };
}

async function setup() {
  const { sdk, calls } = recordingSdk();
  const platform = new PokiPlatform({
    namespace: "t",
    storage: new MemoryStorageBackend(),
    loadSdk: () => Promise.resolve(sdk),
  });
  await platform.initialize();
  await platform.signalReady();
  const game = new Game({ scheduler: new ManualScheduler() });
  game.start();
  const binding = bindPlatform(game, platform);
  return { game, platform, calls, binding };
}

const input = (): boolean => window.dispatchEvent(new Event("pointerdown"));
const setVisibility = (state: "visible" | "hidden"): void => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("bindPlatform", () => {
  it("reports gameplayStart on the first input, not before, and only once", async () => {
    const { calls, binding } = await setup();
    binding.armFirstInput();
    expect(calls).toEqual(["gameLoadingFinished"]);
    input();
    input();
    expect(calls).toEqual(["gameLoadingFinished", "gameplayStart"]);
  });

  it("keeps waiting when the first input lands while the game is paused", async () => {
    const { game, calls, binding } = await setup();
    binding.armFirstInput();
    game.pause("ad");
    input();
    expect(calls).not.toContain("gameplayStart");
    game.resume("ad");
    input();
    expect(calls).toEqual(["gameLoadingFinished", "gameplayStart"]);
  });

  it("stops and restarts gameplay around a hidden tab", async () => {
    const { calls, binding } = await setup();
    binding.armFirstInput();
    input();
    setVisibility("hidden");
    setVisibility("visible");
    expect(calls.slice(1)).toEqual(["gameplayStart", "gameplayStop", "gameplayStart"]);
  });

  it("does not report gameplay on return to a tab that was never playing", async () => {
    const { calls } = await setup();
    setVisibility("hidden");
    setVisibility("visible");
    expect(calls).toEqual(["gameLoadingFinished"]);
  });
});

describe("withAdBreak", () => {
  it("brackets a break that interrupts gameplay: stop, break, start", async () => {
    const { game, platform, calls } = await setup();
    platform.gameplayStart();
    await withAdBreak(game, platform, () => platform.showInterstitial());
    expect(calls.slice(1)).toEqual([
      "gameplayStart",
      "gameplayStop",
      "commercialBreak",
      "gameplayStart",
    ]);
    expect(game.paused).toBe(false);
  });

  it("adds no gameplay events around an ad watched from a menu", async () => {
    const { game, platform, calls } = await setup();
    await withAdBreak(game, platform, () => platform.showRewarded());
    expect(calls.slice(1)).toEqual(["rewardedBreak"]);
  });

  it("starts gameplay after a break when the player heads back in", async () => {
    const { game, platform, calls } = await setup();
    await withAdBreak(game, platform, () => platform.showInterstitial(), { resumeGameplay: true });
    expect(calls.slice(1)).toEqual(["commercialBreak", "gameplayStart"]);
  });

  it("restarts gameplay when the tab comes back, if it went hidden during the break", async () => {
    const { game, platform, calls } = await setup();
    platform.gameplayStart();
    let finish: () => void = () => {};
    const breaking = withAdBreak(game, platform, () => new Promise<void>((r) => (finish = r)));
    setVisibility("hidden");
    finish();
    await breaking;
    expect(platform.gameplayActive).toBe(false);
    setVisibility("visible");
    expect(calls.at(-1)).toBe("gameplayStart");
    expect(platform.gameplayActive).toBe(true);
  });

  it("does not carry an owed resume past the game's own pause handling", async () => {
    const { game, platform, calls } = await setup();
    platform.gameplayStart();
    await withAdBreak(game, platform, async () => {
      game.pause("manual");
      return platform.showInterstitial();
    });
    game.resume("manual");
    platform.gameplayStart();
    platform.gameplayStop(); // back on a menu
    const before = calls.length;
    setVisibility("hidden");
    setVisibility("visible");
    expect(calls.slice(before)).toEqual([]);
  });

  it("mutes for the whole break and pauses the game", async () => {
    const { game, platform } = await setup();
    const events: string[] = [];
    await withAdBreak(
      game,
      platform,
      async () => {
        events.push(`body paused=${game.paused}`);
        return platform.showInterstitial();
      },
      { mute: () => events.push("mute"), unmute: () => events.push("unmute") },
    );
    expect(events).toEqual(["mute", "body paused=true", "unmute"]);
  });
});

describe("bindPlatform and the portal's foreground", () => {
  it("pauses the game while the portal holds the foreground, and only then", async () => {
    const { game, platform } = await setup();
    const paused: boolean[] = [];
    // Registered after the binding, so it sees the state the binding left.
    platform.on("foreground:lost", () => void paused.push(game.paused));
    // An ad break through the adapter takes the foreground (Poki: before the break).
    await platform.showInterstitial();
    expect(paused).toEqual([true]);
    expect(game.paused).toBe(false);
  });

  it("starts paused when the portal already held the foreground at bind time", () => {
    const listeners = new Map<string, () => void>();
    const platform = {
      foreground: false,
      gameplayActive: false,
      on: (event: string, handler: () => void) => {
        listeners.set(event, handler);
        return () => listeners.delete(event);
      },
    } as unknown as Parameters<typeof bindPlatform>[1];
    const game = new Game({ scheduler: new ManualScheduler() });
    const binding = bindPlatform(game, platform);
    expect(game.paused).toBe(true);
    listeners.get("foreground:gained")?.();
    expect(game.paused).toBe(false);
    binding.dispose();
    expect(listeners.size).toBe(0);
  });
});
