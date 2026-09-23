// Poki — https://developers.poki.com/
//
// The adapter is written against Poki's current HTML5 SDK documentation
// (https://developers.poki.com/guide/sdk-html5) and its requirements page
// (https://developers.poki.com/guide/requirements-quality). Every SDK method called here is
// one those pages document; none is guessed from the loader's source.
//
// What the adapter guarantees, whatever the game does:
//
//   - gameLoadingFinished is sent once, before any gameplay event.
//   - gameplayStart/gameplayStop are never sent twice in a row and never during an ad.
//   - an ad break that interrupts running gameplay is preceded by gameplayStop.
//   - no ad ever throws, and none hangs the game when the SDK is blocked.
//
// What it deliberately does not do:
//
//   - call gameplayStart on the game's behalf. Poki's rule is that it fires on the first
//     player input, not on load, and only the game knows when that is.
//   - rate-limit commercial breaks. "Don't implement internal ad timers; rely on Poki's
//     system" — Poki decides whether a commercialBreak shows anything.
//
// The SDK is Poki's own script from Poki's CDN. It is the one external request a Poki build
// makes, and it is loaded only by this adapter, only when a build targets Poki.

import { AdPolicy } from "../ad-policy.js";
import { PlatformEmitter } from "../emitter.js";
import { GameplayLifecycle, type RejectedCall } from "../lifecycle.js";
import { LocalStorageBackend } from "../storage.js";
import { UsageRecorder, type PlatformUsage } from "../usage.js";
import type {
  AdHooks,
  AdKind,
  AdResult,
  AdSkipReason,
  Platform,
  PlatformCapabilities,
  PlatformEvents,
  PlatformStorage,
  RewardedResult,
} from "../types.js";

/** The documented loader. Poki serves the current SDK version behind it. */
export const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

export const POKI_CAPABILITIES: PlatformCapabilities = {
  ads: ["interstitial", "rewarded"],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "platform-provided",
  loadingApi: "required",
  // Poki's requirements say not to implement internal ad timers: the SDK decides whether a
  // commercialBreak plays. A local minimum interval would suppress breaks Poki wanted.
  interstitialMinIntervalS: null,
};

/** The subset of window.PokiSDK this adapter uses — every member is documented by Poki. */
export interface PokiSdk {
  init(): Promise<unknown>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<unknown>;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
}

/** Resolves the SDK, or null when it cannot be loaded (offline, ad blocker, CSP). */
export type PokiSdkLoader = () => Promise<PokiSdk | null>;

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

