// GameMonetize adapter: configuration, SDK boot, ads, and the portal holding the screen —
// every branch against the deterministic mock in tests/gamemonetize/mock-sdk.ts, with timers
// the test advances by hand.

import { resolve } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import {
  GAMEMONETIZE_CAPABILITIES,
  GameMonetizePlatform,
  MemoryStorageBackend,
  createPlatform,
  gameMonetizeGameIdProblem,
  type GameMonetizeOptions,
  type Platform,
} from "@wgf/platform-sdk";
import { loadGameConfig } from "../../scripts/build/game-config-plugin.js";
import { validateGameConfig } from "../../src/core/game-config.js";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import {
  createGameMonetizeMock,
  type GameMonetizeMockOptions,
  type GmAdScript,
  type GmSdkMode,
} from "../gamemonetize/mock-sdk.js";

// A placeholder shaped like a real one. Never a real Game ID.
const GAME_ID = "test0000000000000000000000000000";

class ManualTimers {
  now = 0;
  #next = 1;
  readonly #pending = new Map<number, { at: number; run: () => void }>();
  setTimeout = (run: () => void, ms: number): unknown => {
    const id = this.#next++;
    this.#pending.set(id, { at: this.now + ms, run });
    return id;
  };
  clearTimeout = (handle: unknown): void => void this.#pending.delete(handle as number);
  get pending(): number {
    return this.#pending.size;
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.#pending]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#pending.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
    }
    this.now = until;
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

interface Setup {
  platform: GameMonetizePlatform;
  mock: ReturnType<typeof createGameMonetizeMock>;
  timers: ManualTimers;
  events: string[];
}

function setup(
  options: {
    sdk?: GmSdkMode;
    ad?: GmAdScript;
    gameId?: string | null;
  } & Partial<Omit<GameMonetizeMockOptions, "timers">> &
    Partial<GameMonetizeOptions> = {},
): Setup {
  const timers = new ManualTimers();
  const mock = createGameMonetizeMock({ ...options, timers });
  const platform = new GameMonetizePlatform({
    namespace: "gm-test",
    gameId: options.gameId === undefined ? GAME_ID : options.gameId,
    loadSdk: mock.loadSdk,
    timers,
    storage: new MemoryStorageBackend(),
    ...(options.initTimeoutMs !== undefined ? { initTimeoutMs: options.initTimeoutMs } : {}),
  });
  const events: string[] = [];
  for (const event of ["ad:start", "ad:end", "foreground:lost", "foreground:gained"] as const) {
    platform.on(event, () => events.push(event));
  }
  return { platform, mock, timers, events };
}

async function booted(options: Parameters<typeof setup>[0] = {}): Promise<Setup> {
  const s = setup(options);
  await s.platform.initialize();
  await s.platform.signalReady();
  return s;
}

const AD_PAIR = ["foreground:lost", "ad:start", "ad:end", "foreground:gained"];

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

describe("GameMonetize configuration", () => {
  it("declares only what GameMonetize documents", () => {
    expect(GAMEMONETIZE_CAPABILITIES).toMatchObject({
      ads: ["interstitial"],
      iap: false,
      cloudSaves: false,
      auth: "none",
      loadingApi: "none",
      interstitialMinIntervalS: null,
    });
  });

  it.each([
    [undefined, "missing"],
    [null, "missing"],
    ["", "missing"],
    ["your_game_id_here", "the documented placeholder"],
    ["YOUR_GAME_ID_HERE", "the documented placeholder"],
    ["short", "not 8-64 letters, digits, '-' or '_'"],
    ["has spaces in it", "not 8-64 letters, digits, '-' or '_'"],
    ["<script>alert(1)</script>", "not 8-64 letters, digits, '-' or '_'"],
    [12345678, "not a string"],
  ])("refuses the Game ID %j (%s)", (gameId, why) => {
    expect(gameMonetizeGameIdProblem(gameId)).toBe(why);
  });

  it("accepts a token-shaped Game ID", () => {
    expect(gameMonetizeGameIdProblem(GAME_ID)).toBeNull();
  });

  it.each([undefined, "your_game_id_here", "bad id"])(
    "without a usable Game ID (%j) never loads the SDK and plays on without ads",
    async (gameId) => {
      const { platform, mock } = await booted({ gameId: gameId ?? null });
      expect(mock.calls).toEqual([]);
      expect(platform.sdkState).toBe("not-configured");
      expect(platform.configProblem).not.toBeNull();
      expect(platform.adAvailability("interstitial")).toBe("disabled");
      await expect(platform.showInterstitial()).resolves.toEqual({
        shown: false,
        reason: "not-ready",
      });
      platform.gameplayStart();
      expect(platform.gameplayActive).toBe(true);
      await platform.storage.set("k", "v");
      await expect(platform.storage.get("k")).resolves.toBe("v");
    },
  );

  it("createPlatform passes the portal Game ID through", () => {
    const configured = createPlatform("gamemonetize", { namespace: "t", portalGameId: GAME_ID });
    expect(configured).toBeInstanceOf(GameMonetizePlatform);
    expect((configured as GameMonetizePlatform).configProblem).toBeNull();
    const missing = createPlatform("gamemonetize", { namespace: "t" });
    expect((missing as GameMonetizePlatform).configProblem).toBe("missing");
  });

  const config = (entry: Record<string, unknown>) => ({
    game: { id: "g", name: "G", version: "0.1.0" },
    engine: { type: "pixijs" },
    platforms: [{ profile: `${String(entry["id"])}@1.0.0`, role: "required", ...entry }],
    monetization: { ad_kinds: ["interstitial"], iap: false },
    build: { command: "pnpm build", output: "dist" },
    verification: {},
    publishing: { enabled: false },
  });

  it("game.config.yaml accepts game_id on gamemonetize and nowhere else", () => {
    expect(() =>
      validateGameConfig(config({ id: "gamemonetize", game_id: GAME_ID })),
    ).not.toThrow();
    expect(() => validateGameConfig(config({ id: "gamemonetize" }))).not.toThrow();
    expect(() => validateGameConfig(config({ id: "poki", game_id: GAME_ID }))).toThrow(/only read/);
  });

  it.each(["your_game_id_here", "bad id", "x", 42])(
    "game.config.yaml refuses the malformed game_id %j, as the adapter does",
    (gameId) => {
      expect(() => validateGameConfig(config({ id: "gamemonetize", game_id: gameId }))).toThrow(
        /game_id/,
      );
      expect(gameMonetizeGameIdProblem(gameId)).not.toBeNull();
    },
  );

  it("WGF_GAMEMONETIZE_GAME_ID supplies or overrides the Game ID at build time, validated", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "gm-config-"));
    const path = resolve(dir, "game.config.yaml");
    writeFileSync(path, JSON.stringify(config({ id: "gamemonetize" })));
    expect(loadGameConfig(path, {}).platforms[0]!.game_id).toBeUndefined();
    expect(loadGameConfig(path, { WGF_GAMEMONETIZE_GAME_ID: GAME_ID }).platforms[0]!.game_id).toBe(
      GAME_ID,
    );
    expect(() => loadGameConfig(path, { WGF_GAMEMONETIZE_GAME_ID: "bad id" })).toThrow(/game_id/);
  });
});

