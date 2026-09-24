// The slice of the Y8 JavaScript SDK this adapter uses, and how it gets loaded.
//
// Typed by hand from the official documentation, never from the minified script, and kept
// deliberately narrow: every member here is one the docs describe for the JavaScript
// platform. Leaderboards, achievements, images, profile, protection and analytics exist in
// the SDK but have no place in the Platform contract yet, so they are not typed or called.
//
//   https://docs.y8.com/sdk/intro/           script URL, y8sdk.ready, emitReadyEvent, init,
//                                            appConfig/adConfig, error shapes
//   https://docs.y8.com/platforms/           the one URL, never bundled
//   https://docs.y8.com/sdk/advertising/     showAd, placements, callbacks, breakStatus
//   https://docs.y8.com/sdk/cloud-storage/   saveData/loadData/removeData, 30 KB, retries
//   https://docs.y8.com/sdk/authentication/  onAuth, getUser (display data only)
//   https://docs.y8.com/sdk/localization/    getPlatformLocale
//
// Cross-checked on 2026-09-24 against the script served at Y8_SDK_URL (last-modified
// 2026-09-16): every member below exists with the documented shape.

/** The only URL the docs give. "Never bundle your own copy" — https://docs.y8.com/platforms/ */
export const Y8_SDK_URL = "https://cdn.y8.com/minimal-sdk/2-0/y8.min.js";

/** Dispatched on `window` when the script has loaded, and again on every emitReadyEvent(). */
export const Y8_READY_EVENT = "y8sdk.ready";

export interface Y8AppConfig {
  readonly appId: string;
  /** Default true. Off the game's own Y8 page auto sign-in never happens (local-development). */
  readonly autoLogin?: boolean;
}

export interface Y8AdConfig {
  readonly gameId: string;
  readonly preloadAdBreaks?: "on" | "off";
  readonly sound?: "on" | "off";
  readonly onReady?: () => void;
}

/**
 * Placements (https://docs.y8.com/sdk/advertising/#placements). `preroll` is deliberately
 * absent: "Requesting it from the SDK is not supported."
 */
export type Y8Placement = "start" | "pause" | "next" | "browse" | "reward";

/** The documented `breakStatus` values. Only `viewed` and `dismissed` mean an ad appeared. */
export type Y8BreakStatus =
  | "viewed"
  | "dismissed"
  | "noAdPreloaded"
  | "frequencyCapped"
  | "notReady"
  | "timeout"
  | "error"
  | "ignored"
  | "other";

export interface Y8BreakInfo {
  readonly breakType?: string;
  readonly breakName?: string;
  readonly breakFormat?: "interstitial" | "reward";
  readonly breakStatus?: Y8BreakStatus | string;
}

export interface Y8ShowAdOptions {
  readonly type?: Y8Placement;
  readonly name?: string;
  readonly beforeAd?: () => void;
  readonly afterAd?: () => void;
  /** Reward placement only. Nothing is shown unless `showAdFn` is called. */
  readonly beforeReward?: (showAdFn: () => void) => void;
  /** Reward placement only. "The player watched it through. Grant the reward here." */
  readonly adViewed?: () => void;
  /** Reward placement only. "The player closed it early. Grant nothing." */
  readonly adDismissed?: () => void;
  /** "Runs for every break, whether or not an ad was shown." */
  readonly adBreakDone?: (info: Y8BreakInfo) => void;
}

/** `avatars` sizes, each with a plain and a secure variant. The docs say prefer secure. */
export interface Y8Avatars {
  readonly thumb_secure_url?: string;
  readonly medium_secure_url?: string;
  readonly large_secure_url?: string;
}

/** Display data only — "This is display data, not proof of identity". */
export interface Y8User {
  readonly pid?: string;
  readonly nickname?: string;
  readonly level?: number;
  readonly avatars?: Y8Avatars;
}

/**
 * Failures come in two shapes (https://docs.y8.com/sdk/intro/#handling-errors): an object
 * with `message` and sometimes `code` from the server, or a plain string for a call made
 * wrongly ("The token can't be null." when nobody is signed in).
 */
export type Y8Error = string | { readonly message?: string; readonly code?: string };

export interface Y8Sdk {
  init(appConfig: Y8AppConfig, adConfig?: Y8AdConfig): unknown;
  onAuth(callback: (user: Y8User | null, error: Y8Error | null) => void): void;
  getUser(): Y8User | null;
  showAd(options: Y8ShowAdOptions): Promise<unknown>;
  saveData(options: { key: string; value: string; retries?: boolean }): Promise<unknown>;
  loadData(options: { key: string }): Promise<string | null | undefined>;
  removeData(options: { key: string }): Promise<unknown>;
  getPlatformLocale(): Promise<string>;
}

/** `window.y8` once the script has run. */
export interface Y8Global {
  sdk(): Y8Sdk;
  emitReadyEvent?(): void;
}

