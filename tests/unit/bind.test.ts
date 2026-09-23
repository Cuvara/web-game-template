import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import {
  GenericWebPlatform,
  MemoryStorageBackend,
  PlatformEmitter,
  PokiPlatform,
  type Platform,
  type PlatformEvents,
  type PokiSdk,
} from "@wgf/platform-sdk";
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

// Portal-driven audio and ad holds — CrazyGames' muteAudio setting, ads that land on live
// play, and portals that ask not to be told about focus loss.

function fakePlatform(options: { stopOnHidden?: boolean; muteAudio?: boolean }) {
  const events = new PlatformEmitter();
  const calls: string[] = [];
  let active = false;
  const platform = {
    capabilities: {
      ads: [],
      ...(options.stopOnHidden === undefined ? {} : { gameplayStopOnHidden: options.stopOnHidden }),
    },
    settings: { muteAudio: options.muteAudio ?? false },
    foreground: true,
    on: events.on.bind(events),
    get gameplayActive() {
      return active;
    },
    gameplayStart: () => {
      active = true;
      calls.push("start");
    },
    gameplayStop: () => {
      active = false;
      calls.push("stop");
    },
  } as unknown as Platform;
  const emit = <K extends keyof PlatformEvents>(type: K, payload: PlatformEvents[K]) =>
    events.emit(type, payload);
  return { platform, calls, emit };
}

describe("bindPlatform — portal audio, late ads, focus-loss reporting", () => {
  it("does not report focus loss where the portal handles it, but still pauses", () => {
    const game = new Game({ scheduler: new ManualScheduler() });
    const { platform, calls } = fakePlatform({ stopOnHidden: false });
    platform.gameplayStart();
    calls.length = 0;
    bindPlatform(game, platform);
    setVisibility("hidden");
    expect(game.paused).toBe(true);
    setVisibility("visible");
    expect(game.paused).toBe(false);
    expect(calls).toEqual([]);
  });

  it("mutes for the portal setting and for a playing ad; an ad ending keeps the setting", () => {
    const game = new Game({ scheduler: new ManualScheduler() });
    const { platform, emit } = fakePlatform({ muteAudio: true });
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
  });

  it("reports a break for an ad that lands on live play, and nothing extra inside one", async () => {
    const game = new Game({ scheduler: new ManualScheduler() });
    const { platform, calls, emit } = fakePlatform({});
    platform.gameplayStart();
    calls.length = 0;
    bindPlatform(game, platform);

    emit("ad:start", { kind: "interstitial" });
    emit("ad:end", { kind: "interstitial" });
    expect(calls).toEqual(["stop", "start"]);

    // Inside a break: withAdBreak has already stopped gameplay and paused the game, so the
    // binding reports nothing of its own; withAdBreak restarts gameplay afterwards.
    calls.length = 0;
    await withAdBreak(game, platform, async () => {
      emit("ad:start", { kind: "interstitial" });
      emit("ad:end", { kind: "interstitial" });
    });
    expect(calls).toEqual(["stop", "start"]);
    expect(game.paused).toBe(false);
  });
});

