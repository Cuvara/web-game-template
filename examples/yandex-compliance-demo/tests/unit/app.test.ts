// The demo's flow against the REAL Yandex adapter and a fake SDK — no browser.
//
// This is the integration the compliance report leans on: the app decides when gameplay
// runs, when sound may play and when an ad is allowed; the adapter turns those decisions
// into SDK calls. Asserting on the SDK call log proves the pair together.

import { describe, expect, it, vi } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import {
  MemoryStorageBackend,
  YandexPlatform,
  YandexStorage,
  type YandexAdCallbacks,
  type YandexRewardedCallbacks,
  type YandexSdk,
} from "@wgf/platform-sdk";
import { App, SAVE_BEST, type InputPort, type SoundPort, type UiPort } from "../../src/app.js";
import type { Screen } from "../../src/ui.js";

type Ad = (callbacks: YandexRewardedCallbacks, fire: (event: string) => void) => void;

function harness(
  options: { fullscreen?: Ad; rewarded?: Ad; foregroundLost?: boolean; adTimeoutMs?: number } = {},
) {
  const log: string[] = [];
  const listeners = new Map<string, Array<() => void>>();
  const fire = (event: string): void => listeners.get(event)?.forEach((listener) => listener());
  const store: Record<string, unknown> = {};
  const showAd: Ad = (callbacks, emit) => {
    emit("game_api_pause");
    callbacks.onOpen?.();
    callbacks.onRewarded?.();
    callbacks.onClose?.(true);
    emit("game_api_resume");
  };

  const sdk: YandexSdk = {
    environment: { app: { id: "t" }, i18n: { lang: "ru" } },
    features: {
      LoadingAPI: { ready: () => log.push("ready") },
      GameplayAPI: { start: () => log.push("start"), stop: () => log.push("stop") },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }: { callbacks: YandexAdCallbacks }) => {
        log.push("fullscreen");
        (options.fullscreen ?? showAd)(callbacks, fire);
      },
      showRewardedVideo: ({ callbacks }: { callbacks: YandexRewardedCallbacks }) => {
        log.push("rewarded");
        (options.rewarded ?? showAd)(callbacks, fire);
      },
    },
    EVENTS: {
      ACCOUNT_SELECTION_DIALOG_OPENED: "ACCOUNT_SELECTION_DIALOG_OPENED",
      ACCOUNT_SELECTION_DIALOG_CLOSED: "ACCOUNT_SELECTION_DIALOG_CLOSED",
    },
    getPlayer: async () => ({
      isAuthorized: () => false,
      getData: async () => ({ ...store }),
      setData: async (data: Record<string, unknown>) => {
        log.push(`setData:${JSON.stringify(data)}`);
        Object.assign(store, data);
      },
    }),
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    off: () => undefined,
  };

  let now = 0;
  const platform = new YandexPlatform({
    namespace: "t",
    loadSdk: async () => ({
      init: async () => {
        if (options.foregroundLost) setTimeout(() => fire("game_api_pause"), 0);
        return sdk;
      },
    }),
    now: () => now,
    ...(options.adTimeoutMs ? { adOpenTimeoutMs: options.adTimeoutMs } : {}),
    storage: new YandexStorage({ namespace: "t", local: new MemoryStorageBackend() }),
  });

  const screens: Screen[] = [];
  const ui: UiPort = {
    show: (screen) => screens.push(screen),
    setScore: () => undefined,
    setBest: () => undefined,
    setSound: () => undefined,
    setOver: () => undefined,
    setNote: vi.fn(),
    setBusy: () => undefined,
  };
  const audio = { allowed: false, enabled: true };
  const sound: SoundPort = {
    get enabled() {
      return audio.enabled;
    },
    unlock: () => undefined,
    setEnabled: (enabled) => (audio.enabled = enabled),
    setAllowed: (allowed) => (audio.allowed = allowed),
    setPad: () => undefined,
    play: () => undefined,
  };
  let steer = { targetX: 0 as number | null, axis: 0 as -1 | 0 | 1 };
  const input: InputPort = { read: () => steer, reset: () => undefined };

  const scheduler = new ManualScheduler();
  const game = new Game({ scheduler });
  const app = new App({
    game,
    platform,
    ui,
    sound,
    input,
    view: { draw: () => undefined },
    t: (key) => key,
    random: () => 0.99,
  });

  return {
    app,
    game,
    platform,
    scheduler,
    log,
    fire,
    store,
    audio,
    ui,
    screen: () => screens.at(-1),
    steer: (next: typeof steer) => (steer = next),
    advanceClock: (ms: number) => (now += ms),
    async boot() {
      await platform.initialize();
      await app.load();
      await game.changeScene(app);
      game.start();
      await platform.signalReady();
    },
    runUntil(done: () => boolean, maxFrames = 3_000) {
      for (let i = 0; i < maxFrames && !done(); i++) scheduler.advance(1000 / 60);
    },
  };
}

const markup = (log: string[]) => log.filter((entry) => entry === "start" || entry === "stop");

