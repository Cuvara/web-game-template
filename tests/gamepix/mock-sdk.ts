// A deterministic stand-in for GamePix's SDK
// (https://integration.gamepix.com/sdk/v3/gamepix.sdk.js). Never contacts GamePix.
//
// Two forms of the same behaviour:
//
//   createGamePixMock()  for Node — plugs into GamePixPlatform's `loadSdk` seam and is driven
//                        by the test's own timers, so every delay is exact.
//   MOCK_SDK_SOURCE      for the browser — served by page.route in place of the real script,
//                        which the build puts first in <head>; it defines window.GamePix.
//
// Only the documented surface (https://partners.gamepix.com/sdk/doc/javascript) exists:
// loading(n), loaded(), interstitialAd(), rewardAd(), lang(), localStorage. The mock also
// enforces the documented misuse errors, recording each as a violation instead of throwing,
// so a test asserts there were none:
//
//   GAMEPIX_LOADED_NOT_CALLED                   any call but loading()/lang() before loaded()
//   LOADED_ALREADY_CALLED                       loaded() twice
//   LOADING_VALUE_IS_NOT_A_NUMBER               loading() with a non-integer or out of 0-100
//   INTERSTITIAL_AD_CALLED_TWICE                interstitialAd() before the last one settled
//   REWARD_AD_CALLED_TWICE                      rewardAd() before the last one settled
//   KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING  a non-string key or value

import type { GamePixSdk, GamePixSdkLoader } from "@wgf/platform-sdk";

/** How the SDK boots. */
export type GpSdkMode =
  | "ready" // the script ran; window.GamePix is there
  | "missing" // the script never loaded (ad blocker, offline, a local run)
  | "loaded-throws" // the script ran, loaded() throws: the SDK refused to start
  | "loader-throws"; // the loader itself throws

/** How the SDK answers the next ad call. */
export type GpAdScript =
  | "play" // resolves { success: true }
  | "no-fill" // resolves { success: false }: "not every interstitialAd() will trigger an ad"
  | "closed-early" // resolves { success: false }: a rewarded ad not watched to the end
  | "reject" // the promise rejects
  | "throw" // the call throws
  | "stall" // the promise never settles
  | "late"; // resolves { success: true } after `lateMs`

export interface MockTimers {
  setTimeout(handler: () => void, ms: number): unknown;
}

export interface GamePixMockOptions {
  readonly sdk?: GpSdkMode;
  readonly ad?: GpAdScript;
  readonly timers: MockTimers;
  readonly lang?: unknown;
  readonly lateMs?: number;
}

export interface GamePixMock {
  readonly loadSdk: GamePixSdkLoader;
  readonly sdk: GamePixSdk;
  /** Calls the SDK received, in order: "load", "loading:<n>", "loaded", "interstitialAd", … */
  readonly calls: string[];
  /** The documented misuse errors the adapter caused. Must stay empty. */
  readonly violations: string[];
  /** GamePix.localStorage's contents. */
  readonly store: Map<string, string>;
  setAd(script: GpAdScript): void;
}