/** Injects Poki's loader script once and resolves window.PokiSDK when it has run. */
export function loadPokiSdkScript(url: string = POKI_SDK_URL): Promise<PokiSdk | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  if (window.PokiSDK) return Promise.resolve(window.PokiSDK);
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
  if (existing) {
    // A synchronous <head> tag, as Poki documents it, has already run by the time any
    // module executes; no SDK means it was blocked, and asking again only adds a second
    // failed request. An async, deferred or module tag may still be loading: wait for it.
    // The adapter's init deadline bounds the wait.
    const pending = existing.async || existing.defer || existing.type === "module";
    if (!pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(window.PokiSDK ?? null), { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve(window.PokiSDK ?? null);
    // An ad blocker blocking the loader lands here. The game must stay playable, so this
    // resolves rather than rejects and the adapter carries on without an SDK.
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

export interface PokiOptions {
  /** Storage namespace. Use the game id. */
  readonly namespace: string;
  /** How to obtain the SDK. Defaults to injecting Poki's loader script. */
  readonly loadSdk?: PokiSdkLoader;
  /**
   * How long initialize() waits for PokiSDK.init() before continuing without ads. Poki's
   * loader queues calls until its core script arrives; if a blocker stops that script, the
   * queue never drains and init never settles. The game must boot anyway.
   */
  readonly initTimeoutMs?: number;
  /** Replaces setTimeout for the init deadline. Tests inject a controllable one. */
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  /** Replaces localStorage-backed storage. */
  readonly storage?: PlatformStorage;
  /** Receives every lifecycle call the adapter refused to forward. Defaults to nothing. */
  readonly onRejected?: (rejected: RejectedCall) => void;
}

/**
 * Calls the adapter made, in order. Lifecycle events are recorded even when the SDK could
 * not be loaded, so the sequence the game produced is visible either way.
 */
export type PokiSdkCall =
  | "init"
  | "gameLoadingFinished"
  | "gameplayStart"
  | "gameplayStop"
  | "commercialBreak"
  | "rewardedBreak";

export type PokiSdkState = "not-initialized" | "loading" | "ready" | "unavailable";

// Poki: "Players tend to move to another game if loading takes more than 10 seconds." The
// deadline runs alongside the game's own loading, not before it, and must leave room for it.
const DEFAULT_INIT_TIMEOUT_MS = 5_000;

export class PokiPlatform implements Platform {
  readonly id = "poki";
  readonly capabilities = POKI_CAPABILITIES;
  readonly storage: PlatformStorage;
  /**
   * Poki's HTML5 documentation defines no language call, so the adapter does not guess one;
   * the game follows the browser.
   */
  readonly language = null;

  readonly #ads = new AdPolicy(POKI_CAPABILITIES);
  readonly #events = new PlatformEmitter();
  #foreground = true;
  readonly #usage = new UsageRecorder();
  readonly #lifecycle: GameplayLifecycle;
  readonly #loadSdk: PokiSdkLoader;
  readonly #initTimeoutMs: number;
  readonly #setTimeout: (callback: () => void, ms: number) => unknown;
  readonly #calls: PokiSdkCall[] = [];

  #sdk: PokiSdk | null = null;
  #state: PokiSdkState = "not-initialized";
  #initializing: Promise<void> | null = null;
  #loadingFraction = 0;

  constructor(options: PokiOptions) {
    this.storage = options.storage ?? new LocalStorageBackend(options.namespace);
    this.#loadSdk = options.loadSdk ?? (() => loadPokiSdkScript());
    this.#initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.#setTimeout = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
    // Silent by default: a production build must not log (Poki asks for a clean build).
    // Refused calls stay readable through `rejectedCalls`.
    this.#lifecycle = new GameplayLifecycle(options.onRejected);
  }

  get usage(): PlatformUsage {
    return this.#usage.snapshot();
  }

  /** Calls made to the SDK (or that would have been, without one), oldest first. */
  get sdkCalls(): readonly PokiSdkCall[] {
    return [...this.#calls];
  }

  /** Lifecycle calls the game made that were not forwarded, and why. */
  get rejectedCalls(): readonly RejectedCall[] {
    return this.#lifecycle.rejected;
  }

  get sdkState(): PokiSdkState {
    return this.#state;
  }

  get loadingFraction(): number {
    return this.#loadingFraction;
  }

  get gameplayActive(): boolean {
    return this.#lifecycle.playing;
  }

  /** False while a Poki ad is on screen. */
  get foreground(): boolean {
    return this.#foreground;
  }

  on<K extends keyof PlatformEvents>(
    event: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): () => void {
    return this.#events.on(event, handler);
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  async #initialize(): Promise<void> {
    this.#state = "loading";
    const connected = this.#connect();
    const deadline = new Promise<"timeout">((resolve) => {
      this.#setTimeout(() => resolve("timeout"), this.#initTimeoutMs);
    });
    if ((await Promise.race([connected, deadline])) === "timeout" && this.#state === "loading") {
      // Boot without ads. #connect still finishes in the background if it can.
      this.#state = "unavailable";
    }
  }

  /** Load the SDK and init it. True once the SDK is usable. */
  async #connect(): Promise<boolean> {
    let sdk: PokiSdk | null = null;
    try {
      sdk = await this.#loadSdk();
    } catch {
      sdk = null;
    }
    if (!sdk) {
      this.#state = "unavailable";
      return false;
    }

    this.#calls.push("init");
    try {
      await sdk.init();
    } catch {
      // Poki's documented pattern: `PokiSDK.init().then(...).catch(() => { load game
      // anyway })`. A rejection — typically an ad blocker — still leaves an SDK whose ad
      // calls resolve without an ad. Only an init that never settles is unusable, and the
      // deadline in #initialize covers that.
    }

    this.#sdk = sdk;
    this.#state = "ready";
    // Connected after the deadline: the game has moved on without the SDK. Tell it where
    // the game is now, so it does not see gameplay events without a loading-finished.
    if (this.#lifecycle.loaded) sdk.gameLoadingFinished();
    if (this.#lifecycle.playing) sdk.gameplayStart();
    return true;
  }

  reportLoadingProgress(fraction: number): void {
    // Poki's current HTML5 documentation defines no progress call — only
    // gameLoadingFinished — so progress is recorded locally and not forwarded.
    this.#loadingFraction = Math.min(Math.max(fraction, 0), 1);
    this.#usage.recordLoadingProgress();
  }

  signalReady(): Promise<void> {
    this.#loadingFraction = 1;
    this.#usage.recordSignalReady();
    if (this.#lifecycle.loadingFinished()) this.#send("gameLoadingFinished");
    return Promise.resolve();
  }

  gameplayStart(): void {
    if (this.#lifecycle.start()) this.#send("gameplayStart");
  }

  gameplayStop(): void {
    if (this.#lifecycle.stop()) this.#send("gameplayStop");
  }

  async showInterstitial(hooks?: AdHooks): Promise<AdResult> {
    const outcome = await this.#adBreak("interstitial", hooks);
    return outcome.shown ? { shown: true } : { shown: false, reason: outcome.reason };
  }

  async showRewarded(hooks?: AdHooks): Promise<RewardedResult> {
    const outcome = await this.#adBreak("rewarded", hooks);
    if (outcome.shown || outcome.rewarded) {
      return { shown: outcome.shown, rewarded: outcome.rewarded };
    }
    return { shown: false, rewarded: false, reason: outcome.reason };
  }

  async #adBreak(
    kind: AdKind,
    hooks: AdHooks | undefined,
  ): Promise<{ shown: boolean; rewarded: boolean; reason: AdSkipReason }> {
    this.#usage.recordAdRequested(kind);

    const refused = this.#ads.check(kind);
    if (refused) return { shown: false, rewarded: false, reason: refused };

    const call = kind === "rewarded" ? "rewardedBreak" : "commercialBreak";
    const decision = this.#lifecycle.beginAd(call);
    if (!decision.allowed) return { shown: false, rewarded: false, reason: "busy" };

    try {
      if (decision.stopFirst) this.#send("gameplayStop");

      const sdk = this.#sdk;
      if (!sdk || this.#state !== "ready") {
        return { shown: false, rewarded: false, reason: "not-ready" };
      }

      let started = false;
      const onStart = (): void => {
        started = true;
        this.#foreground = false;
        this.#events.emit("foreground:lost", undefined);
        this.#events.emit("ad:start", { kind });
        hooks?.onStart?.();
      };

      this.#send(call);
      try {
        if (kind === "rewarded") {
          const success = (await sdk.rewardedBreak(onStart)) === true;
          if (started) this.#played(kind);
          // Grant on Poki's own success flag only. Under an ad blocker it is false, and
          // Poki's guidelines say no reward is given then.
          return { shown: started, rewarded: success, reason: "not-ready" };
        }
        await sdk.commercialBreak(onStart);
        if (started) this.#played(kind);
        return { shown: started, rewarded: false, reason: "not-ready" };
      } catch {
        return { shown: started, rewarded: false, reason: "error" };
      }
    } finally {
      this.#lifecycle.endAd();
      if (!this.#foreground) {
        this.#foreground = true;
        this.#events.emit("ad:end", { kind });
        this.#events.emit("foreground:gained", undefined);
      }
    }
  }

  #played(kind: AdKind): void {
    this.#usage.recordAdShown(kind);
    this.#ads.record(kind);
  }

  /** Records a call and forwards it when the SDK is present. Ad breaks are invoked by #adBreak. */
  #send(call: PokiSdkCall): void {
    this.#calls.push(call);
    const sdk = this.#sdk;
    if (call === "gameLoadingFinished") sdk?.gameLoadingFinished();
    else if (call === "gameplayStart") sdk?.gameplayStart();
    else if (call === "gameplayStop") sdk?.gameplayStop();
  }
}