describe("bindPlatform — the portal holding the foreground", () => {
  // A platform that raises foreground signals on demand, the way Yandex relays
  // game_api_pause/resume. Everything else is the generic-web adapter's.
  //
  // The watchdog cases need to model a portal whose reported `foreground` and whose emitted
  // events can diverge: a dropped foreground:gained (the game paused forever bug) is exactly
  // "the portal says it is back on top, but never told us". So `lose`/`gain` move the flag
  // AND emit, while `setForeground` moves only the flag — the portal's own current answer,
  // which is all the watchdog is allowed to trust. Timers are fired by hand, the same manual
  // pattern the SDK tests use, so no test waits on the 5s recovery clock.
  function portal(startInForeground = true) {
    const emitter = new PlatformEmitter();
    let foreground = startInForeground;
    const platform = new GenericWebPlatform({ namespace: "t" });
    Object.defineProperty(platform, "on", { value: emitter.on.bind(emitter) });
    Object.defineProperty(platform, "foreground", { get: () => foreground });
    const set = (next: boolean, emit = true): void => {
      foreground = next;
      if (emit) emitter.emit(next ? "foreground:gained" : "foreground:lost", undefined);
    };
    const pending: Array<() => void> = [];
    const timers = {
      setTimeout: (handler: () => void) => {
        pending.push(handler);
        return pending.length; // a non-undefined handle
      },
      clearTimeout: () => {},
      fireAll: () => pending.splice(0).forEach((run) => run()),
    };
    return {
      platform,
      emit: emitter.emit.bind(emitter),
      timers,
      lose: () => set(false),
      gain: () => set(true),
      // Move only the portal's reported foreground, without emitting — models a dropped event.
      setForeground: (next: boolean) => set(next, false),
    };
  }

  it("pauses the game while the portal is on top, and resumes it after", () => {
    const { platform, lose, gain } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform);
    lose();
    expect(game.paused).toBe(true);
    gain();
    expect(game.paused).toBe(false);
  });

  it("honours a foreground the portal took before binding (the launch ad)", () => {
    const { platform, gain } = portal(false);
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform);
    expect(game.paused).toBe(true);
    gain();
    expect(game.paused).toBe(false);
  });

  it("does not lift a pause that belongs to someone else", () => {
    const { platform, lose, gain } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform);
    game.pause("manual");
    lose();
    gain();
    expect(game.paused).toBe(true);
  });

  it("stops listening once disposed", () => {
    const { platform, lose } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform).dispose();
    lose();
    expect(game.paused).toBe(false);
  });

  it("recovers a lost foreground on gained, before the watchdog is needed", () => {
    const { platform, timers, lose, gain } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform, timers);
    lose();
    expect(game.paused).toBe(true);
    gain();
    expect(game.paused).toBe(false);
    // A genuine gained must have retired the watchdog: firing it now does nothing unsafe.
    timers.fireAll();
    expect(game.paused).toBe(false);
  });

  it("stays paused when the watchdog fires and the portal is still on top", () => {
    // gained never arrives (a dropped event); the portal still reports itself in front.
    const { platform, timers, lose } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform, timers);
    lose();
    expect(game.paused).toBe(true);
    timers.fireAll();
    // The foreground really is gone, so the watchdog must not lift the pause.
    expect(game.paused).toBe(true);
  });

  it("recovers via the watchdog when gained is dropped but the portal is back", () => {
    const { platform, timers, lose, setForeground } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform, timers);
    lose();
    expect(game.paused).toBe(true);
    // The portal is back on top but the gained event never fired — the stranding bug.
    setForeground(true);
    timers.fireAll();
    expect(game.paused).toBe(false);
  });

  it("does not resume via the watchdog while an ad still holds the foreground", () => {
    // A portal ad: foreground:lost, then ad:start, and the portal reports itself back
    // (foreground true) before ad:end — but the ad is still on screen. The watchdog firing
    // here must not resume: the "ad" hold, not just the flag, is what keeps the game paused.
    const { platform, timers, emit, lose, setForeground } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform, timers);
    lose();
    emit("ad:start", { kind: "interstitial" });
    expect(game.paused).toBe(true);
    setForeground(true); // portal handed the flag back early, still mid-ad
    timers.fireAll();
    expect(game.paused).toBe(true); // ad still holds it; watchdog declines and re-arms
    emit("ad:end", { kind: "interstitial" });
    // The dropped foreground:gained still leaves "platform" held after the ad; the re-armed
    // watchdog is the escape, and now that no ad holds the screen it may recover.
    timers.fireAll();
    expect(game.paused).toBe(false);
  });

  it("keeps the game paused when one reason lifts but another still holds", () => {
    // Multi-reason: an ad pause and a hidden-tab pause together. Resuming the ad alone must
    // not resume the game; only when the tab is visible again does the last reason clear.
    const { platform, timers, emit } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    bindPlatform(game, platform, timers);
    emit("ad:start", { kind: "interstitial" });
    setVisibility("hidden");
    expect(game.paused).toBe(true);
    emit("ad:end", { kind: "interstitial" });
    expect(game.paused).toBe(true); // hidden still holds
    setVisibility("visible");
    expect(game.paused).toBe(false);
  });

  it("leaves no dangling ad pause when foreground is lost mid-withAdBreak", async () => {
    // A withAdBreak body owns the "ad" reason; a real portal ad races in around it,
    // emitting foreground:lost then ad:end + foreground:gained. The adapter's own handlers
    // must stand down while the break owns "ad", so the break's finally is the single writer
    // that clears it — no dangling pause, and gameplay starts exactly once.
    const { platform, timers, emit, lose, gain } = portal();
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    const starts: string[] = [];
    game.events.on("resumed", () => starts.push("resumed"));
    bindPlatform(game, platform, timers);
    let finish: () => void = () => {};
    const breaking = withAdBreak(game, platform, () => new Promise<void>((r) => (finish = r)), {
      resumeGameplay: false,
    });
    emit("ad:start", { kind: "interstitial" });
    lose();
    expect(game.paused).toBe(true);
    gain(); // portal hands the foreground back
    emit("ad:end", { kind: "interstitial" }); // adapter's own end: must not touch "ad"
    finish();
    await breaking;
    // Every reason is released exactly once; no lingering "ad" or "platform" pause.
    expect(game.paused).toBe(false);
    // Firing the watchdog now must be a no-op — a genuine gained already retired it.
    timers.fireAll();
    expect(game.paused).toBe(false);
    // Resumed fired once (the single transition out of paused), not twice from a double-drive.
    expect(starts).toEqual(["resumed"]);
  });
});
