// A deterministic stand-in for GameMonetize's SDK (https://api.gamemonetize.com/sdk.js).
//
// Two forms of the same behaviour:
//
//   createGameMonetizeMock()  for Node — plugs into GameMonetizePlatform's `loadSdk` seam and
//                             is driven by the test's own timers, so every delay is exact.
//   MOCK_SDK_SOURCE           for the browser — served by page.route in place of the real
//                             script, it reads window.SDK_OPTIONS exactly as the documented
//                             integration requires, so the adapter's real script loader runs.
//
// Only the documented surface exists: SDK_OPTIONS { gameId, onEvent }, the events SDK_READY,
// SDK_ERROR, SDK_GAME_PAUSE, SDK_GAME_START, and sdk.showBanner(). No rewarded API is
// implemented because GameMonetize documents none.

import type {
  GameMonetizeSdk,
  GameMonetizeSdkLoader,
  GameMonetizeSdkOptions,
} from "@wgf/platform-sdk";

/** How the SDK boots. */
export type GmSdkMode =
  | "ready" // loads, SDK_READY at once
  | "delayed" // loads, SDK_READY after `readyDelayMs`
  | "missing" // the script never loads (ad blocker, offline)
  | "init-error" // loads, SDK_ERROR instead of SDK_READY
  | "silent" // loads, never raises SDK_READY
  | "loader-throws"; // the loader itself throws

/** How the SDK answers the next showBanner(). */
export type GmAdScript =
  | "play" // SDK_GAME_PAUSE, then SDK_GAME_START
  | "async-play" // the same, each in a later microtask
  | "no-fill" // SDK_GAME_START without a pause: nothing to show
  | "error" // SDK_ERROR, then SDK_GAME_START (the real SDK's "no worries, resume")
  | "error-after-start" // SDK_GAME_PAUSE, SDK_ERROR, SDK_GAME_START
  | "silent" // no answer at all: a premature call the SDK rejected quietly
  | "stall" // SDK_GAME_PAUSE and nothing after: SDK_GAME_START is lost
  | "duplicate" // SDK_GAME_PAUSE twice, SDK_GAME_START twice
  | "late" // SDK_GAME_PAUSE after `lateMs`, SDK_GAME_START `adMs` later
  | "throw"; // showBanner() throws

export interface MockTimers {
  setTimeout(handler: () => void, ms: number): unknown;
}

export interface GameMonetizeMockOptions {
  readonly sdk?: GmSdkMode;
  readonly ad?: GmAdScript;
  readonly timers: MockTimers;
  readonly readyDelayMs?: number;
  readonly lateMs?: number;
  readonly adMs?: number;
}

export interface GameMonetizeMock {
  readonly loadSdk: GameMonetizeSdkLoader;
  /** Calls the SDK received, in order: "load", "showBanner". */
  readonly calls: string[];
  /** The SDK_OPTIONS the adapter handed over, once loaded. */
  readonly received: () => GameMonetizeSdkOptions | null;
  setAd(script: GmAdScript): void;
  /** Raise any event, as the SDK would — a preroll, a stray duplicate, a late answer. */
  emit(name: string): void;
}

