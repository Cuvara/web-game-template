// Y8 adapter: SDK loading races, configuration, the ad lifecycle and cloud storage, each
// against the deterministic mock in tests/y8/mock-y8-sdk.js. Nothing here loads the real
// script or touches the network.
//
// The adversarial cases are the point: the SDK loading before and after the listener, the
// ready event firing twice, callbacks that fire twice, arrive late, or never arrive, and a
// reward that must be granted at most once.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import {
  MemoryStorageBackend,
  Y8_SDK_URL,
  Y8Platform,
  Y8StorageError,
  Y8_VALUE_LIMIT_BYTES,
  createPlatform,
  loadY8Sdk,
  validateY8Config,
  type PlatformEvents,
  type Y8LoaderEnvironment,
  type Y8Options,
  type Y8Timers,
} from "@wgf/platform-sdk";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import { createY8Mock, type Y8Mock, type Y8MockOptions } from "../y8/mock-y8-sdk.js";

const CONFIG = { appId: "wgf-test-app", gameId: "wgf-test-game" };

class ManualTimers implements Y8Timers {
  now = 0;
  #next = 1;
  readonly #pending = new Map<number, { at: number; handler: () => void }>();

  setTimeout(handler: () => void, ms: number): unknown {
    const id = this.#next++;
    this.#pending.set(id, { at: this.now + ms, handler });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#pending.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, entry] of [...this.#pending]) {
      if (entry.at <= this.now) {
        this.#pending.delete(id);
        entry.handler();
      }
    }
  }

  get pending(): number {
    return this.#pending.size;
  }
}

