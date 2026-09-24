// GameDistribution adapter, in detail and adversarially.
//
// Runs against the deterministic fake in tests/gamedistribution/fake-sdk.ts, which emits the
// documented events in GD-HTML5 1.43.58's order. The cross-portal promises are in
// tests/sdk/conformance.test.ts and tests/unit/sdk-contract.test.ts; this file pins what is
// particular to GameDistribution — SDK_READY/SDK_ERROR, SDK_GAME_PAUSE/START as the only ad
// signals, SDK_REWARDED_WATCH_COMPLETE as the only reward, the Game ID and self-hosting.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Game, ManualScheduler } from "@wgf/game-core";
import {
  GAMEDISTRIBUTION_GAME_ID,
  GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID,
  GAMEDISTRIBUTION_SCRIPT_ID,
  GAMEDISTRIBUTION_SDK_URL,
  GameDistributionPlatform,
  MemoryStorageBackend,
  createPlatform,
  loadGameDistributionSdk,
  readHosting,
  type GameDistributionHosting,
  type Timers,
} from "@wgf/platform-sdk";
import { validateGameConfig } from "../../src/core/game-config.js";
import { bindPlatform, withAdBreak } from "../../src/platform/bind.js";
import {
  FakeGdSdk,
  TEST_GD_GAME_ID,
  fakeLoader,
  flush,
  type FakeGdOptions,
} from "../gamedistribution/fake-sdk.js";

class ManualTimers implements Timers {
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
}

function setup(options: FakeGdOptions & { hosting?: GameDistributionHosting } = {}) {
  const sdk = new FakeGdSdk(options);
  const timers = new ManualTimers();
  const platform = new GameDistributionPlatform({
    namespace: "gd-test",
    gameId: TEST_GD_GAME_ID,
    loadSdk: fakeLoader(sdk, options.boot ?? "ready"),
    timers,
    storage: new MemoryStorageBackend(),
    ...(options.hosting ? { hosting: () => options.hosting! } : {}),
  });
  const seen: string[] = [];
  for (const event of [
    "ad:start",
    "ad:end",
    "foreground:lost",
    "foreground:gained",
    "ad:late-reward",
  ] as const) {
    platform.on(event, () => seen.push(event));
  }
  return { sdk, timers, platform, seen };
}

async function ready(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  await env.platform.initialize();
  await env.platform.signalReady();
  await flush();
  return env;
}