export function createGameMonetizeMock(options: GameMonetizeMockOptions): GameMonetizeMock {
  const calls: string[] = [];
  const mode = options.sdk ?? "ready";
  let ad: GmAdScript = options.ad ?? "play";
  let received: GameMonetizeSdkOptions | null = null;
  const emit = (name: string): void => received?.onEvent({ name });
  const later = (ms: number, run: () => void): void => void options.timers.setTimeout(run, ms);

  const sdk: GameMonetizeSdk = {
    showBanner() {
      calls.push("showBanner");
      switch (ad) {
        case "play":
          emit("SDK_GAME_PAUSE");
          emit("SDK_GAME_START");
          return;
        case "async-play":
          queueMicrotask(() => {
            emit("SDK_GAME_PAUSE");
            queueMicrotask(() => emit("SDK_GAME_START"));
          });
          return;
        case "no-fill":
          emit("SDK_GAME_START");
          return;
        case "error":
          emit("SDK_ERROR");
          emit("SDK_GAME_START");
          return;
        case "error-after-start":
          emit("SDK_GAME_PAUSE");
          emit("SDK_ERROR");
          emit("SDK_GAME_START");
          return;
        case "silent":
          return;
        case "stall":
          emit("SDK_GAME_PAUSE");
          return;
        case "duplicate":
          emit("SDK_GAME_PAUSE");
          emit("SDK_GAME_PAUSE");
          emit("SDK_GAME_START");
          emit("SDK_GAME_START");
          return;
        case "late":
          later(options.lateMs ?? 15_000, () => {
            emit("SDK_GAME_PAUSE");
            later(options.adMs ?? 1_000, () => emit("SDK_GAME_START"));
          });
          return;
        case "throw":
          throw new Error("showBanner failed (mock)");
      }
    },
  };

  const loadSdk: GameMonetizeSdkLoader = (sdkOptions) => {
    calls.push("load");
    if (mode === "loader-throws") throw new Error("loader failed (mock)");
    if (mode === "missing") return Promise.resolve(null);
    received = sdkOptions;
    if (mode === "ready") emit("SDK_READY");
    if (mode === "init-error") emit("SDK_ERROR");
    if (mode === "delayed") later(options.readyDelayMs ?? 1_000, () => emit("SDK_READY"));
    return Promise.resolve(sdk);
  };

  return {
    loadSdk,
    calls,
    received: () => received,
    setAd: (script) => (ad = script),
    emit,
  };
}

/**
 * The browser form. Configure before the page loads with
 * `window.__gmMock = { sdk, ad, readyDelayMs, lateMs, adMs }` (same vocabulary as above,
 * "loader-throws" excepted — block the route for "missing"). Records to window.__gmCalls
 * and window.__gmEvents; window.__gmEmit(name) raises any event by hand.
 */
export const MOCK_SDK_SOURCE = String.raw`
(() => {
  const config = Object.assign(
    { sdk: "ready", ad: "play", readyDelayMs: 1000, lateMs: 15000, adMs: 300 },
    window.__gmMock || {},
  );
  const calls = (window.__gmCalls = []);
  const events = (window.__gmEvents = []);
  const options = window.SDK_OPTIONS;
  calls.push("load:" + (options && options.gameId ? "gameId" : "no-gameId"));
  const emit = (name) => {
    events.push(name);
    if (options && typeof options.onEvent === "function") options.onEvent({ name });
  };
  window.__gmEmit = emit;
  window.__gmSetAd = (ad) => (config.ad = ad);
  window.sdk = {
    showBanner() {
      calls.push("showBanner");
      const ad = config.ad;
      if (ad === "throw") throw new Error("showBanner failed (mock)");
      if (ad === "silent") return;
      if (ad === "no-fill") return setTimeout(() => emit("SDK_GAME_START"), 50);
      if (ad === "error") {
        return setTimeout(() => {
          emit("SDK_ERROR");
          emit("SDK_GAME_START");
        }, 50);
      }
      const start = ad === "late" ? config.lateMs : 50;
      setTimeout(() => {
        emit("SDK_GAME_PAUSE");
        if (ad === "duplicate") emit("SDK_GAME_PAUSE");
        if (ad === "error-after-start") emit("SDK_ERROR");
        if (ad === "stall") return;
        setTimeout(() => {
          emit("SDK_GAME_START");
          if (ad === "duplicate") emit("SDK_GAME_START");
        }, config.adMs);
      }, start);
    },
  };
  if (config.sdk === "ready") setTimeout(() => emit("SDK_READY"), 0);
  if (config.sdk === "delayed") setTimeout(() => emit("SDK_READY"), config.readyDelayMs);
  if (config.sdk === "init-error") setTimeout(() => emit("SDK_ERROR"), 0);
})();
`;
