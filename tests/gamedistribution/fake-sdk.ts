// A deterministic GameDistribution SDK, for node and for the in-browser SDK matrix.
//
// It implements only what the adapter calls — window.gdsdk.showAd(type) / preloadAd(type) and
// GD_OPTIONS.onEvent — and emits the documented events in the order GD-HTML5 1.43.58 emits
// them (docs/platforms/gamedistribution.md, "Event order"). Nothing is loaded and no request
// is made. Plain TypeScript with no test-runner imports, so tests/sdk/portals.ts can use it in
// the browser.
//
// Every event is delivered on its own microtask, so the adapter sees the same interleaving
// it would with the real SDK (events, then the settled showAd promise) and a test can still
// run it to completion with `await flush()`.
//
// Boot scripts — how the SDK behaves once loaded:
//   ready        SDK_READY
//   twice        SDK_READY, SDK_READY
//   error        SDK_ERROR (an init failure)
//   error-ready  SDK_ERROR, then SDK_READY (a non-fatal error)
//   never        nothing — the test raises SDK_READY itself (a late SDK), or never does
//   unavailable  the loader resolves null (script blocked, offline)
//   throws       the loader rejects
//
// Ad scripts — how the next showAd goes:
//   complete         pause, (reward), resume, resolves — a full view
//   no-fill          AD_ERROR, resume, resolves; no pause
//   closed-early     pause, USER_CLOSE, resume, resolves; no reward
//   error            AD_ERROR, resume, rejects — the SDK failed before anything played
//   error-mid-ad     pause, AD_ERROR, resume, resolves — the ad broke while on screen
//   too-soon         resume, rejects "The advertisement was requested too soon."
//   disabled         resume, rejects "Advertisements are disabled."
//   already-running  AD_IS_ALREADY_RUNNING, resolves
//   duplicate        complete, with every SDK_* event sent twice
//   reward-after-end pause, resume, resolves, then a stray SDK_REWARDED_WATCH_COMPLETE
//   no-resume        pause, (reward), resolves — SDK_GAME_START never comes
//   stall            nothing, and the promise never settles
//   stall-open       pause, then nothing, and the promise never settles
//   manual           nothing; the test drives it with emit() and settle()

import type {
  GameDistributionAdType,
  GameDistributionOptions,
  GameDistributionSdk,
  GameDistributionSdkLoader,
} from "@wgf/platform-sdk";

export type GdBootScript =
  "ready" | "twice" | "error" | "error-ready" | "never" | "unavailable" | "throws";

export type GdAdScript =
  | "complete"
  | "no-fill"
  | "closed-early"
  | "error"
  | "error-mid-ad"
  | "too-soon"
  | "disabled"
  | "already-running"
  | "duplicate"
  | "reward-after-end"
  | "no-resume"
  | "stall"
  | "stall-open"
  | "manual";

export interface FakeGdOptions {
  readonly boot?: GdBootScript;
  readonly ad?: GdAdScript;
  /** Whether preloadAd("rewarded") resolves — the developer panel's rewarded flag. */
  readonly rewardedEnabled?: boolean;
}

const tick = (): Promise<void> => Promise.resolve();