describe("GameDistribution — configuration", () => {
  it("the adapter refuses to exist without a Game ID", () => {
    expect(() => createPlatform("gamedistribution", { namespace: "t" })).toThrow(/Game ID/);
    expect(() => new GameDistributionPlatform({ namespace: "t", gameId: "not-an-id" })).toThrow(
      /32 hex/,
    );
  });

  it("refuses the SDK's placeholder Game ID, which reports no revenue", () => {
    expect(
      () =>
        new GameDistributionPlatform({
          namespace: "t",
          gameId: GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID,
        }),
    ).toThrow(/placeholder/);
  });

  it("createPlatform builds the adapter from the game.config entry's Game ID", () => {
    const platform = createPlatform("gamedistribution", {
      namespace: "t",
      gamedistribution: { gameId: TEST_GD_GAME_ID },
    });
    expect(platform.id).toBe("gamedistribution");
    expect(platform.capabilities.ads).toEqual(["interstitial", "rewarded"]);
    expect(platform.capabilities.loadingApi).toBe("none");
    expect(platform.capabilities.interstitialMinIntervalS).toBeNull();
  });

  const config = (entry: Record<string, unknown>) => ({
    game: { id: "g", name: "G", version: "0.1.0" },
    engine: { type: "pixijs" },
    platforms: [
      { id: "gamedistribution", profile: "gamedistribution@1.0.0", role: "required", ...entry },
    ],
    monetization: { ad_kinds: ["interstitial"], iap: false },
    build: { command: "pnpm build", output: "dist" },
    verification: {},
    publishing: { enabled: false },
  });

  it("game.config: a missing or malformed game_id fails the build", () => {
    expect(() => validateGameConfig(config({}))).toThrow(/game_id/);
    expect(() => validateGameConfig(config({ game_id: "abc" }))).toThrow(/game_id/);
    expect(() =>
      validateGameConfig(config({ game_id: GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID })),
    ).toThrow(/placeholder/);
    expect(() => validateGameConfig(config({ game_id: TEST_GD_GAME_ID }))).not.toThrow();
  });

  it("game.config: the validator's Game ID rule agrees with the adapter's", () => {
    expect(GAMEDISTRIBUTION_GAME_ID.source).toBe("^[0-9a-f]{32}$");
  });

  it("game.config: self-hosting needs an https game_url without a baked-in referrer", () => {
    const base = { game_id: TEST_GD_GAME_ID, hosting: "self-hosted" };
    expect(() => validateGameConfig(config(base))).toThrow(/game_url is required/);
    expect(() => validateGameConfig(config({ ...base, game_url: "not a url" }))).toThrow(
      /absolute URL/,
    );
    expect(() =>
      validateGameConfig(config({ ...base, game_url: "http://games.example.com/g/" })),
    ).toThrow(/https/);
    expect(() =>
      validateGameConfig(
        config({
          ...base,
          game_url: "https://games.example.com/g/?GD_SDK_REFERRER_URL=https://x.example/",
        }),
      ),
    ).toThrow(/gd_sdk_referrer_url/);
    expect(() =>
      validateGameConfig(config({ ...base, game_url: "https://games.example.com/g/" })),
    ).not.toThrow();
    expect(() => validateGameConfig(config({ ...base, hosting: "cdn" }))).toThrow(/hosting/);
    expect(() =>
      validateGameConfig(
        config({ game_id: TEST_GD_GAME_ID, game_url: "https://games.example.com/g/" }),
      ),
    ).toThrow(/self-hosted only/);
  });

  it("game.config: GameDistribution fields on another portal are an error", () => {
    const raw = config({ game_id: TEST_GD_GAME_ID });
    raw.platforms.push({
      id: "poki",
      profile: "poki@1.0.0",
      role: "optional",
      game_id: TEST_GD_GAME_ID,
    } as never);
    // game_id is shared with gamemonetize since the GameMonetize merge; still refused here.
    expect(() => validateGameConfig(raw)).toThrow(/game_id is only read for gamedistribution/);
    const hosted = config({ game_id: TEST_GD_GAME_ID });
    hosted.platforms.push({
      id: "poki",
      profile: "poki@1.0.0",
      role: "optional",
      hosting: "self-hosted",
    } as never);
    expect(() => validateGameConfig(hosted)).toThrow(/gamedistribution only/);
  });
});