/** Let every queued microtask run (the mock drives its callbacks through them). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

interface Setup {
  platform: Y8Platform;
  mock: Y8Mock;
  timers: ManualTimers;
  events: string[];
  loads: () => number;
}

async function setup(
  mockOptions: Y8MockOptions = {},
  options: Partial<Y8Options> = {},
  initialize = true,
): Promise<Setup> {
  const timers = new ManualTimers();
  const mock = createY8Mock(new EventTarget(), { defer: () => {}, ...mockOptions });
  let loads = 0;
  const platform = new Y8Platform({
    namespace: "y8-test",
    config: CONFIG,
    guestStorage: new MemoryStorageBackend(),
    loadSdk: () => {
      loads += 1;
      return Promise.resolve(mock.sdk);
    },
    timers,
    ...options,
  });
  const events: string[] = [];
  for (const event of [
    "ad:start",
    "ad:end",
    "ad:late-reward",
    "foreground:lost",
    "foreground:gained",
    "storage:changed",
  ] as const satisfies readonly (keyof PlatformEvents)[]) {
    platform.on(event, () => events.push(event));
  }
  if (initialize) await platform.initialize();
  return { platform, mock, timers, events, loads: () => loads };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -- Configuration ---------------------------------------------------------------------

describe("Y8 configuration", () => {
  it("accepts an App ID and an optional Game ID", () => {
    expect(validateY8Config({ appId: "abc123" })).toEqual({
      ok: true,
      config: { appId: "abc123", gameId: null },
      warnings: [],
    });
    expect(validateY8Config(CONFIG)).toMatchObject({ ok: true, config: CONFIG });
  });

  it.each([
    [undefined, /unset/],
    [null, /unset/],
    ["abc", /object/],
    [[], /object/],
    [{}, /appId must be a string/],
    [{ appId: "" }, /appId is empty/],
    [{ appId: "   " }, /appId is empty/],
    [{ appId: "<app id>" }, /not an identifier/],
    [{ appId: "has space" }, /not an identifier/],
    [{ appId: 42 }, /must be a string/],
  ])("rejects %j", (raw, problem) => {
    const result = validateY8Config(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(problem);
  });

  it("keeps the integration but disables ads for a malformed Game ID", () => {
    const result = validateY8Config({ appId: "abc", gameId: "<game id>" });
    expect(result).toMatchObject({ ok: true, config: { appId: "abc", gameId: null } });
    if (result.ok) expect(result.warnings[0]).toMatch(/ads are disabled/);
  });

  it("missing configuration: never loads the SDK, runs as a plain web game", async () => {
    const { platform, loads } = await setup({}, { config: undefined });
    expect(platform.mode).toBe("not-configured");
    expect(loads()).toBe(0);
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    await platform.storage.set("best", "7");
    await expect(platform.storage.get("best")).resolves.toBe("7");
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/not configured/));
  });

  it("malformed configuration is treated as missing", async () => {
    const { platform, loads } = await setup({}, { config: { appId: "<app id>" } });
    expect(platform.mode).toBe("not-configured");
    expect(loads()).toBe(0);
  });

  it("no Game ID: init gets no adConfig, and ads are disabled rather than attempted", async () => {
    const { platform, mock } = await setup({}, { config: { appId: "abc" } });
    expect(platform.mode).toBe("sdk");
    expect(mock.sdk.lastInit).toEqual({
      appConfig: { appId: "abc", autoLogin: true },
      adConfig: undefined,
    });
    expect(platform.adAvailability("interstitial")).toBe("disabled");
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "disabled",
    });
    expect(mock.calls.some((c) => c.startsWith("showAd"))).toBe(false);
  });

  it("passes the App ID and Game ID to init exactly as documented", async () => {
    const { mock } = await setup();
    expect(mock.sdk.lastInit).toEqual({
      appConfig: { appId: CONFIG.appId, autoLogin: true },
      adConfig: { gameId: CONFIG.gameId, preloadAdBreaks: "on", sound: "on" },
    });
  });

  it("createPlatform wires the y8 settings through", () => {
    const platform = createPlatform("y8", { namespace: "t", y8: CONFIG });
    expect(platform.id).toBe("y8");
    expect(platform.capabilities.ads).toEqual(["interstitial", "rewarded"]);
  });
});

// -- Loading and the y8sdk.ready race -------------------------------------------------------

interface FakeDom {
  env: Y8LoaderEnvironment;
  window: EventTarget & Record<string, unknown>;
  appended: (EventTarget & { src?: string; async?: boolean })[];
  timers: ManualTimers;
  readyListeners: () => number;
}

function fakeDom(existingTag = false): FakeDom {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  let listeners = 0;
  const add = win.addEventListener.bind(win);
  const remove = win.removeEventListener.bind(win);
  win.addEventListener = (type: string, ...rest: [never, never?]) => {
    if (type === "y8sdk.ready") listeners += 1;
    add(type, ...rest);
  };
  win.removeEventListener = (type: string, ...rest: [never, never?]) => {
    if (type === "y8sdk.ready") listeners -= 1;
    remove(type, ...rest);
  };
  const appended: FakeDom["appended"] = [];
  const tag = Object.assign(new EventTarget(), { src: Y8_SDK_URL, async: true });
  const timers = new ManualTimers();
  const doc = {
    createElement: () => Object.assign(new EventTarget(), { src: "", async: false }),
    querySelector: (selector: string) =>
      existingTag && selector.includes(Y8_SDK_URL) ? tag : null,
    head: { appendChild: (node: FakeDom["appended"][number]) => void appended.push(node) },
  };
  if (existingTag) appended.push(tag);
  // loadY8Sdk reads the global from globalThis, so point globalThis.y8 at this window's.
  Object.defineProperty(globalThis, "y8", {
    configurable: true,
    get: () => win["y8"],
  });
  return {
    env: {
      window: win as unknown as Y8LoaderEnvironment["window"],
      document: doc as unknown as NonNullable<Y8LoaderEnvironment["document"]>,
      setTimeout: (h, ms) => timers.setTimeout(h, ms),
      clearTimeout: (h) => timers.clearTimeout(h),
    },
    window: win,
    appended,
    timers,
    readyListeners: () => listeners,
  };
}

describe("Y8 SDK loading", () => {
  afterEach(() => {
    delete (globalThis as { y8?: unknown }).y8;
  });

  it("SDK ready BEFORE the listener: emitReadyEvent makes it announce again", async () => {
    const dom = fakeDom(true);
    const queued: (() => void)[] = [];
    const mock = createY8Mock(dom.window, { defer: (fn) => queued.push(fn) });
    // The script ran and fired y8sdk.ready with nobody listening.
    queued.splice(0).forEach((fn) => fn());
    expect(mock.calls).toEqual(["event:y8sdk.ready"]);

    const loading = loadY8Sdk({ environment: dom.env });
    expect(mock.calls).toContain("emitReadyEvent");
    queued.splice(0).forEach((fn) => fn());
    await expect(loading).resolves.toBe(mock.sdk);
    expect(dom.readyListeners()).toBe(0);
  });

  it("listener registered BEFORE the SDK: the script's own announcement is caught", async () => {
    const dom = fakeDom(true);
    const loading = loadY8Sdk({ environment: dom.env });
    expect(dom.readyListeners()).toBe(1);
    // The async <head> script finishes later.
    const queued: (() => void)[] = [];
    const mock = createY8Mock(dom.window, { defer: (fn) => queued.push(fn) });
    queued.splice(0).forEach((fn) => fn());
    await expect(loading).resolves.toBe(mock.sdk);
    expect(dom.appended).toHaveLength(1); // the existing tag, nothing injected
  });

  it("injects the documented async script when the page has none", async () => {
    const dom = fakeDom(false);
    const loading = loadY8Sdk({ environment: dom.env });
    expect(dom.appended).toHaveLength(1);
    expect(dom.appended[0]).toMatchObject({ src: Y8_SDK_URL, async: true });
    const queued: (() => void)[] = [];
    const mock = createY8Mock(dom.window, { defer: (fn) => queued.push(fn) });
    dom.appended[0]!.dispatchEvent(new Event("load"));
    queued.splice(0).forEach((fn) => fn());
    await expect(loading).resolves.toBe(mock.sdk);
  });

  it("y8sdk.ready firing twice resolves once and leaves no listener behind", async () => {
    const dom = fakeDom(true);
    const loading = loadY8Sdk({ environment: dom.env });
    const queued: (() => void)[] = [];
    const mock = createY8Mock(dom.window, { ready: "twice", defer: (fn) => queued.push(fn) });
    queued.splice(0).forEach((fn) => fn());
    await expect(loading).resolves.toBe(mock.sdk);
    expect(mock.calls.filter((c) => c === "event:y8sdk.ready")).toHaveLength(2);
    expect(dom.readyListeners()).toBe(0);
  });

  it("a very late SDK still resolves inside the timeout", async () => {
    const dom = fakeDom(true);
    const loading = loadY8Sdk({ environment: dom.env, timeoutMs: 10_000 });
    dom.timers.advance(9_900);
    const mock = createY8Mock(dom.window, { defer: (fn) => fn() });
    await expect(loading).resolves.toBe(mock.sdk);
  });

  it("an SDK that never becomes ready rejects at the timeout instead of hanging", async () => {
    const dom = fakeDom(true);
    const loading = loadY8Sdk({ environment: dom.env, timeoutMs: 5_000 });
    createY8Mock(dom.window, { ready: "never", defer: (fn) => fn() });
    dom.timers.advance(5_000);
    await expect(loading).rejects.toThrow(/not ready within 5000 ms/);
    expect(dom.readyListeners()).toBe(0);
  });

  it("an already-loaded SDK whose emitReadyEvent throws is used directly, not waited on", async () => {
    const dom = fakeDom(true);
    const mock = createY8Mock(dom.window, { ready: "never", defer: () => {} });
    (mock.global as { emitReadyEvent: () => void }).emitReadyEvent = () => {
      throw new Error("broken");
    };
    await expect(loadY8Sdk({ environment: dom.env })).resolves.toBe(mock.sdk);
    expect(dom.timers.pending).toBe(0);
  });

  it("a blocked script rejects at once", async () => {
    const dom = fakeDom(false);
    const loading = loadY8Sdk({ environment: dom.env });
    dom.appended[0]!.dispatchEvent(new Event("error"));
    await expect(loading).rejects.toThrow(/failed to load/);
  });

  it("y8sdk.ready without window.y8.sdk rejects", async () => {
    const dom = fakeDom(true);
    const loading = loadY8Sdk({ environment: dom.env });
    dom.window.dispatchEvent(new Event("y8sdk.ready"));
    await expect(loading).rejects.toThrow(/absent/);
  });

  it("the adapter boots through a late SDK and initializes it exactly once", async () => {
    const dom = fakeDom(true);
    const timers = new ManualTimers();
    const platform = new Y8Platform({
      namespace: "t",
      config: CONFIG,
      guestStorage: new MemoryStorageBackend(),
      timers,
      loadSdk: () => loadY8Sdk({ environment: dom.env }),
    });
    const booting = Promise.all([platform.initialize(), platform.initialize()]);
    dom.timers.advance(3_000);
    const mock = createY8Mock(dom.window, { ready: "twice", defer: (fn) => fn() });
    await booting;
    expect(platform.mode).toBe("sdk");
    expect(mock.calls.filter((c) => c === "init")).toHaveLength(1);
  });
});

// -- Initialization failures ------------------------------------------------------------

describe("Y8 initialization", () => {
  it("SDK unavailable: the game boots, ads are refused as not-ready, saves are local", async () => {
    const { platform } = await setup(
      {},
      { loadSdk: () => Promise.reject(new Error("cdn.y8.com blocked")) },
    );
    expect(platform.mode).toBe("unavailable");
    expect(platform.adAvailability("interstitial")).toBe("disabled");
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    await platform.storage.set("k", "v");
    await expect(platform.storage.get("k")).resolves.toBe("v");
  });

  it("init() throwing degrades instead of failing boot", async () => {
    const { platform } = await setup({ init: "throws" });
    expect(platform.mode).toBe("failed");
    await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
  });

  it("init() rejecting degrades too, and cloud storage is dropped", async () => {
    const { platform, mock } = await setup({ init: "rejects", user: { nickname: "Ann" } });
    await flush();
    expect(platform.mode).toBe("failed");
    await platform.storage.set("k", "v");
    expect(mock.calls).not.toContain("saveData");
  });

  it("an ad requested before initialize() is refused as not-ready, never thrown", async () => {
    const { platform, mock } = await setup({}, {}, false);
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    expect(mock.calls.some((c) => c.startsWith("showAd"))).toBe(false);
  });

  it("an init rejection hides ad offers and leaves saves local", async () => {
    const { platform, events } = await setup({
      init: "rejects",
      user: { nickname: "Ann" },
    });
    await flush();
    expect(platform.adAvailability("interstitial")).toBe("disabled");
    expect(platform.storage.persistent).toBe(false);
    // Nobody was ever signed in on the failed SDK, so the backend never changed.
    expect(events).not.toContain("storage:changed");
  });

  it("unavailable guest storage is reported as not persistent, and still works in memory", async () => {
    const volatile = Object.assign(new MemoryStorageBackend(), {});
    const { platform } = await setup({}, { guestStorage: volatile });
    expect(platform.storage.persistent).toBe(false);
    await platform.storage.set("k", "v");
    await expect(platform.storage.get("k")).resolves.toBe("v");
  });

  it("initialize is idempotent", async () => {
    const { platform, mock, loads } = await setup({}, {}, false);
    await Promise.all([platform.initialize(), platform.initialize(), platform.initialize()]);
    expect(loads()).toBe(1);
    expect(mock.calls.filter((c) => c === "init")).toHaveLength(1);
  });

  it("boot waits for the first auth report, but not forever", async () => {
    const { platform, timers } = await setup({ auth: "never" }, {}, false);
    let done = false;
    const booting = platform.initialize().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    timers.advance(3_000);
    await booting;
    expect(platform.mode).toBe("sdk");
  });

  it("uses the platform locale as the language", async () => {
    const { platform } = await setup({ locale: "fr" });
    expect(platform.language).toBe("fr");
  });

  it('treats "en" as no signal, since it is also the fallback', async () => {
    const { platform } = await setup({ locale: "en" });
    expect(platform.language).toBeNull();
  });

  it("a sign-in error leaves a playable guest", async () => {
    const { platform } = await setup({ authError: true });
    expect(platform.signedIn).toBe(false);
    await expect(platform.getUser()).resolves.toBeNull();
  });

  it("loading calls are counted; Y8 has no loading API to forward them to", async () => {
    const { platform, mock } = await setup();
    platform.reportLoadingProgress(0.5);
    platform.reportLoadingProgress(2);
    await platform.signalReady();
    expect(platform.usage.loadingProgressCalls).toBe(2);
    expect(platform.usage.signalReadyCalls).toBe(1);
    expect(platform.loadingFraction).toBe(1);
    expect(mock.calls).not.toContain("gameplayStart");
  });
});

// -- Ads --------------------------------------------------------------------------------

describe("Y8 interstitial", () => {
  it("a filled break: shown, bracketed by foreground and ad events, on the next placement", async () => {
    const { platform, mock, events } = await setup();
    const onStart = vi.fn();
    await expect(platform.showInterstitial({ onStart })).resolves.toEqual({ shown: true });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(mock.calls).toContain("showAd:next");
    expect(events).toEqual(["foreground:lost", "ad:start", "foreground:gained", "ad:end"]);
    expect(platform.foreground).toBe(true);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("an ad closed early still appeared", async () => {
    const { platform } = await setup({ ad: "dismissed" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it.each([
    ["noAdPreloaded", "not-ready"],
    ["notReady", "not-ready"],
    ["timeout", "not-ready"],
    ["ignored", "not-ready"],
    ["frequencyCapped", "too-soon"],
    ["error", "error"],
    ["other", "error"],
  ] as const)(
    "breakStatus %s: nothing shown (%s), the game is never paused",
    async (status, reason) => {
      const { platform, events } = await setup({ ad: status });
      const onStart = vi.fn();
      await expect(platform.showInterstitial({ onStart })).resolves.toEqual({
        shown: false,
        reason,
      });
      expect(onStart).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(platform.foreground).toBe(true);
      expect(platform.usage.adsShown.interstitial).toBe(0);
    },
  );

  it("showAd rejecting resolves unshown as an error", async () => {
    const { platform } = await setup({ ad: "reject" });
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
  });

  it("a break that never answers (ad never becomes available) times out unshown", async () => {
    const { platform, timers, events } = await setup({ ad: "silent" });
    const pending = platform.showInterstitial();
    await flush();
    timers.advance(15_000);
    await expect(pending).resolves.toEqual({ shown: false, reason: "error" });
    expect(events).toEqual([]);
    // The slot is free again.
    expect(platform.adAvailability("interstitial")).toBe("available");
  });

  it("a second request while one is open is refused as busy", async () => {
    const { platform, mock } = await setup({ ad: "stall" });
    const first = platform.showInterstitial();
    await flush();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    mock.release();
    await expect(first).resolves.toEqual({ shown: true });
  });

  it("duplicate callbacks resolve once and bracket the ad once", async () => {
    const { platform, events } = await setup({ ad: "duplicate" });
    const results: unknown[] = [];
    await platform.showInterstitial().then((r) => results.push(r));
    await flush();
    expect(results).toEqual([{ shown: true }]);
    expect(events.filter((e) => e === "ad:start")).toHaveLength(1);
    expect(events.filter((e) => e === "ad:end")).toHaveLength(1);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("an ad that pauses the game but never sends afterAd is closed after the max duration", async () => {
    const { platform, mock, timers, events } = await setup({ ad: "stall" });
    const pending = platform.showInterstitial();
    await flush();
    expect(platform.foreground).toBe(false);
    timers.advance(180_000);
    await expect(pending).resolves.toEqual({ shown: true });
    expect(platform.foreground).toBe(true);
    // The stalled callbacks arriving afterwards change nothing.
    mock.release();
    await flush();
    expect(events).toEqual(["foreground:lost", "ad:start", "foreground:gained", "ad:end"]);
  });

  it("afterAd without adBreakDone settles after a short grace", async () => {
    const timers = new ManualTimers();
    const mock = createY8Mock(new EventTarget(), { defer: () => {} });
    const sdk = {
      ...mock.sdk,
      showAd: (o: { beforeAd?: () => void; afterAd?: () => void }) => {
        o.beforeAd?.();
        o.afterAd?.();
        return Promise.resolve();
      },
    };
    const platform = new Y8Platform({
      namespace: "t",
      config: CONFIG,
      guestStorage: new MemoryStorageBackend(),
      loadSdk: () => Promise.resolve(sdk),
      timers,
    });
    await platform.initialize();
    const pending = platform.showInterstitial();
    await flush();
    expect(platform.foreground).toBe(true); // afterAd already handed it back
    timers.advance(2_000);
    await expect(pending).resolves.toEqual({ shown: true });
  });
});

describe("Y8 rewarded", () => {
  it("rewards only on adViewed, on the reward placement, calling showAdFn once", async () => {
    const { platform, mock } = await setup();
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
    expect(mock.calls).toContain("showAd:reward");
    expect(mock.calls.filter((c) => c === "showAdFn")).toHaveLength(1);
    expect(platform.usage.adsShown.rewarded).toBe(1);
  });

  it("closed early (adDismissed): shown, no reward", async () => {
    const { platform } = await setup({ ad: "dismissed" });
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: false });
  });

  it("no rewarded ad available: no reward, never throws, never pauses", async () => {
    const { platform, events } = await setup({ ad: "noAdPreloaded" });
    await expect(platform.showRewarded()).resolves.toEqual({
      shown: false,
      rewarded: false,
      reason: "not-ready",
    });
    expect(events).toEqual([]);
  });

  it("an ad error: no reward", async () => {
    const { platform } = await setup({ ad: "error" });
    await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
  });

  it("the reward callback firing twice grants one reward", async () => {
    const { platform } = await setup({ ad: "duplicate" });
    const results: unknown[] = [];
    await platform.showRewarded().then((r) => results.push(r));
    await flush();
    expect(results).toEqual([{ shown: true, rewarded: true }]);
    expect(platform.usage.adsShown.rewarded).toBe(1);
  });

  it("conflicting adViewed then adDismissed: the first report decides", async () => {
    const { platform } = await setup({ ad: "viewed-dismissed" });
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
  });

  it("a rewarded offer that arrives after the request timed out is declined, not shown", async () => {
    // beforeReward hands over showAdFn; nothing plays unless it is called. Once the game
    // has been told "no ad", starting one anyway would pause a game that already moved on.
    const { platform, mock, timers, events } = await setup({ ad: "late" });
    const pending = platform.showRewarded();
    await flush();
    timers.advance(15_000);
    await expect(pending).resolves.toEqual({ shown: false, rewarded: false, reason: "error" });

    mock.release();
    await flush();
    expect(mock.calls).toContain("cb:beforeReward");
    expect(mock.calls).not.toContain("showAdFn");
    expect(events).toEqual([]);
    expect(platform.usage.adsShown.rewarded).toBe(0);
  });

  it("a late interstitial still gets its own ad:start/ad:end so the game mutes for it", async () => {
    const { platform, mock, timers, events } = await setup({ ad: "late" });
    const pending = platform.showInterstitial();
    await flush();
    timers.advance(15_000);
    await expect(pending).resolves.toEqual({ shown: false, reason: "error" });
    mock.release();
    await flush();
    expect(events).toEqual(["foreground:lost", "ad:start", "foreground:gained", "ad:end"]);
    expect(events).not.toContain("ad:late-reward");
  });

  it("a rewarded ad accepted in time but opening late owes its reward once, as ad:late-reward", async () => {
    // The stall script opens (beforeAd) on a microtask; advancing first makes it late.
    const { platform, mock, timers, events } = await setup({ ad: "stall" });
    const pending = platform.showRewarded();
    timers.advance(15_000);
    await expect(pending).resolves.toEqual({ shown: false, rewarded: false, reason: "error" });
    await flush();
    mock.release();
    await flush();
    expect(events).toEqual([
      "foreground:lost",
      "ad:start",
      "ad:late-reward",
      "foreground:gained",
      "ad:end",
    ]);
    expect(platform.usage.adsShown.rewarded).toBe(1);
  });

  it("a late ad on screen blocks the next request, and its reward is not granted twice", async () => {
    const { platform, mock, timers, events } = await setup({ ad: ["stall", "viewed"] });
    // First: time out before anything shows (the stall script's beforeAd is a microtask,
    // so advance before flushing).
    const first = platform.showRewarded();
    timers.advance(15_000);
    await expect(first).resolves.toMatchObject({ shown: false, rewarded: false });
    await flush(); // late beforeAd lands
    expect(platform.foreground).toBe(false);
    await expect(platform.showRewarded()).resolves.toMatchObject({ reason: "busy" });
    mock.release(); // adViewed, afterAd, adBreakDone
    await flush();
    expect(events.filter((e) => e === "ad:late-reward")).toHaveLength(1);
    expect(platform.foreground).toBe(true);
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
  });

  it("a late ad overlapping the next request's ad keeps the foreground until both close", async () => {
    // Request 1 gives up; request 2 starts; request 1's ad then opens late over it.
    const timers = new ManualTimers();
    const opts: {
      beforeAd?: () => void;
      afterAd?: () => void;
      adBreakDone?: (i: object) => void;
    }[] = [];
    const mock = createY8Mock(new EventTarget(), { defer: () => {} });
    const sdk = {
      ...mock.sdk,
      showAd: (o: (typeof opts)[number]) => {
        opts.push(o);
        return Promise.resolve();
      },
    };
    const platform = new Y8Platform({
      namespace: "t",
      config: CONFIG,
      guestStorage: new MemoryStorageBackend(),
      loadSdk: () => Promise.resolve(sdk),
      timers,
    });
    await platform.initialize();
    const events: string[] = [];
    for (const e of ["ad:start", "ad:end", "foreground:lost", "foreground:gained"] as const) {
      platform.on(e, () => events.push(e));
    }
    const first = platform.showInterstitial();
    timers.advance(15_000);
    await first;
    const second = platform.showInterstitial();
    opts[1]!.beforeAd!();
    opts[0]!.beforeAd!(); // late
    opts[0]!.afterAd!(); // the late one closes first
    expect(platform.foreground).toBe(false);
    opts[1]!.afterAd!();
    opts[1]!.adBreakDone!({ breakStatus: "viewed" });
    await expect(second).resolves.toEqual({ shown: true });
    expect(platform.foreground).toBe(true);
    expect(events.filter((e) => e === "ad:start")).toHaveLength(2);
    expect(events.filter((e) => e === "ad:end")).toHaveLength(2);
    expect(events.filter((e) => e === "foreground:lost")).toHaveLength(1);
    expect(events.filter((e) => e === "foreground:gained")).toHaveLength(1);
    expect(events.at(-2)).toBe("foreground:gained");
  });

  it("a late ad that never ends is released after the max duration", async () => {
    const { platform, timers } = await setup({ ad: "stall" });
    const first = platform.showRewarded();
    timers.advance(15_000);
    await first;
    await flush();
    expect(platform.foreground).toBe(false);
    timers.advance(180_000);
    expect(platform.foreground).toBe(true);
  });

  it("a stalled rewarded ad closed by the watchdog grants nothing, then or later", async () => {
    const { platform, mock, timers, events } = await setup({ ad: "stall" });
    const pending = platform.showRewarded();
    await flush();
    timers.advance(180_000);
    await expect(pending).resolves.toEqual({ shown: true, rewarded: false });
    mock.release();
    await flush();
    expect(events).not.toContain("ad:late-reward");
  });
});

// -- Game binding: pause, resume, audio, hidden tabs -----------------------------------------

describe("Y8 with the game bound", () => {
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

  const running = (): Game => {
    const game = new Game({ scheduler: new ManualScheduler() });
    game.start();
    return game;
  };

  it("an ad pauses and mutes the game; afterAd resumes and unmutes it", async () => {
    const { platform } = await setup();
    const game = running();
    const muted: boolean[] = [];
    bindPlatform(game, platform, { onAudioMutedChange: (m) => muted.push(m) });
    platform.gameplayStart();
    let pausedDuringAd = false;
    const result = await withAdBreak(game, platform, () =>
      platform.showRewarded({ onStart: () => (pausedDuringAd = game.paused) }),
    );
    expect(result.rewarded).toBe(true);
    expect(pausedDuringAd).toBe(true);
    expect(game.paused).toBe(false);
    expect(muted).toEqual([true, false]);
    expect(platform.gameplayActive).toBe(true);
  });

  it("a skipped break never pauses the game at all", async () => {
    const { platform } = await setup({ ad: "frequencyCapped" });
    const game = running();
    const muted: boolean[] = [];
    bindPlatform(game, platform, { onAudioMutedChange: (m) => muted.push(m) });
    platform.gameplayStart();
    await platform.showInterstitial();
    expect(game.paused).toBe(false);
    expect(muted).toEqual([]);
  });

  it("tab hidden during the ad: stays paused after the ad until the tab returns", async () => {
    const { platform, mock } = await setup({ ad: "stall" });
    const game = running();
    bindPlatform(game, platform);
    platform.gameplayStart();
    const pending = withAdBreak(game, platform, () => platform.showInterstitial());
    await flush();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    mock.release();
    await pending;
    expect(game.paused).toBe(true);
    expect(platform.gameplayActive).toBe(false);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(game.paused).toBe(false);
    expect(platform.gameplayActive).toBe(true);
  });

  it("a late ad outside withAdBreak still pauses and resumes the game", async () => {
    const { platform, mock, timers } = await setup({ ad: "late" });
    const game = running();
    bindPlatform(game, platform);
    platform.gameplayStart();
    const pending = platform.showInterstitial();
    timers.advance(15_000);
    await pending;
    expect(game.paused).toBe(false);
    mock.release();
    // Mid-sequence the ad was on screen; by now afterAd has closed it.
    await flush();
    expect(game.paused).toBe(false);
    expect(platform.gameplayActive).toBe(true);
  });
});

// -- Storage ------------------------------------------------------------------------------

describe("Y8 storage", () => {
  const ann = { pid: "1", nickname: "Ann", avatars: { medium_secure_url: "https://img/ann.png" } };

  it("a guest saves locally and never calls cloud storage", async () => {
    const { platform, mock } = await setup();
    await platform.storage.set("best", "3");
    await expect(platform.storage.get("best")).resolves.toBe("3");
    await platform.storage.remove("best");
    await expect(platform.storage.get("best")).resolves.toBeNull();
    expect(mock.calls.filter((c) => /Data$/.test(c))).toEqual([]);
  });

  it("a signed-in player saves, loads and removes through Cloud Storage", async () => {
    const { platform, mock } = await setup({ user: ann });
    expect(platform.signedIn).toBe(true);
    expect(platform.storage.persistent).toBe(true);
    await platform.storage.set("best", "9");
    expect(mock.data.get("best")).toBe("9");
    await expect(platform.storage.get("best")).resolves.toBe("9");
    await expect(platform.storage.get("missing")).resolves.toBeNull();
    await platform.storage.remove("best");
    expect(mock.data.has("best")).toBe(false);
    expect(mock.calls).toEqual(expect.arrayContaining(["saveData", "loadData", "removeData"]));
  });

  it("a cloud failure rejects visibly; it is never silently saved elsewhere", async () => {
    const { platform, mock } = await setup({ user: ann, storage: "fail" });
    await expect(platform.storage.set("best", "9")).rejects.toBeInstanceOf(Y8StorageError);
    await expect(platform.storage.get("best")).rejects.toThrow(/network error/);
    mock.setStorage("ok");
    await expect(platform.storage.get("best")).resolves.toBeNull();
  });

  it("a server-refused save carries the saveRejected code", async () => {
    const { platform } = await setup({ user: ann, storage: "rejected" });
    const error = await platform.storage.set("best", "9").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Y8StorageError);
    expect((error as Y8StorageError).rejected).toBe(true);
  });

  it("refuses a value over 30 KB before sending it", async () => {
    const { platform, mock } = await setup({ user: ann });
    await expect(platform.storage.set("big", "x".repeat(Y8_VALUE_LIMIT_BYTES + 1))).rejects.toThrow(
      /30720/,
    );
    expect(mock.calls).not.toContain("saveData");
    await expect(
      platform.storage.set("ok", "x".repeat(Y8_VALUE_LIMIT_BYTES)),
    ).resolves.toBeUndefined();
  });

  it("signing in and out switches the backend and raises storage:changed each time", async () => {
    const { platform, mock, events } = await setup();
    await platform.storage.set("best", "local");
    mock.setUser(ann);
    expect(events).toEqual(["storage:changed"]);
    await expect(platform.storage.get("best")).resolves.toBeNull(); // the account's, not the guest's
    mock.setUser(null);
    expect(events).toEqual(["storage:changed", "storage:changed"]);
    await expect(platform.storage.get("best")).resolves.toBe("local");
  });

  it("getUser maps the documented display fields", async () => {
    const { platform } = await setup({ user: ann });
    await expect(platform.getUser()).resolves.toEqual({
      username: "Ann",
      avatarUrl: "https://img/ann.png",
    });
  });

  it("gameplay start/stop are deduplicated and stay local", async () => {
    const { platform, mock } = await setup();
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    platform.gameplayStop();
    expect(platform.usage.gameplayStartCalls).toBe(1);
    expect(platform.usage.gameplayStopCalls).toBe(1);
    expect(mock.calls.some((c) => /gameplay/i.test(c))).toBe(false);
  });
});
