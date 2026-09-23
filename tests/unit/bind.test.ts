// bindPlatform: the template's wiring between platform signals and the game's pause and
// audio state. Runs under Node with a minimal document stand-in.

import { Game } from "@wgf/game-core";
import { PlatformEmitter, type Platform, type PlatformEvents } from "@wgf/platform-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindPlatform } from "../../src/platform/bind.js";

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  setVisibility(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function fakePlatform(options: { stopOnHidden: boolean; muteAudio?: boolean }) {
  const events = new PlatformEmitter();
  const calls: string[] = [];
  const platform = {
    capabilities: { gameplayStopOnHidden: options.stopOnHidden },
    settings: { muteAudio: options.muteAudio ?? false },
    on: events.on.bind(events),
    gameplayStart: () => calls.push("start"),
    gameplayStop: () => calls.push("stop"),
  } as unknown as Platform;
  const emit = <K extends keyof PlatformEvents>(type: K, payload: PlatformEvents[K]) =>
    events.emit(type, payload);
  return { platform, calls, emit };
}

let doc: FakeDocument;
beforeEach(() => {
  doc = new FakeDocument();
  vi.stubGlobal("document", doc);
});
afterEach(() => vi.unstubAllGlobals());

describe("bindPlatform", () => {
  it("reports focus loss only where the portal asks for it", () => {
    for (const stopOnHidden of [true, false]) {
      const game = new Game();
      const { platform, calls } = fakePlatform({ stopOnHidden });
      const binding = bindPlatform(game, platform);
      doc.setVisibility("hidden");
      expect(game.paused).toBe(true);
      doc.setVisibility("visible");
      expect(game.paused).toBe(false);
      expect(calls).toEqual(stopOnHidden ? ["stop", "start"] : []);
      binding.dispose();
    }
  });

  it("mutes for the portal setting and for a playing ad, and an ad ending keeps the setting", () => {
    const game = new Game();
    const { platform, emit } = fakePlatform({ stopOnHidden: false, muteAudio: true });
    const changes: boolean[] = [];
    const binding = bindPlatform(game, platform, { onAudioMutedChange: (m) => changes.push(m) });
    expect(binding.audioMuted).toBe(true);

    emit("ad:start", { kind: "interstitial" });
    emit("ad:end", { kind: "interstitial" });
    expect(binding.audioMuted).toBe(true);

    emit("settings:change", { muteAudio: false });
    expect(binding.audioMuted).toBe(false);
    emit("ad:start", { kind: "rewarded" });
    expect(binding.audioMuted).toBe(true);
    expect(game.paused).toBe(true);
    emit("ad:end", { kind: "rewarded" });
    expect(binding.audioMuted).toBe(false);
    expect(game.paused).toBe(false);
    expect(changes).toEqual([true, false, true, false]);
    binding.dispose();
  });

  it("reports a break for an ad that lands on live gameplay, and nothing extra inside one", () => {
    const game = new Game();
    const { platform, calls, emit } = fakePlatform({ stopOnHidden: false });
    bindPlatform(game, platform);

    // Late ad over live play: stop, then start again.
    emit("ad:start", { kind: "interstitial" });
    emit("ad:end", { kind: "interstitial" });
    expect(calls).toEqual(["stop", "start"]);

    // Ad inside a break the game already holds: the binding adds no reports of its own.
    calls.length = 0;
    game.pause("manual");
    emit("ad:start", { kind: "interstitial" });
    emit("ad:end", { kind: "interstitial" });
    expect(calls).toEqual([]);
    expect(game.paused).toBe(true);
  });

  it("keeps the game paused after an ad while the tab is still hidden", () => {
    const game = new Game();
    const { platform, emit } = fakePlatform({ stopOnHidden: false });
    bindPlatform(game, platform);
    emit("ad:start", { kind: "interstitial" });
    doc.setVisibility("hidden");
    emit("ad:end", { kind: "interstitial" });
    expect(game.paused).toBe(true);
    doc.setVisibility("visible");
    expect(game.paused).toBe(false);
  });
});