describe("GameDistribution — SDK loading", () => {
  it("SDK_READY: initialize resolves ready and asks whether rewarded ads are enabled", async () => {
    const { platform, sdk } = await ready();
    expect(platform.sdkState).toBe("ready");
    expect(sdk.options?.gameId).toBe(TEST_GD_GAME_ID);
    expect(sdk.calls).toEqual(["preloadAd:rewarded"]);
    expect(platform.adAvailability("interstitial")).toBe("available");
    expect(platform.adAvailability("rewarded")).toBe("available");
    expect(platform.adAvailability("banner")).toBe("unsupported");
  });

  it("repeated initialization loads the SDK once", async () => {
    const env = setup();
    await Promise.all([env.platform.initialize(), env.platform.initialize()]);
    await env.platform.initialize();
    expect(env.platform.sdkCalls.filter((c) => c === "init")).toHaveLength(1);
  });

  it("SDK_READY twice changes nothing the second time", async () => {
    const { platform, sdk } = await ready({ boot: "twice" });
    expect(platform.sdkState).toBe("ready");
    expect(sdk.calls.filter((c) => c === "preloadAd:rewarded")).toHaveLength(1);
  });

  it("SDK never loads: the game boots without ads after the init deadline", async () => {
    const env = setup({ boot: "never" });
    const init = env.platform.initialize();
    await flush();
    env.timers.advance(5_000);
    await init;
    expect(env.platform.sdkState).toBe("unavailable");
    await expect(env.platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(env.platform.adAvailability("rewarded")).toBe("disabled");
  });

  it("SDK loads late: a SDK_READY after the deadline still enables ads", async () => {
    const env = setup({ boot: "never" });
    const init = env.platform.initialize();
    env.timers.advance(5_000);
    await init;
    env.sdk.emit("SDK_READY");
    await flush();
    expect(env.platform.sdkState).toBe("ready");
    await expect(env.platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("script blocked or loader throwing: boots without ads, saves still work", async () => {
    for (const boot of ["unavailable", "throws"] as const) {
      const { platform } = await ready({ boot });
      expect(platform.sdkState).toBe("unavailable");
      await expect(platform.showRewarded()).resolves.toEqual({
        shown: false,
        rewarded: false,
        reason: "not-ready",
      });
      await platform.storage.set("best", "1");
      await expect(platform.storage.get("best")).resolves.toBe("1");
    }
  });

  it("SDK_ERROR before SDK_READY is an init failure; a later SDK_READY recovers", async () => {
    const failed = await ready({ boot: "error" });
    expect(failed.platform.sdkState).toBe("error");
    expect(failed.platform.sdkError).toBe("fake init error");
    await expect(failed.platform.showRewarded()).resolves.toMatchObject({ rewarded: false });

    const recovered = await ready({ boot: "error-ready" });
    expect(recovered.platform.sdkState).toBe("ready");
  });

  it("SDK_ERROR after SDK_READY does not take ads away", async () => {
    const { platform, sdk } = await ready();
    sdk.emit("SDK_ERROR", "later");
    expect(platform.sdkState).toBe("ready");
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
  });

  it("rewarded flag off in the developer panel: rewarded offers are hidden", async () => {
    const { platform } = await ready({ rewardedEnabled: false });
    expect(platform.adAvailability("rewarded")).toBe("disabled");
    expect(platform.adAvailability("interstitial")).toBe("available");
  });
});

describe("GameDistribution — the documented loader snippet", () => {
  beforeEach(() => {
    const scripts: Array<Record<string, unknown>> = [];
    const doc = {
      getElementById: (id: string) => scripts.find((s) => s["id"] === id) ?? null,
      getElementsByTagName: () => [],
      createElement: () => {
        const script: Record<string, unknown> = {};
        return script;
      },
      head: { appendChild: (s: Record<string, unknown>) => scripts.push(s) },
      scripts,
    };
    Object.assign(globalThis, { window: {}, document: doc });
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it("sets GD_OPTIONS before inserting main.min.js with id gamedistribution-jssdk", async () => {
    const onEvent = () => {};
    const loading = loadGameDistributionSdk({ gameId: TEST_GD_GAME_ID, onEvent });
    const win = globalThis.window as unknown as Record<string, unknown>;
    expect(win["GD_OPTIONS"]).toEqual({ gameId: TEST_GD_GAME_ID, onEvent });
    const [script] = (globalThis.document as unknown as { scripts: Record<string, unknown>[] })
      .scripts;
    expect(script).toMatchObject({ id: GAMEDISTRIBUTION_SCRIPT_ID, src: GAMEDISTRIBUTION_SDK_URL });
    const calls: string[] = [];
    win["gdsdk"] = {
      showAd: (t: string) => Promise.resolve(calls.push(`first:${t}`)),
      preloadAd: () => Promise.resolve(),
    };
    (script!["onload"] as () => void)();
    const sdk = await loading;
    expect(sdk).not.toBeNull();
    await sdk!.showAd("interstitial");
    // The SDK may swap window.gdsdk for its wrapper later; calls follow the current global.
    win["gdsdk"] = { showAd: (t: string) => Promise.resolve(calls.push(`second:${t}`)) };
    await sdk!.showAd("rewarded");
    expect(calls).toEqual(["first:interstitial", "second:rewarded"]);
  });

  it("a script that ran without defining gdsdk (it threw) resolves null", async () => {
    const loading = loadGameDistributionSdk({ gameId: TEST_GD_GAME_ID, onEvent: () => {} });
    const [script] = (globalThis.document as unknown as { scripts: Record<string, unknown>[] })
      .scripts;
    (script!["onload"] as () => void)();
    await expect(loading).resolves.toBeNull();
  });

  it("a blocked script resolves null", async () => {
    const loading = loadGameDistributionSdk({ gameId: TEST_GD_GAME_ID, onEvent: () => {} });
    const [script] = (globalThis.document as unknown as { scripts: Record<string, unknown>[] })
      .scripts;
    (script!["onerror"] as () => void)();
    await expect(loading).resolves.toBeNull();
  });

  it("only loads once: a snippet already on the page is not loaded a second time", async () => {
    void loadGameDistributionSdk({ gameId: TEST_GD_GAME_ID, onEvent: () => {} });
    await expect(
      loadGameDistributionSdk({ gameId: TEST_GD_GAME_ID, onEvent: () => {} }),
    ).resolves.toBeNull();
    const doc = globalThis.document as unknown as { scripts: unknown[] };
    expect(doc.scripts).toHaveLength(1);
  });
});

describe("GameDistribution — lifecycle mapping", () => {
  it("SDK_GAME_PAUSE outside an ad (the portal's pre-roll splash) is a foreground loss", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.emit("SDK_GAME_PAUSE");
    sdk.emit("SDK_GAME_PAUSE");
    expect(platform.foreground).toBe(false);
    sdk.emit("SDK_GAME_START");
    sdk.emit("SDK_GAME_START");
    expect(platform.foreground).toBe(true);
    expect(seen).toEqual(["foreground:lost", "foreground:gained"]);
  });

  it("SDK_GAME_START without a pause (a refused request, a skipped splash) is a no-op", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.emit("SDK_GAME_START");
    expect(platform.foreground).toBe(true);
    expect(seen).toEqual([]);
  });

  it("game pause without game resume, outside an ad: the portal keeps the screen", async () => {
    const { platform, sdk, timers } = await ready();
    sdk.emit("SDK_GAME_PAUSE");
    timers.advance(10 * 60_000);
    // No deadline: the splash waits for the player's click. The ad deadlines below cover
    // pauses the adapter asked for.
    expect(platform.foreground).toBe(false);
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
  });

  it("no loading, ready or gameplay call reaches the SDK — it has none", async () => {
    const { platform, sdk } = await ready();
    platform.reportLoadingProgress(0.5);
    platform.gameplayStart();
    platform.gameplayStart();
    platform.gameplayStop();
    expect(sdk.calls).toEqual(["preloadAd:rewarded"]);
    expect(platform.usage).toMatchObject({
      loadingProgressCalls: 1,
      signalReadyCalls: 1,
      gameplayStartCalls: 1,
      gameplayStopCalls: 1,
    });
  });

  it("unknown and IMA pass-through events are recorded and ignored", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.emit("SDK_GDPR_TRACKING");
    sdk.emit("IMPRESSION");
    sdk.emit("");
    expect(platform.sdkEvents).toContain("SDK_GDPR_TRACKING");
    expect(seen).toEqual([]);
  });
});

describe("GameDistribution — interstitial", () => {
  it("complete: pause → ad:start … ad:end → resume, shown once", async () => {
    const { platform, sdk, seen } = await ready();
    let started = 0;
    await expect(platform.showInterstitial({ onStart: () => (started += 1) })).resolves.toEqual({
      shown: true,
    });
    expect(started).toBe(1);
    expect(sdk.calls).toContain("showAd:interstitial");
    expect(seen).toEqual(["foreground:lost", "ad:start", "ad:end", "foreground:gained"]);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("no fill: unshown, the game never lost the foreground", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "no-fill";
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "not-ready",
    });
    expect(seen).toEqual([]);
  });

  it("requested too soon: the SDK's interval refusal is reported as too-soon", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "too-soon";
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "too-soon",
    });
  });

  it("ads disabled for the title: reported as disabled", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "disabled";
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: "disabled",
    });
  });

  it("an SDK error before anything played: unshown, reason error", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "error";
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
    expect(seen).toEqual([]);
  });

  it("an ad error mid-play hands the game back and resolves shown", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "error-mid-ad";
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(platform.foreground).toBe(true);
    expect(seen.at(-1)).toBe("foreground:gained");
  });

  it("the SDK throwing synchronously resolves as an error", async () => {
    const { platform, sdk } = await ready();
    sdk.showAd = () => {
      throw new Error("boom");
    };
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "error" });
  });

  it("AD_IS_ALREADY_RUNNING: reported busy", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "already-running";
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
  });

  it("a second request while one is open is refused as busy, and never reaches the SDK", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "stall-open";
    void platform.showInterstitial();
    await flush();
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: false, reason: "busy" });
    expect(sdk.calls.filter((c) => c.startsWith("showAd"))).toHaveLength(1);
  });

  it("duplicate SDK events: one ad:start, one ad:end, one answer", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "duplicate";
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    await flush();
    expect(seen).toEqual(["foreground:lost", "ad:start", "ad:end", "foreground:gained"]);
    expect(platform.usage.adsShown.interstitial).toBe(1);
  });

  it("an ad that never starts answers not-ready after the start deadline", async () => {
    const { platform, sdk, timers } = await ready();
    sdk.ad = "stall";
    const result = platform.showInterstitial();
    await flush();
    timers.advance(10_000);
    await expect(result).resolves.toEqual({ shown: false, reason: "not-ready" });
    expect(platform.foreground).toBe(true);
  });

  it("an ad that starts after the deadline still pauses the game, and is handed back", async () => {
    const { platform, sdk, timers, seen } = await ready();
    sdk.ad = "manual";
    const result = platform.showInterstitial();
    timers.advance(10_000);
    await expect(result).resolves.toEqual({ shown: false, reason: "not-ready" });
    sdk.emit("SDK_GAME_PAUSE");
    expect(platform.foreground).toBe(false);
    expect(seen).toEqual(["foreground:lost", "ad:start"]);
    sdk.emit("SDK_GAME_START");
    sdk.settle("resolve");
    await flush();
    expect(platform.foreground).toBe(true);
    expect(seen).toEqual(["foreground:lost", "ad:start", "ad:end", "foreground:gained"]);
  });

  it("pause without resume during an ad: the game is handed back at the max duration", async () => {
    const { platform, sdk, timers } = await ready();
    sdk.ad = "stall-open";
    const result = platform.showInterstitial();
    await flush();
    expect(platform.foreground).toBe(false);
    timers.advance(90_000);
    await expect(result).resolves.toEqual({ shown: true });
    expect(platform.foreground).toBe(true);
  });

  it("the flow settling without SDK_GAME_START still hands the game back", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "no-resume";
    await expect(platform.showInterstitial()).resolves.toEqual({ shown: true });
    expect(platform.foreground).toBe(true);
  });
});

