// What the template's gameplay layer adds to the Factory's: the object-form bootPlatform
// that forwards every platform option, the registry-free default constructor, the moment
// record the probe exposes, and standing down from the foreground where bindPlatform owns it.

import { Game } from "@wgf/game-core";
import { GenericWebPlatform, type CreatePlatformOptions, type Platform } from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
import {
  PlatformGameplay,
  bootPlatform,
  createSdkFreePlatform,
  gameplay,
  installGameplay,
  type IntegrationPlan,
} from "../../../src/platform/gameplay.js";
import { INTEGRATION_PLAN } from "../../../src/platform/integration-plan.js";

const PLAN: IntegrationPlan = {
  titleId: "test-title",
  placements: [
    {
      id: "revive",
      kind: "rewarded",
      moment: "game-over",
      trigger: "On death",
      platforms: null,
    },
  ],
  adapterSubstitutes: { gamevui: "generic-web" },
  breakOnContinue: [],
};

function listening(): { platform: Platform; emit(event: string): void } {
  const platform = new GenericWebPlatform({ namespace: "test" });
  const listeners = new Map<string, Set<() => void>>();
  Object.defineProperty(platform, "on", {
    value: (event: string, handler: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    },
  });
  return { platform, emit: (event) => listeners.get(event)?.forEach((handler) => handler()) };
}

describe("bootPlatform", () => {
  it("forwards the full CreatePlatformOptions to the constructor", async () => {
    const seen: CreatePlatformOptions[] = [];
    const options: CreatePlatformOptions = {
      namespace: "ns",
      portalGameId: "abcdef123456",
      gamedistribution: { gameId: "0123456789abcdef0123456789abcdef" },
      y8: { appId: "app" },
    };
    await bootPlatform({
      target: "gamemonetize",
      options,
      plan: INTEGRATION_PLAN,
      create: (_id, received) => {
        seen.push(received);
        return new GenericWebPlatform({ namespace: received.namespace });
      },
    });
    expect(seen).toEqual([options]);
  });

  it("builds the SDK-free substitute without a create", async () => {
    const booted = await bootPlatform({
      target: "gamevui",
      options: { namespace: "ns" },
      plan: PLAN,
    });
    expect(booted.platform.id).toBe("generic-web");
    expect(booted.substitutedBy).toBe("generic-web");
  });

  it("fails loudly for a portal id with no create, instead of pulling in the registry", async () => {
    await expect(
      bootPlatform({ target: "poki", options: { namespace: "ns" }, plan: INTEGRATION_PLAN }),
    ).rejects.toThrow(/cannot construct "poki"/);
    expect(() => createSdkFreePlatform("yandex", { namespace: "ns" })).toThrow(/yandex/);
  });
});

describe("the template's default plan", () => {
  it("places nothing, so no offer is shown and no break is taken", async () => {
    const game = new Game();
    const platform = new GenericWebPlatform({ namespace: "test" });
    const subject = new PlatformGameplay(game, platform, INTEGRATION_PLAN, { target: "poki" });
    expect(INTEGRATION_PLAN.placements).toEqual([]);
    expect(subject.canOfferReward("game-over")).toBe(false);
    await subject.naturalBreak("game-over");
    expect(platform.usage.adsRequested.interstitial).toBe(0);
  });
});

describe("moment record", () => {
  it("records each hook with its moment, placement and time, as snapshots", async () => {
    let clock = 100;
    const game = new Game();
    const platform = new GenericWebPlatform({ namespace: "test" });
    const subject = new PlatformGameplay(game, platform, PLAN, {
      target: "yandex",
      now: () => clock++,
    });
    subject.runStarted();
    subject.gameOver();
    await subject.offerReward("game-over");
    await subject.naturalBreak(null);
    subject.pause();
    await subject.resume();

    const moments = subject.moments();
    expect(moments.map((m) => [m.name, m.moment, m.placement])).toEqual([
      ["run-start", null, null],
      ["game-over", "game-over", null],
      ["offer-reward", "game-over", "revive"],
      ["natural-break", null, null],
      ["pause", "pause-menu", null],
      ["resume", "pause-menu", null],
    ]);
    expect(moments.map((m) => m.atMs)).toEqual([100, 101, 102, 103, 104, 105]);

    (moments as unknown as { name: string }[])[0]!.name = "tampered";
    expect(subject.moments()[0]!.name).toBe("run-start");
  });
});

describe("followForeground", () => {
  it("pauses and mutes for the portal by default", () => {
    const game = new Game();
    const { platform, emit } = listening();
    const log: string[] = [];
    new PlatformGameplay(game, platform, PLAN, {
      target: "yandex",
      audio: { mute: () => log.push("mute"), unmute: () => log.push("unmute") },
    });
    emit("foreground:lost");
    expect(game.paused).toBe(true);
    emit("foreground:gained");
    expect(game.paused).toBe(false);
    expect(log).toEqual(["mute", "unmute"]);
  });

  it("stands down when bindPlatform owns the foreground", () => {
    const game = new Game();
    const { platform, emit } = listening();
    const log: string[] = [];
    new PlatformGameplay(game, platform, PLAN, {
      target: "yandex",
      audio: { mute: () => log.push("mute"), unmute: () => log.push("unmute") },
      followForeground: false,
    });
    emit("foreground:lost");
    expect(game.paused).toBe(false);
    expect(log).toEqual([]);
  });
});

describe("installGameplay", () => {
  it("makes the instance reachable through gameplay()", () => {
    const subject = new PlatformGameplay(
      new Game(),
      new GenericWebPlatform({ namespace: "test" }),
      PLAN,
      { target: "yandex" },
    );
    expect(installGameplay(subject)).toBe(subject);
    expect(gameplay()).toBe(subject);
  });
});