/** Let every queued event and promise continuation run. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await tick();
}

export class FakeGdSdk implements GameDistributionSdk {
  /** showAd/preloadAd calls, as `showAd:<type>` / `preloadAd:<type>`. */
  readonly calls: string[] = [];
  /** Every event sent to onEvent, in order. */
  readonly sent: string[] = [];
  ad: GdAdScript;
  rewardedEnabled: boolean;
  options: GameDistributionOptions | null = null;
  #settle: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;

  constructor(options: FakeGdOptions = {}) {
    this.ad = options.ad ?? "complete";
    this.rewardedEnabled = options.rewardedEnabled ?? true;
  }

  /** Send an event to GD_OPTIONS.onEvent, as the SDK does. */
  emit(name: string, message = ""): void {
    this.sent.push(name);
    this.options?.onEvent({ name, message, status: "success" });
  }

  /** Settle the showAd promise of a "manual" (or stalled) ad. */
  settle(outcome: "resolve" | "reject", message = "manual"): void {
    const pending = this.#settle;
    this.#settle = null;
    if (outcome === "resolve") pending?.resolve(undefined);
    else pending?.reject(message);
  }

  preloadAd(type: GameDistributionAdType = "rewarded"): Promise<unknown> {
    this.calls.push(`preloadAd:${type}`);
    return type === "rewarded" && !this.rewardedEnabled
      ? Promise.reject("Rewarded ads are disabled.")
      : Promise.resolve("gdsdk://preloaded");
  }

  showAd(type: GameDistributionAdType = "interstitial"): Promise<unknown> {
    this.calls.push(`showAd:${type}`);
    const script = this.ad;
    const rewarded = type === "rewarded";
    return new Promise((resolve, reject) => {
      this.#settle = { resolve, reject };
      void this.#play(script, rewarded, resolve, reject);
    });
  }

  async #play(
    script: GdAdScript,
    rewarded: boolean,
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void,
  ): Promise<void> {
    const send = async (...names: string[]): Promise<void> => {
      for (const name of names) {
        await tick();
        this.emit(name);
      }
    };
    const twice = script === "duplicate";
    const sdk = async (name: string): Promise<void> => send(...(twice ? [name, name] : [name]));
    switch (script) {
      case "complete":
      case "duplicate":
      case "no-resume":
        await sdk("SDK_GAME_PAUSE");
        await send("CONTENT_PAUSE_REQUESTED", "STARTED", "COMPLETE");
        if (rewarded) await sdk("SDK_REWARDED_WATCH_COMPLETE");
        await send("ALL_ADS_COMPLETED", "CONTENT_RESUME_REQUESTED");
        if (script !== "no-resume") await sdk("SDK_GAME_START");
        await tick();
        return resolve({ args: { success: true } });
      case "no-fill":
        await send("AD_ERROR", "SDK_GAME_START");
        await tick();
        return resolve({ args: { success: false } });
      case "closed-early":
        await send("SDK_GAME_PAUSE", "CONTENT_PAUSE_REQUESTED", "STARTED", "USER_CLOSE");
        await send("CONTENT_RESUME_REQUESTED", "SDK_GAME_START");
        await tick();
        return resolve({ args: { success: false } });
      case "error":
        await send("AD_ERROR", "SDK_GAME_START");
        await tick();
        return reject("An error occurred while requesting the advertisement.");
      case "error-mid-ad":
        await send("SDK_GAME_PAUSE", "CONTENT_PAUSE_REQUESTED", "AD_ERROR");
        await send("CONTENT_RESUME_REQUESTED", "SDK_GAME_START");
        await tick();
        return resolve({ args: { success: false } });
      case "too-soon":
        await send("AD_ERROR", "SDK_GAME_START");
        await tick();
        return reject("The advertisement was requested too soon.");
      case "disabled":
        await send("AD_ERROR", "SDK_GAME_START");
        await tick();
        return reject("Advertisements are disabled.");
      case "already-running":
        await send("AD_IS_ALREADY_RUNNING");
        await tick();
        return resolve(undefined);
      case "reward-after-end":
        await send("SDK_GAME_PAUSE", "SDK_GAME_START");
        await tick();
        resolve({ args: { success: true } });
        await flush();
        this.emit("SDK_REWARDED_WATCH_COMPLETE");
        return;
      case "stall-open":
        await send("SDK_GAME_PAUSE");
        return;
      case "stall":
      case "manual":
        return;
    }
  }
}

/** The loader seam: installs GD_OPTIONS on the fake and boots it per `boot`. */
export function fakeLoader(
  sdk: FakeGdSdk,
  boot: GdBootScript = "ready",
): GameDistributionSdkLoader {
  return async (options) => {
    if (boot === "unavailable") return null;
    if (boot === "throws") throw new Error("main.min.js blocked (fake)");
    sdk.options = options;
    // The real SDK raises its boot events after its own async init, never synchronously
    // from the script tag's load.
    void (async () => {
      await tick();
      if (boot === "ready" || boot === "twice") sdk.emit("SDK_READY");
      if (boot === "twice") sdk.emit("SDK_READY");
      if (boot === "error" || boot === "error-ready") sdk.emit("SDK_ERROR", "fake init error");
      if (boot === "error-ready") sdk.emit("SDK_READY");
    })();
    return sdk;
  };
}

/** A Game ID shaped like a real one. Not a real title. */
export const TEST_GD_GAME_ID = "0123456789abcdef0123456789abcdef";