describe("GameDistribution — rewarded", () => {
  it("rewarded only on SDK_REWARDED_WATCH_COMPLETE", async () => {
    const { platform } = await ready();
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
  });

  it("closed early: shown, never rewarded", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "closed-early";
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: false });
  });

  it("no fill, an error, too soon: never rewarded, never throws", async () => {
    const { platform, sdk } = await ready();
    for (const ad of [
      "no-fill",
      "error",
      "error-mid-ad",
      "too-soon",
      "disabled",
      "already-running",
    ] as const) {
      sdk.ad = ad;
      await expect(platform.showRewarded()).resolves.toMatchObject({ rewarded: false });
    }
  });

  it("a duplicate reward event grants once", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "duplicate";
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: true });
    await flush();
    expect(seen).not.toContain("ad:late-reward");
  });

  it("a stray reward after the flow ended grants nothing", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "reward-after-end";
    await expect(platform.showRewarded()).resolves.toEqual({ shown: true, rewarded: false });
    await flush();
    expect(sdk.sent).toContain("SDK_REWARDED_WATCH_COMPLETE");
    expect(seen).not.toContain("ad:late-reward");
  });

  it("an interstitial's stray reward event grants nothing", async () => {
    const { platform, sdk, seen } = await ready();
    sdk.ad = "manual";
    const result = platform.showInterstitial();
    sdk.emit("SDK_GAME_PAUSE");
    sdk.emit("SDK_REWARDED_WATCH_COMPLETE");
    sdk.emit("SDK_GAME_START");
    await expect(result).resolves.toEqual({ shown: true });
    expect(seen).not.toContain("ad:late-reward");
  });

  it("late reward: a reward after the request answered is announced once, never granted twice", async () => {
    const { platform, sdk, timers, seen } = await ready();
    sdk.ad = "manual";
    const result = platform.showRewarded();
    sdk.emit("SDK_GAME_PAUSE");
    timers.advance(90_000); // the hand-back was lost; the adapter gives the game back
    await expect(result).resolves.toEqual({ shown: true, rewarded: false });
    sdk.emit("SDK_REWARDED_WATCH_COMPLETE");
    sdk.emit("SDK_REWARDED_WATCH_COMPLETE");
    sdk.emit("SDK_GAME_START");
    sdk.settle("resolve");
    await flush();
    expect(seen.filter((e) => e === "ad:late-reward")).toHaveLength(1);
  });

  it("a reward mid-ad (the SDK's 30 s guaranteed reward) is granted with the answer", async () => {
    const { platform, sdk } = await ready();
    sdk.ad = "manual";
    const result = platform.showRewarded();
    sdk.emit("SDK_GAME_PAUSE");
    sdk.emit("SDK_REWARDED_WATCH_COMPLETE");
    sdk.emit("SDK_GAME_START");
    await expect(result).resolves.toEqual({ shown: true, rewarded: true });
  });

  it("rewarded availability is re-checked after every rewarded ad", async () => {
    const { platform, sdk } = await ready();
    sdk.rewardedEnabled = false;
    await platform.showRewarded();
    await flush();
    expect(sdk.calls.filter((c) => c === "preloadAd:rewarded")).toHaveLength(2);
    expect(platform.adAvailability("rewarded")).toBe("disabled");
  });
});

