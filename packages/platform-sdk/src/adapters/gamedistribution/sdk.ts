// The part of the GameDistribution HTML5 SDK this adapter uses, typed from the official
// documentation. Every member here is one the docs describe; nothing is typed "just in case".
//
//   loader snippet, GD_OPTIONS {gameId, onEvent}   https://github.com/GameDistribution/GD-HTML5/wiki/SDK-Implementation
//   gdsdk.showAd(type), gdsdk.preloadAd(type)       .../wiki/SDK-Implementation, .../wiki/Rewarded-Ads
//   SDK_READY, SDK_ERROR, SDK_GAME_START/PAUSE      https://github.com/GameDistribution/GD-HTML5 (README, "Events")
//   SDK_REWARDED_WATCH_COMPLETE                     .../wiki/Rewarded-Ads
//   self-hosting and GD_SDK_REFERRER_URL            README, "Implementation self-hosted games" + index_iframe.html
//
// Audited against GD-HTML5 at 4873abe ("version 1.43.58", 2026-06-18) and the CDN loader
// serving the same version, on 2026-09-24. docs/platforms/gamedistribution.md has the audit.
//
// Not used, on purpose: getSession(), sendEvent(), leaderboard, the Store API and the
// undocumented GD_OPTIONS.pauseGame/resumeGame callbacks — none is in the SDK-Implementation
// page, and a member the docs do not describe is one nobody can check against them. The
// deprecated showBanner() and display ads are not used either.

/** The documented loader. GameDistribution serves the current SDK version behind it. */
export const GAMEDISTRIBUTION_SDK_URL = "https://html5.api.gamedistribution.com/main.min.js";

/** The id the documented snippet gives its script tag, and checks so it loads only once. */
export const GAMEDISTRIBUTION_SCRIPT_ID = "gamedistribution-jssdk";

/**
 * The id the SDK falls back to when none is configured. With it the SDK raises SDK_ERROR
 * "Please check if your GAME ID is correct. Otherwise, no revenue will be reported."
 */
export const GAMEDISTRIBUTION_PLACEHOLDER_GAME_ID = "4f3d7d38d24b740c95da2b03dc3a2333";

/** A Game ID as the developer panel shows it: 32 hex characters. */
export const GAMEDISTRIBUTION_GAME_ID = /^[0-9a-f]{32}$/i;

/** The ad types `showAd` accepts that this adapter uses (`gdsdk.AdType` values). */
export type GameDistributionAdType = "interstitial" | "rewarded";

/**
 * The events this adapter acts on. The SDK sends many more (every IMA event is forwarded to
 * onEvent); they are ignored rather than guessed at.
 *
 *   SDK_READY                   "When the SDK is ready."
 *   SDK_ERROR                   "When the SDK has hit a critical error."
 *   SDK_GAME_PAUSE              "pause game logic / mute audio" — "Will be called every time
 *                               a video advertisement is ready to play."
 *   SDK_GAME_START              "advertisement done, resume game logic and unmute audio"
 *   SDK_REWARDED_WATCH_COMPLETE "the user watched the advertisement completely, you can give
 *                               reward there."
 *   AD_IS_ALREADY_RUNNING       another ad flow already holds the SDK
 *   AD_ERROR                    an ad failed (IMA pass-through)
 */
export type GameDistributionEventName =
  | "SDK_READY"
  | "SDK_ERROR"
  | "SDK_GAME_PAUSE"
  | "SDK_GAME_START"
  | "SDK_REWARDED_WATCH_COMPLETE"
  | "AD_IS_ALREADY_RUNNING"
  | "AD_ERROR";

/** What onEvent receives. Only `name` is relied on; `message` is kept for diagnostics. */
export interface GameDistributionEvent {
  readonly name: string;
  readonly message?: unknown;
  readonly status?: unknown;
}

/** `window.GD_OPTIONS`, as the SDK-Implementation page documents it. */
export interface GameDistributionOptions {
  readonly gameId: string;
  readonly onEvent: (event: GameDistributionEvent) => void;
}

/** The subset of `window.gdsdk` this adapter calls. */
export interface GameDistributionSdk {
  /**
   * Resolves when the ad flow is over, whether or not an ad filled; rejects with a message
   * when the SDK refuses (ads disabled, requested too soon). The docs do not define either
   * value, so the adapter reads outcomes from the events, not from these.
   */
  showAd(type?: GameDistributionAdType): Promise<unknown>;
  /** Rejects when "Any Rewarded ad is not available" (Rewarded-Ads wiki). */
  preloadAd(type?: GameDistributionAdType): Promise<unknown>;
}

/**
 * Obtains the SDK with `options` installed as window.GD_OPTIONS. Resolves null when the SDK
 * cannot be loaded (offline, an ad blocker, CSP) — never rejects in practice, and a
 * rejection is treated the same way.
 */