/**
 * The code the docs call `Y8Sdk.saveRejected` — "a save was refused by the server even after
 * retries". The docs name the constant but not its value, and the script does not expose
 * `Y8Sdk` as a global, so the value is taken from the script itself (2.12.0).
 */
export const Y8_SAVE_REJECTED = "save_rejected";

interface Y8Window {
  y8?: Y8Global;
}

/** The global the script defines, or null before it has run. */
export function globalY8(): Y8Global | null {
  const y8 = (globalThis as Y8Window).y8;
  return y8 && typeof y8.sdk === "function" ? y8 : null;
}

/** A readable one-liner for either documented error shape. */
export function describeY8Error(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { message, code } = error as { message?: unknown; code?: unknown };
    const text = typeof message === "string" ? message : String(message ?? "unknown error");
    return typeof code === "string" ? `${code}: ${text}` : text;
  }
  return String(error);
}

/** Minimal DOM the loader touches; the browser's `window`/`document` in production. */
export interface Y8LoaderEnvironment {
  readonly window: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly document?: Pick<Document, "createElement" | "querySelector" | "head">;
  readonly setTimeout: (handler: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

function browserEnvironment(): Y8LoaderEnvironment | null {
  if (typeof window === "undefined") return null;
  return {
    window,
    ...(typeof document === "undefined" ? {} : { document }),
    setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
  };
}

export interface LoadY8Options {
  /** How long to wait for `y8sdk.ready` before giving up. The game boots without Y8 then. */
  readonly timeoutMs?: number;
  readonly environment?: Y8LoaderEnvironment;
}

/**
 * Resolve the SDK once `y8sdk.ready` has fired, however the script and this code race.
 *
 * The docs' warning (https://docs.y8.com/sdk/intro/#initialization, "Keep the last three
 * lines"): the script is async, so it may run before or after the listener is added. If it
 * ran first, `y8sdk.ready` has already fired and a listener added afterwards never runs —
 * "the most common reason for an SDK that does nothing". The documented cure, and the order
 * followed here, is: add the listener FIRST, then call `y8.emitReadyEvent()` when the global
 * already exists, which makes the SDK announce itself again.
 *
 * The event can arrive more than once (the script's own announcement plus ours); only the
 * first counts. When index.html has no script tag (a runtime-only integration), one is
 * injected — async, from the CDN, as the docs show.
 *
 * Rejects rather than hangs: an ad blocker or an offline player commonly stops cdn.y8.com,
 * and the game must stay playable.
 */
export function loadY8Sdk(options: LoadY8Options = {}): Promise<Y8Sdk> {
  const env = options.environment ?? browserEnvironment();
  if (!env) return Promise.reject(new Error("Y8 SDK needs a browser window"));
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise<Y8Sdk>((resolve, reject) => {
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      env.clearTimeout(timer);
      env.window.removeEventListener(Y8_READY_EVENT, onReady);
      outcome();
    };

    const onReady = (): void => {
      const y8 = globalY8();
      if (!y8) {
        settle(() => reject(new Error(`${Y8_READY_EVENT} fired but window.y8.sdk is absent`)));
        return;
      }
      try {
        const sdk = y8.sdk();
        settle(() => resolve(sdk));
      } catch (error) {
        settle(() => reject(new Error(`y8.sdk() threw: ${describeY8Error(error)}`)));
      }
    };

    // 1. Listen before anything can fire.
    env.window.addEventListener(Y8_READY_EVENT, onReady);
    const timer = env.setTimeout(() => {
      settle(() => reject(new Error(`Y8 SDK was not ready within ${timeoutMs} ms`)));
    }, timeoutMs);

    // 2. The script already ran (the <head> tag won the race): ask it to announce again.
    const existing = globalY8();
    if (existing) {
      try {
        if (typeof existing.emitReadyEvent !== "function") throw new Error("no emitReadyEvent");
        existing.emitReadyEvent();
      } catch {
        // No working emitReadyEvent — not the documented SDK, but the global is there and
        // usable, so use it rather than wait out the timeout for an event that will not come.
        onReady();
      }
      return;
    }

    // 3. Not loaded yet. A <script> already in the page will dispatch the event when it
    //    runs; otherwise inject one.
    const doc = env.document;
    if (!doc) {
      settle(() => reject(new Error("Y8 SDK is not loaded and there is no document to load it")));
      return;
    }
    const tag = doc.querySelector<HTMLScriptElement>(`script[src="${Y8_SDK_URL}"]`);
    const script = tag ?? doc.createElement("script");
    script.addEventListener("error", () => {
      settle(() => reject(new Error(`Y8 SDK failed to load from ${Y8_SDK_URL}`)));
    });
    // Belt and braces: the script dispatches y8sdk.ready itself on load, but a listener that
    // raced it on an unusual engine still gets a second announcement.
    script.addEventListener("load", () => {
      if (!settled) globalY8()?.emitReadyEvent?.();
    });
    if (!tag) {
      script.src = Y8_SDK_URL;
      script.async = true;
      doc.head.appendChild(script);
    }
  });
}