describe("GameDistribution — the game is never left paused", () => {
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

  const game = () => {
    const g = new Game({ scheduler: new ManualScheduler() });
    g.start();
    return g;
  };

  it("paused and muted for the whole ad, resumed and unmuted after", async () => {
    const { platform } = await ready();
    const g = game();
    const mutes: boolean[] = [];
    bindPlatform(g, platform, { onAudioMutedChange: (m) => mutes.push(m) });
    platform.gameplayStart();
    let pausedDuringAd = false;
    const result = await withAdBreak(g, platform, () =>
      platform.showRewarded({ onStart: () => (pausedDuringAd = g.paused) }),
    );
    expect(result.rewarded).toBe(true);
    expect(pausedDuringAd).toBe(true);
    expect(g.paused).toBe(false);
    expect(mutes).toEqual([true, false]);
    expect(platform.gameplayActive).toBe(true);
  });

  it("the portal's own pause pauses the game until SDK_GAME_START", async () => {
    const { platform, sdk } = await ready();
    const g = game();
    bindPlatform(g, platform);
    sdk.emit("SDK_GAME_PAUSE");
    expect(g.paused).toBe(true);
    sdk.emit("SDK_GAME_START");
    expect(g.paused).toBe(false);
  });

  it("a lost SDK_GAME_START during an ad does not strand the game", async () => {
    const { platform, sdk, timers } = await ready();
    const g = game();
    bindPlatform(g, platform);
    sdk.ad = "stall-open";
    const result = withAdBreak(g, platform, () => platform.showInterstitial());
    await flush();
    expect(g.paused).toBe(true);
    timers.advance(90_000);
    await result;
    expect(g.paused).toBe(false);
  });

  it("an ad that starts after the game gave up on it still pauses the game, then resumes it", async () => {
    const { platform, sdk, timers } = await ready();
    const g = game();
    bindPlatform(g, platform);
    platform.gameplayStart();
    sdk.ad = "manual";
    const result = withAdBreak(g, platform, () => platform.showInterstitial());
    timers.advance(10_000);
    await result;
    expect(g.paused).toBe(false);
    sdk.emit("SDK_GAME_PAUSE");
    expect(g.paused).toBe(true);
    sdk.emit("SDK_GAME_START");
    expect(g.paused).toBe(false);
  });
});