export type GameDistributionSdkLoader = (
  options: GameDistributionOptions,
) => Promise<GameDistributionSdk | null>;

declare global {
  interface Window {
    GD_OPTIONS?: GameDistributionOptions;
    gdsdk?: GameDistributionSdk;
  }
}

/**
 * The documented snippet, as a function: set window.GD_OPTIONS, then insert the loader
 * script with id `gamedistribution-jssdk` — once. "Only load the SDK once!"
 *
 * A tag with that id that this function did not insert means the page already carries the
 * snippet (hand-written into index.html). Its GD_OPTIONS.onEvent is not the adapter's, so
 * the adapter would never hear SDK_GAME_PAUSE and could not mute for an ad; loading a second
 * copy is what the docs forbid. Neither is safe, so it resolves null and the game runs
 * without ads. docs/platforms/gamedistribution.md says not to add the snippet by hand.
 */
export function loadGameDistributionSdk(
  options: GameDistributionOptions,
  url: string = GAMEDISTRIBUTION_SDK_URL,
): Promise<GameDistributionSdk | null> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (document.getElementById(GAMEDISTRIBUTION_SCRIPT_ID)) return Promise.resolve(null);

  window.GD_OPTIONS = options;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = GAMEDISTRIBUTION_SCRIPT_ID;
    script.src = url;
    script.async = true;
    // No gdsdk once the script has run means it threw — on a page without a UTF-8 charset,
    // for one, the bundle fails to parse — so there is no SDK to talk to.
    script.onload = () => resolve(window.gdsdk ? currentGdsdk : null);
    // An ad blocker blocking the loader lands here. The game must stay playable.
    script.onerror = () => resolve(null);
    const first = document.getElementsByTagName("script")[0];
    if (first?.parentNode) first.parentNode.insertBefore(script, first);
    else document.head.appendChild(script);
  });
}

/**
 * Calls whatever window.gdsdk is at the moment of the call. The SDK may replace the global
 * after load (1.43.58 swaps in an "SDK wrapper" object asynchronously), so the object seen
 * at onload is not kept.
 */
const currentGdsdk: GameDistributionSdk = {
  showAd: (type) => requireGdsdk().showAd(type),
  preloadAd: (type) => requireGdsdk().preloadAd(type),
};

function requireGdsdk(): GameDistributionSdk {
  const sdk = window.gdsdk;
  if (!sdk) throw new Error("window.gdsdk is gone");
  return sdk;
}

/**
 * How the game was reached, as far as `gd_sdk_referrer_url` is concerned.
 *
 *   absent     no referrer parameter: the game is GameDistribution-hosted (or run locally),
 *              and the SDK derives the domain from document.referrer / location itself
 *   valid      a self-hosted wrapper passed the embedding page's URL, and the game is framed
 *   malformed  the parameter is there but is not a URL; the SDK cannot use it
 *   ignored    the parameter is there but the game is not framed; the SDK replaces it with
 *              the page's own URL at depth 0, so it has no effect
 */
export type GameDistributionReferrerState = "absent" | "valid" | "malformed" | "ignored";

export interface GameDistributionHosting {
  /** Running inside an iframe, as on GameDistribution and every publisher site. */
  readonly framed: boolean;
  readonly referrer: GameDistributionReferrerState;
}

/**
 * Reads, never writes, the self-hosting parameter. The SDK itself parses the query
 * case-insensitively (README spells it GD_SDK_REFERRER_URL, the wrapper example
 * gd_sdk_referrer_url), so this does too. Purely diagnostic: the adapter never invents or
 * rewrites the value — only the self-hosted wrapper page may set it.
 */
export function readHosting(search: string, framed: boolean): GameDistributionHosting {
  let value: string | null = null;
  for (const [key, raw] of new URLSearchParams(search)) {
    if (key.toLowerCase() === "gd_sdk_referrer_url") value = raw;
  }
  if (value === null) return { framed, referrer: "absent" };
  if (!framed) return { framed, referrer: "ignored" };
  return { framed, referrer: isReferrerUrl(value) ? "valid" : "malformed" };
}

/** An absolute http(s) URL with a host — what the SDK can derive a domain from. */
export function isReferrerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The page's hosting, or a top-level page with no parameter outside a browser. */
export function currentHosting(): GameDistributionHosting {
  if (typeof window === "undefined" || typeof location === "undefined") {
    return { framed: false, referrer: "absent" };
  }
  let framed: boolean;
  try {
    framed = window.self !== window.top;
  } catch {
    // A cross-origin parent throws on access: that is exactly an iframe.
    framed = true;
  }
  return readHosting(location.search, framed);
}