export function createGamePixMock(options: GamePixMockOptions): GamePixMock {
  const calls: string[] = [];
  const violations: string[] = [];
  const store = new Map<string, string>();
  const mode = options.sdk ?? "ready";
  let ad: GpAdScript = options.ad ?? "play";
  let loaded = false;
  const pending = { interstitialAd: false, rewardAd: false };

  const needsLoaded = (): void => {
    if (!loaded) violations.push("GAMEPIX_LOADED_NOT_CALLED");
  };
  const strings = (...values: unknown[]): boolean => {
    if (values.every((v) => typeof v === "string")) return true;
    violations.push("KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING");
    return false;
  };

  const adCall = (name: "interstitialAd" | "rewardAd"): Promise<{ success: boolean }> => {
    calls.push(name);
    needsLoaded();
    if (pending[name]) {
      violations.push(
        name === "rewardAd" ? "REWARD_AD_CALLED_TWICE" : "INTERSTITIAL_AD_CALLED_TWICE",
      );
    }
    if (ad === "throw") throw new Error(`${name} failed (mock)`);
    pending[name] = true;
    const done = <T>(value: T): T => {
      pending[name] = false;
      return value;
    };
    switch (ad) {
      case "play":
        return Promise.resolve(done({ success: true }));
      case "no-fill":
      case "closed-early":
        return Promise.resolve(done({ success: false }));
      case "reject":
        return Promise.reject(new Error(`${name} rejected (mock)`)).finally(() => done(null));
      case "stall":
        return new Promise(() => {});
      case "late":
        return new Promise((resolve) => {
          options.timers.setTimeout(
            () => resolve(done({ success: true })),
            options.lateMs ?? 70_000,
          );
        });
    }
  };

  const sdk: GamePixSdk = {
    loading(value: number) {
      calls.push(`loading:${value}`);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        violations.push("LOADING_VALUE_IS_NOT_A_NUMBER");
      }
      if (loaded) violations.push("LOADING_AFTER_LOADED");
    },
    loaded() {
      calls.push("loaded");
      if (loaded) violations.push("LOADED_ALREADY_CALLED");
      loaded = true;
      if (mode === "loaded-throws") throw new Error("loaded failed (mock)");
    },
    interstitialAd: () => adCall("interstitialAd"),
    rewardAd: () => adCall("rewardAd"),
    lang() {
      calls.push("lang");
      return options.lang ?? "en";
    },
    localStorage: {
      getItem(key) {
        needsLoaded();
        strings(key);
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        needsLoaded();
        if (strings(key, value)) store.set(key, value);
      },
      removeItem(key) {
        needsLoaded();
        strings(key);
        store.delete(key);
      },
    },
  };

  const loadSdk: GamePixSdkLoader = () => {
    calls.push("load");
    if (mode === "loader-throws") throw new Error("loader failed (mock)");
    return Promise.resolve(mode === "missing" ? null : sdk);
  };

  return { loadSdk, sdk, calls, violations, store, setAd: (script) => (ad = script) };
}

/**
 * The browser form. Configure before the page loads with `window.__gpMock = { ad, lang }`
 * (ad: play | no-fill | closed-early | reject | stall). Records SDK calls to window.__gpCalls
 * and documented misuse errors to window.__gpViolations; window.__gpSetAd(ad) re-scripts it.
 */
export const MOCK_SDK_SOURCE = String.raw`
(() => {
  const config = Object.assign({ ad: "play", lang: "en" }, window.__gpMock || {});
  const calls = (window.__gpCalls = []);
  const violations = (window.__gpViolations = []);
  const store = new Map();
  let loaded = false;
  const pending = { interstitialAd: false, rewardAd: false };
  const needsLoaded = () => {
    if (!loaded) violations.push("GAMEPIX_LOADED_NOT_CALLED");
  };
  window.__gpSetAd = (ad) => (config.ad = ad);
  // Where the script sits: the documented integration puts it before every other script.
  calls.push(document.currentScript && document.currentScript === document.scripts[0] ? "first-script" : "not-first-script");
  const adCall = (name) => {
    calls.push(name);
    needsLoaded();
    if (pending[name]) violations.push(name === "rewardAd" ? "REWARD_AD_CALLED_TWICE" : "INTERSTITIAL_AD_CALLED_TWICE");
    pending[name] = true;
    const ad = config.ad;
    if (ad === "stall") return new Promise(() => {});
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        pending[name] = false;
        if (ad === "reject") reject(new Error("rejected (mock)"));
        else resolve({ success: ad === "play" });
      }, 200),
    );
  };
  window.GamePix = {
    loading(value) {
      calls.push("loading:" + value);
      if (!Number.isInteger(value) || value < 0 || value > 100) violations.push("LOADING_VALUE_IS_NOT_A_NUMBER");
      if (loaded) violations.push("LOADING_AFTER_LOADED");
    },
    loaded() {
      calls.push("loaded");
      if (loaded) violations.push("LOADED_ALREADY_CALLED");
      loaded = true;
    },
    interstitialAd: () => adCall("interstitialAd"),
    rewardAd: () => adCall("rewardAd"),
    lang() {
      calls.push("lang");
      return config.lang;
    },
    happyMoment() {},
    updateScore() {},
    updateLevel() {},
    localStorage: {
      getItem(key) {
        needsLoaded();
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        needsLoaded();
        if (typeof key !== "string" || typeof value !== "string") violations.push("KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING");
        else store.set(key, value);
      },
      removeItem(key) {
        needsLoaded();
        store.delete(key);
      },
    },
  };
})();
`;