describe("GameDistribution — self-hosting (gd_sdk_referrer_url)", () => {
  it("absent: GameDistribution-hosted or local development", () => {
    expect(readHosting("", false)).toEqual({ framed: false, referrer: "absent" });
    expect(readHosting("?foo=1", true)).toEqual({ framed: true, referrer: "absent" });
  });

  it("valid only when framed, matched case-insensitively as the SDK does", () => {
    const ref = encodeURIComponent("https://publisher.example/games/g");
    expect(readHosting(`?gd_sdk_referrer_url=${ref}`, true).referrer).toBe("valid");
    expect(readHosting(`?GD_SDK_REFERRER_URL=${ref}`, true).referrer).toBe("valid");
  });

  it("ignored at the top level — the SDK replaces it with the page URL at depth 0", () => {
    const ref = encodeURIComponent("https://publisher.example/");
    expect(readHosting(`?gd_sdk_referrer_url=${ref}`, false).referrer).toBe("ignored");
  });

  it("malformed values are reported, never repaired", () => {
    for (const value of ["", "publisher", "javascript:alert(1)", "%%%"]) {
      expect(readHosting(`?gd_sdk_referrer_url=${value}`, true).referrer).toBe("malformed");
    }
  });

  it("the adapter reports hosting and never changes SDK behaviour for it", async () => {
    const hosting = { framed: true, referrer: "malformed" } as const;
    const { platform } = await ready({ hosting });
    expect(platform.hosting).toEqual(hosting);
    expect(platform.sdkState).toBe("ready");
  });
});