describe("GameMonetize SDK boot", () => {
  it("hands the documented SDK_OPTIONS over once, with autoplay off, and becomes ready", async () => {
    const { platform, mock } = setup();
    await Promise.all([platform.initialize(), platform.initialize()]);
    expect(mock.calls).toEqual(["load"]);
    expect(mock.received()).toMatchObject({
      gameId: GAME_ID,
      advertisementSettings: { autoplay: false },
    });
    expect(platform.sdkState).toBe("ready");
    expect(platform.adAvailability("interstitial")).toBe("available");
    expect(platform.adAvailability("rewarded")).toBe("unsupported");
    expect(platform.adAvailability("banner")).toBe("unsupported");
  });

  it("waits for a delayed SDK_READY within the init deadline", async () => {
    const { platform, timers } = setup({ sdk: "delayed", readyDelayMs: 2_000 });
    let done = false;
    void platform.initialize().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    timers.advance(2_000);
    await flush();
    expect(done).toBe(true);
    expect(platform.sdkState).toBe("ready");
  });

  it("boots without ads when SDK_READY misses the deadline, and recovers when it arrives", async () => {
    const { platform, timers } = setup({ sdk: "delayed", readyDelayMs: 8_000 });
    const init = platform.initialize();
    await flush();
    timers.advance(5_000);
    await init;
    expect(platform.sdkState).toBe("unavailable");
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    timers.advance(3_000);
    expect(platform.sdkState).toBe("ready");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it.each(["missing", "loader-throws"] as const)(
    "SDK %s: unavailable, never throws",
    async (sdk) => {
      const { platform } = await booted({ sdk });
      expect(platform.sdkState).toBe("unavailable");
      expect(platform.adAvailability("interstitial")).toBe("disabled");
      await expect(platform.showInterstitial()).resolves.toEqual({
        shown: false,
        reason: "not-ready",
      });
    },
  );

  it("SDK that loads but never becomes ready: the deadline boots the game", async () => {
    const { platform, timers } = setup({ sdk: "silent" });
    const init = platform.initialize();
    await flush();
    timers.advance(5_000);
    await init;
    expect(platform.sdkState).toBe("unavailable");
  });

  it("SDK_ERROR at init: ads refused as error, and a later SDK_READY recovers", async () => {
    const { platform, mock } = await booted({ sdk: "init-error" });
    expect(platform.sdkState).toBe("error");
    expect(platform.adAvailability("interstitial")).toBe("disabled");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    expect(mock.calls).not.toContain("showBanner");
    mock.emit("SDK_READY");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("without a browser the default loader resolves no SDK", async () => {
    delete (globalThis as { document?: unknown }).document;
    const platform = new GameMonetizePlatform({
      namespace: "t",
      gameId: GAME_ID,
      storage: new MemoryStorageBackend(),
    });
    await platform.initialize();
    expect(platform.sdkState).toBe("unavailable");
  });

  describe("the default script loader", () => {
    interface FakeScript {
      id?: string;
      src?: string;
      async?: boolean;
      onload?: () => void;
      onerror?: () => void;
    }
    function fakeDom(existing: { script?: boolean; sdk?: boolean } = {}) {
      const inserted: FakeScript[] = [];
      const win: Record<string, unknown> = {};
      if (existing.sdk) win["sdk"] = { showBanner: () => undefined };
      Object.assign(globalThis, {
        window: win,
        document: {
          getElementById: (id: string) =>
            existing.script && id === "gamemonetize-sdk" ? { id } : null,
          createElement: () => ({}) as FakeScript,
          getElementsByTagName: () => [],
          head: { appendChild: (script: FakeScript) => inserted.push(script) },
        },
      });
      return { inserted, win };
    }
    const platformWithDefaultLoader = (timers: ManualTimers) =>
      new GameMonetizePlatform({
        namespace: "t",
        gameId: GAME_ID,
        timers,
        storage: new MemoryStorageBackend(),
      });

    it("sets SDK_OPTIONS before inserting the documented script once, then follows its events", async () => {
      const { inserted, win } = fakeDom();
      const timers = new ManualTimers();
      const platform = platformWithDefaultLoader(timers);
      const init = platform.initialize();
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        id: "gamemonetize-sdk",
        src: "https://api.gamemonetize.com/sdk.js",
      });
      const options = win["SDK_OPTIONS"] as { gameId: string; onEvent(e: { name: string }): void };
      expect(options.gameId).toBe(GAME_ID);
      // The SDK runs: it defines window.sdk, loads, and reports ready through onEvent.
      win["sdk"] = { showBanner: () => options.onEvent({ name: "SDK_GAME_START" }) };
      inserted[0]!.onload!();
      options.onEvent({ name: "SDK_READY" });
      await init;
      expect(platform.sdkState).toBe("ready");
      await expect(platform.showInterstitial()).resolves.toEqual({
        shown: false,
        reason: "not-ready",
      });
    });

    it("a blocked script leaves the SDK unavailable at once", async () => {
      const { inserted } = fakeDom();
      const platform = platformWithDefaultLoader(new ManualTimers());
      const init = platform.initialize();
      inserted[0]!.onerror!();
      await init;
      expect(platform.sdkState).toBe("unavailable");
    });

    it.each([
      ["a script tag someone else inserted", { script: true }],
      ["an SDK already running", { sdk: true }],
    ])("refuses %s without waiting or touching its SDK_OPTIONS", async (_, existing) => {
      const { inserted, win } = fakeDom(existing);
      win["SDK_OPTIONS"] = { gameId: "theirs" };
      const platform = platformWithDefaultLoader(new ManualTimers());
      await platform.initialize(); // resolves without the init deadline firing
      expect(platform.sdkState).toBe("unavailable");
      expect(inserted).toEqual([]);
      expect(win["SDK_OPTIONS"]).toEqual({ gameId: "theirs" });
    });
  });

  it("ignores events GameMonetize does not document", async () => {
    const { platform, mock, events } = await booted();
    mock.emit("SDK_GAME_DATA_READY");
    mock.emit("AD_SDK_MANAGER_READY");
    expect(events).toEqual([]);
    expect(platform.foreground).toBe(true);
  });
});

describe("GameMonetize interstitial", () => {
  it("plays: onStart once, one balanced ad bracket, counted once", async () => {
    const { platform, mock, events } = await booted();
    let starts = 0;
    let foregroundDuringAd: boolean | null = null;
    const result = await platform.showInterstitial({
      onStart: () => {
        starts += 1;
        foregroundDuringAd = platform.foreground;
      },
    });
    expect(result).toEqual({ shown: true });
    expect(starts).toBe(1);
    expect(foregroundDuringAd).toBe(false);
    expect(mock.calls).toEqual(["load", "showBanner"]);
    expect(events).toEqual(AD_PAIR);
    expect(platform.foreground).toBe(true);
    expect(platform.usage.adsRequested.interstitial).toBe(1);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("plays when the SDK answers asynchronously", async () => {
    const { platform, events } = await booted({ ad: "async-play" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(events).toEqual(AD_PAIR);
  });

  it("ad unavailable: SDK_GAME_START without a pause resolves unshown, no bracket", async () => {
    const { platform, events } = await booted({ ad: "no-fill" });
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(events).toEqual([]);
    expect(platform.usage.adsShown.interstitial).toBe(0);
  });

  // The live SDK reports a failed ad by cancelling it, which raises SDK_GAME_START.
  it("ad error before it showed (SDK_GAME_START alone): unshown, nothing held", async () => {
    const { platform, events } = await booted({ ad: "ad-error" });
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(events).toEqual([]);
    expect(platform.foreground).toBe(true);
  });

  it("ad error while on screen: the bracket closes on SDK_GAME_START", async () => {
    const { platform, events } = await booted({ ad: "ad-error-after-start" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(events).toEqual(AD_PAIR);
  });

  it("SDK_ERROR during a request (allowed by the docs) ends it as error; the trailing SDK_GAME_START is ignored", async () => {
    const { platform, events } = await booted({ ad: "sdk-error" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    expect(events).toEqual([]);
    expect(platform.foreground).toBe(true);
    expect(platform.sdkState).toBe("ready");
  });

  it("SDK_ERROR while an ad is on screen: the bracket still closes on SDK_GAME_START", async () => {
    const { platform, events } = await booted({ ad: "sdk-error-after-start" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(events).toEqual(AD_PAIR);
  });

  it("a call the SDK refuses as too soon after the last ad resolves unshown; later ones play", async () => {
    const timers = new ManualTimers();
    const mock = createGameMonetizeMock({ timers, cooldownMs: 30_000, now: () => timers.now });
    const platform = new GameMonetizePlatform({
      namespace: "gm-test",
      gameId: GAME_ID,
      loadSdk: mock.loadSdk,
      timers,
      storage: new MemoryStorageBackend(),
    });
    const events: string[] = [];
    platform.on("ad:start", () => events.push("ad:start"));
    await platform.initialize();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(mock.calls).toContain("too-soon");
    expect(events).toEqual(["ad:start"]);
    timers.advance(30_000);
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(events).toEqual(["ad:start", "ad:start"]);
  });

  it("showBanner throwing resolves as error, and the next request still works", async () => {
    const { platform, mock } = await booted({ ad: "throw" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    mock.setAd("play");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("callback never arrives: the start deadline resolves unshown and frees the slot", async () => {
    const { platform, mock, timers, events } = await booted({ ad: "silent" });
    const first = platform.showInterstitial();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    // The default outlasts the SDK's own 12s + 8s cancel, so its answer normally comes first.
    let settled = false;
    void first.then(() => (settled = true));
    timers.advance(24_999);
    await flush();
    expect(settled).toBe(false);
    timers.advance(1);
    await expect(first).resolves.toEqual({ shown: false, reason: "not-ready" });
    expect(events).toEqual([]);
    expect(timers.pending).toBe(0);
    mock.setAd("play");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("pause without resume: the ad deadline gives the foreground back exactly once", async () => {
    const { platform, mock, timers, events } = await booted({ ad: "stall" });
    const request = platform.showInterstitial();
    expect(platform.foreground).toBe(false);
    timers.advance(59_999);
    expect(platform.foreground).toBe(false);
    timers.advance(1);
    await expect(request).resolves.toEqual({ shown: true });
    expect(events).toEqual(AD_PAIR);
    // The SDK_GAME_START that finally turns up is late and changes nothing.
    mock.emit("SDK_GAME_START");
    expect(events).toEqual(AD_PAIR);
    expect(platform.foreground).toBe(true);
  });

  it("duplicate callbacks: one resolution, one bracket", async () => {
    const { platform, mock, events } = await booted({ ad: "duplicate" });
    const results = [await platform.showInterstitial()];
    expect(results).toEqual([{ shown: true }]);
    expect(events).toEqual(AD_PAIR);
    mock.emit("SDK_GAME_START");
    mock.emit("SDK_GAME_START");
    expect(events).toEqual(AD_PAIR);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("callback arrives late: the request gave up, the late ad holds the screen until it ends", async () => {
    const { platform, timers, events } = await booted({ ad: "late", lateMs: 30_000, adMs: 1_000 });
    const request = platform.showInterstitial();
    timers.advance(25_000);
    await expect(request).resolves.toEqual({ shown: false, reason: "not-ready" });
    timers.advance(5_000);
    // The ad opened after all: the portal holds the screen, and no second ad may start.
    expect(platform.foreground).toBe(false);
    expect(events).toEqual(["foreground:lost"]);
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    timers.advance(1_000);
    expect(platform.foreground).toBe(true);
    expect(events).toEqual(["foreground:lost", "foreground:gained"]);
  });

  it("a slow ad inside the SDK's own 20s window still belongs to the request", async () => {
    const { platform, timers, events } = await booted({ ad: "late", lateMs: 19_000, adMs: 5_000 });
    const request = platform.showInterstitial();
    timers.advance(19_000);
    expect(platform.foreground).toBe(false);
    timers.advance(5_000);
    await expect(request).resolves.toEqual({ shown: true });
    expect(events).toEqual(AD_PAIR);
  });

  it("a second request while one is on screen is busy; repeated requests after it each run", async () => {
    const { platform, mock, timers } = await booted({ ad: "stall" });
    const first = platform.showInterstitial();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    timers.advance(60_000);
    await first;
    mock.setAd("play");
    for (let i = 0; i < 5; i += 1) {
      await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    }
    expect(mock.calls.filter((c) => c === "showBanner")).toHaveLength(6);
    expect(platform.usage.adsRequested.interstitial).toBe(7);
  });

  it("a throwing onStart hook does not strand the ad", async () => {
    const { platform, events } = await booted();
    const result = await platform.showInterstitial({
      onStart: () => {
        throw new Error("hook");
      },
    });
    expect(result).toEqual({ shown: true });
    expect(events).toEqual(AD_PAIR);
  });
});

describe("GameMonetize rewarded", () => {
  it("is unsupported: never calls the SDK, never rewards", async () => {
    const { platform, mock } = await booted();
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "unsupported",
    });
    expect(mock.calls).toEqual(["load"]);
    expect(platform.usage.adsRequested.rewarded).toBe(1);
  });

  it("no SDK event can turn into a reward, however often it arrives", async () => {
    const { platform, mock } = await booted();
    const pending = platform.showRewarded();
    for (const name of ["SDK_GAME_PAUSE", "SDK_GAME_START", "SDK_GAME_START", "SDK_READY"]) {
      mock.emit(name);
    }
    const results = await Promise.all([pending, platform.showRewarded()]);
    for (const result of results) expect(result.rewarded).toBe(false);
  });
});

describe("GameMonetize pause and resume", () => {
  it("the SDK pausing by itself takes the foreground once and gives it back once", async () => {
    const { platform, mock, events } = await booted();
    mock.emit("SDK_GAME_PAUSE");
    mock.emit("SDK_GAME_PAUSE");
    expect(platform.foreground).toBe(false);
    mock.emit("SDK_GAME_START");
    mock.emit("SDK_GAME_START");
    expect(platform.foreground).toBe(true);
    expect(events).toEqual(["foreground:lost", "foreground:gained"]);
  });

  it("a stray SDK_GAME_START with nothing on screen changes nothing", async () => {
    const { platform, mock, events } = await booted();
    mock.emit("SDK_GAME_START");
    expect(events).toEqual([]);
    expect(platform.foreground).toBe(true);
  });

  function running(platform: Platform) {
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    const binding = bindPlatform(game, platform, {
      setTimeout: () => undefined,
      clearTimeout: () => undefined,
    });
    platform.gameplayStart();
    return { game, binding };
  }

  it("the game is paused and muted while the SDK holds it, and never left paused", async () => {
    const { platform, mock, timers } = await booted();
    const { game, binding } = running(platform);
    mock.emit("SDK_GAME_PAUSE");
    expect(game.paused).toBe(true);
    expect(binding.audioMuted).toBe(true);
    // SDK_GAME_START never comes.
    timers.advance(60_000);
    expect(game.paused).toBe(false);
    expect(binding.audioMuted).toBe(false);
    binding.dispose();
  });

  it("an ad break mutes and pauses for the ad and restores gameplay after it", async () => {
    const { platform } = await booted();
    const { game, binding } = running(platform);
    let during: { paused: boolean; muted: boolean } | null = null;
    const result = await withAdBreak(game, platform, () =>
      platform.showInterstitial({
        onStart: () => (during = { paused: game.paused, muted: binding.audioMuted }),
      }),
    );
    expect(result).toEqual({ shown: true });
    expect(during).toEqual({ paused: true, muted: true });
    expect(game.paused).toBe(false);
    expect(binding.audioMuted).toBe(false);
    expect(platform.gameplayActive).toBe(true);
    binding.dispose();
  });

  it.each(["ad-error", "sdk-error", "no-fill", "throw"] as const)(
    "resume after a failed ad (%s): gameplay restored, nothing muted",
    async (ad) => {
      const { platform } = await booted({ ad });
      const { game, binding } = running(platform);
      const result = await withAdBreak(game, platform, () => platform.showInterstitial());
      expect(result.shown).toBe(false);
      expect(game.paused).toBe(false);
      expect(binding.audioMuted).toBe(false);
      expect(platform.gameplayActive).toBe(true);
      binding.dispose();
    },
  );

  it("an ad whose SDK_GAME_START is lost still ends the break", async () => {
    const { platform, timers } = await booted({ ad: "stall" });
    const { game, binding } = running(platform);
    const pending = withAdBreak(game, platform, () => platform.showInterstitial());
    expect(game.paused).toBe(true);
    timers.advance(60_000);
    await pending;
    expect(game.paused).toBe(false);
    expect(binding.audioMuted).toBe(false);
    binding.dispose();
  });

  it("gameplay transitions are tracked once each", async () => {
    const { platform } = await booted();
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    platform.gameplayStop();
    expect(platform.usage.gameplayStartCalls).toBe(1);
    expect(platform.usage.gameplayStopCalls).toBe(1);
  });
});
