// The slice of the CrazyGames HTML5 SDK v3 this adapter uses, and how it gets loaded.
//
// Typed by hand from the official documentation rather than from the minified script, and
// deliberately narrow: every member here is one the docs describe for HTML5. Anything the
// docs do not describe is not called, however useful it looks in the bundle.
//
//   https://docs.crazygames.com/sdk/intro/        init, environment, error format
//   https://docs.crazygames.com/sdk/game/         gameplay/loading events, settings
//   https://docs.crazygames.com/sdk/video-ads/    requestAd, callbacks, error codes, adblock
//   https://docs.crazygames.com/sdk/data/         localStorage-shaped data module
//   https://docs.crazygames.com/sdk/user/         account availability, getUser, systemInfo
//
// Verified against the script served at SDK_URL on 2026-09-23, which reports version 3.8.0.

/** The only URL the docs give for the HTML5 SDK. Loaded from the CDN, never vendored. */
export const CRAZYGAMES_SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

/**
 * `local` on localhost/127.0.0.1 (demo ads as overlay text), `crazygames` on CrazyGames
 * domains, `disabled` everywhere else — where every SDK call throws.
 */
export type CrazyGamesEnvironment = "local" | "crazygames" | "disabled";

/** v3 errors always have this shape. */
export interface CrazyGamesError {
  readonly code: string;
  readonly message: string;
}

/** Error codes documented for `requestAd`. `other` covers anything else. */
export type CrazyGamesAdErrorCode =
  "adsDisabledBasicLaunch" | "unfilled" | "adblock" | "adCooldown" | "other";

export interface CrazyGamesAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: CrazyGamesError) => void;
}

export interface CrazyGamesSettings {
  readonly disableChat: boolean;
  readonly muteAudio: boolean;
}

export interface CrazyGamesSystemInfo {
  readonly countryCode?: string;
  readonly locale?: string;
  readonly device?: { readonly type?: "desktop" | "tablet" | "mobile" };
  readonly applicationType?: "google_play_store" | "apple_store" | "pwa" | "web";
}

export interface CrazyGamesUser {
  readonly username: string;
  readonly profilePictureUrl?: string;
}

export interface CrazyGamesSdk {
  init(): Promise<void>;
  readonly environment: CrazyGamesEnvironment;
  readonly ad: {
    requestAd(type: "midgame" | "rewarded", callbacks?: CrazyGamesAdCallbacks): void;
    hasAdblock(): Promise<boolean>;
  };
  readonly game: {
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    readonly settings: CrazyGamesSettings;
    addSettingsChangeListener(listener: (settings: CrazyGamesSettings) => void): void;
    removeSettingsChangeListener(listener: (settings: CrazyGamesSettings) => void): void;
  };
  readonly data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
  };
  readonly user: {
    readonly isUserAccountAvailable: boolean;
    readonly systemInfo: CrazyGamesSystemInfo;
    getUser(): Promise<CrazyGamesUser | null>;
  };
}

interface CrazyGamesGlobal {
  CrazyGames?: { SDK?: CrazyGamesSdk };
}

export function isCrazyGamesError(value: unknown): value is CrazyGamesError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/** The SDK object if the script has already run, e.g. from a `<script>` in `<head>`. */
export function globalCrazyGamesSdk(): CrazyGamesSdk | null {
  return (globalThis as CrazyGamesGlobal).CrazyGames?.SDK ?? null;
}

/**
 * Resolve the SDK, injecting the script tag when index.html did not already include it.
 *
 * Rejects rather than hangs when the script cannot load — an ad blocker commonly blocks
 * sdk.crazygames.com, and CrazyGames requires the game to stay playable with one.
 */
export function loadCrazyGamesSdk(timeoutMs = 10_000): Promise<CrazyGamesSdk> {
  const existing = globalCrazyGamesSdk();
  if (existing) return Promise.resolve(existing);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("CrazyGames SDK needs a browser document"));
  }

  // The docs' recommended setup is a plain <script> in <head>, which has already run by the
  // time any module code does. If that tag is present and the global is not, it failed —
  // typically an ad blocker — and injecting a second copy would only wait out the timeout.
  if (document.querySelector(`script[src="${CRAZYGAMES_SDK_URL}"]`)) {
    return Promise.reject(new Error(`CrazyGames SDK failed to load from ${CRAZYGAMES_SDK_URL}`));
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CRAZYGAMES_SDK_URL;
    script.async = true;

    const timer = setTimeout(() => {
      reject(new Error(`CrazyGames SDK did not load within ${timeoutMs} ms`));
    }, timeoutMs);

    script.addEventListener("load", () => {
      clearTimeout(timer);
      const sdk = globalCrazyGamesSdk();
      if (sdk) resolve(sdk);
      else reject(new Error("CrazyGames SDK script loaded but window.CrazyGames.SDK is absent"));
    });
    script.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CrazyGames SDK failed to load from ${CRAZYGAMES_SDK_URL}`));
    });

    document.head.appendChild(script);
  });
}