describe("demo flow on Yandex", () => {
  it("boot: ready once, no gameplay, no ads, menu on screen", async () => {
    const h = harness();
    await h.boot();
    expect(h.log).toEqual(["ready"]);
    expect(h.screen()).toBe("menu");
    expect(h.platform.language).toBe("ru");
  });

  it("play -> pause -> resume -> game over: GameplayAPI follows exactly", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    expect(h.audio.allowed).toBe(true);
    h.app.togglePause();
    expect(h.screen()).toBe("paused");
    expect(h.audio.allowed).toBe(false);
    h.app.togglePause();
    h.runUntil(() => h.app.phase === "over");
    await vi.waitFor(() => expect(h.screen()).toBe("over"));
    expect(markup(h.log)).toEqual(["start", "stop", "start", "stop"]);
  });

  it("saves the record the moment a run ends (1.9)", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.steer({ targetX: 1, axis: 0 });
    h.runUntil(() => (h.app.run?.score ?? 0) > 0);
    h.steer({ targetX: 0, axis: 0 });
    h.runUntil(() => h.app.phase === "over");
    await vi.waitFor(() => expect(h.store[SAVE_BEST]).toBe("1"));
    expect(h.app.best).toBe(1);
  });

  it("a hidden tab stops gameplay and sound, and returning waits for the player", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.app.visibility(false);
    expect(h.game.paused).toBe(true);
    expect(h.audio.allowed).toBe(false);
    expect(h.log.at(-1)).toBe("stop");
    h.app.visibility(true);
    expect(h.screen()).toBe("paused");
    expect(h.log.at(-1)).toBe("stop");
    h.app.resume();
    expect(h.log.at(-1)).toBe("start");
    expect(h.audio.allowed).toBe(true);
  });

  it("losing window focus mutes and pauses a run (1.3)", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.app.focus(false);
    expect(h.audio.allowed).toBe(false);
    expect(h.screen()).toBe("paused");
    h.app.focus(true);
    h.app.resume();
    expect(h.audio.allowed).toBe(true);
  });

  it("the portal's game_api_pause mid-run pauses and holds for the player", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.fire("game_api_pause");
    expect(h.game.paused).toBe(true);
    expect(h.audio.allowed).toBe(false);
    h.fire("game_api_resume");
    expect(h.screen()).toBe("paused");
    expect(h.game.paused).toBe(true);
    h.app.resume();
    expect(h.game.paused).toBe(false);
  });

  it("a launch ad already up at load holds the game until resume", async () => {
    const h = harness({ foregroundLost: true });
    await h.platform.initialize();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.app.load();
    expect(h.game.paused).toBe(true);
    expect(h.audio.allowed).toBe(false);
    h.fire("game_api_resume");
    expect(h.game.paused).toBe(false);
  });

  it("interstitial only on 'play again', gameplay stopped and sound off while it shows", async () => {
    let during: { paused: boolean; allowed: boolean; markup: string[] } | null = null;
    const h = harness({
      fullscreen: (callbacks, fire) => {
        fire("game_api_pause");
        callbacks.onOpen?.();
        during = { paused: h.game.paused, allowed: h.audio.allowed, markup: markup(h.log) };
        callbacks.onClose?.(true);
        fire("game_api_resume");
      },
    });
    await h.boot();
    h.app.play();
    h.runUntil(() => h.app.phase === "over");
    expect(h.log).not.toContain("fullscreen");
    await h.app.again();
    expect(during).toEqual({ paused: true, allowed: false, markup: ["start", "stop"] });
    expect(h.app.phase).toBe("playing");
    expect(markup(h.log)).toEqual(["start", "stop", "start"]);
    expect(h.game.paused).toBe(false);
  });

  it("a second 'play again' inside the interval skips the ad and still plays", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.runUntil(() => h.app.phase === "over");
    await h.app.again();
    h.runUntil(() => h.app.phase === "over");
    const result = await h.app.again();
    expect(result).toEqual({ shown: false, reason: "too-soon" });
    expect(h.log.filter((entry) => entry === "fullscreen")).toHaveLength(1);
    expect(h.app.phase).toBe("playing");
  });

  it("rewarded continue: one life on onRewarded, then never again this run", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.runUntil(() => h.app.phase === "over");
    expect(await h.app.revive()).toBe(true);
    expect(h.app.phase).toBe("playing");
    expect(h.app.run?.lives).toBe(1);
    h.runUntil(() => h.app.phase === "over");
    expect(await h.app.revive()).toBe(false);
    expect(h.log.filter((entry) => entry === "rewarded")).toHaveLength(1);
  });

  it("no reward without onRewarded; the player is told and may play on", async () => {
    const h = harness({
      rewarded: (callbacks) => {
        callbacks.onOpen?.();
        callbacks.onClose?.(true);
      },
    });
    await h.boot();
    h.app.play();
    h.runUntil(() => h.app.phase === "over");
    expect(await h.app.revive()).toBe(false);
    expect(h.app.phase).toBe("over");
    expect(h.ui.setNote).toHaveBeenLastCalledWith("over.noReward");
    await h.app.again();
    expect(h.app.phase).toBe("playing");
  });

  it("a rewarded video that opens late still grants the continue", async () => {
    const h = harness({
      adTimeoutMs: 10,
      rewarded: (callbacks, fire) => {
        setTimeout(() => {
          fire("game_api_pause");
          callbacks.onOpen?.();
          callbacks.onRewarded?.();
          callbacks.onClose?.(true);
          fire("game_api_resume");
        }, 50);
      },
    });
    await h.boot();
    h.app.play();
    h.runUntil(() => h.app.phase === "over");
    expect(await h.app.revive()).toBe(false);
    expect(h.ui.setNote).toHaveBeenLastCalledWith("over.adUnavailable");
    await vi.waitFor(() => expect(h.app.phase).toBe("playing"));
    expect(h.app.run?.lives).toBe(1);
  });

  it("a different progress track chosen in the portal returns to the menu with its saves", async () => {
    const h = harness();
    await h.boot();
    h.app.play();
    h.fire("ACCOUNT_SELECTION_DIALOG_OPENED");
    h.store[SAVE_BEST] = "123";
    h.store["__wgf_rev__"] = Date.now() + 60_000;
    h.fire("ACCOUNT_SELECTION_DIALOG_CLOSED");
    await vi.waitFor(() => expect(h.app.phase).toBe("menu"));
    expect(h.app.best).toBe(123);
  });
});
