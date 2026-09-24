// Shared helpers for LIVE portal validation.
//
// "Live" here means the REAL portal SDK script, fetched from its real URL and run in a real
// browser — never a mock. These helpers only ever load the genuine SDK; there is no mock
// fallback anywhere in tests/live/. What a browser outside the portal CAN prove is limited:
// that the SDK URL is current, reachable, parses, and defines its documented global with the
// expected method surface. What it CANNOT prove is anything that needs the portal's own
// backend/iframe/account — init handshake, ad fill, reward delivery, cloud storage. Those are
// reported BLOCKED (see LiveStatus) and are what the manual tester page + workflow exist for.

import type { Page } from "@playwright/test";

export type LiveStatus = "PASS" | "FAIL" | "UNVERIFIED" | "BLOCKED" | "NOT_APPLICABLE";

export interface SdkLoadEvidence {
  readonly platform: string;
  readonly url: string;
  readonly scriptLoaded: boolean;
  readonly error: string | null;
  readonly globalName: string;
  readonly globalPresent: boolean;
  readonly methodsFound: readonly string[];
  readonly methodsMissing: readonly string[];
  readonly initOutcome: "resolved" | "rejected" | "timeout" | "not-attempted";
  readonly initDetail: string | null;
  /** Sanitized: URL, booleans, method names, timestamp, SHAs — never tokens or account data. */
  readonly at: string;
  readonly buildSha: string;
}

export interface PlatformDescriptor {
  readonly platform: string;
  /** The real SDK URL. Relative ("/sdk.js") means portal-served — unreachable off-portal. */
  readonly url: string;
  /** Dotted path to the SDK global, e.g. "CrazyGames.SDK" or "PokiSDK". */
  readonly globalName: string;
  /** Methods that must exist on the global for the surface to count as present. */
  readonly methods: readonly string[];
  /** True when the SDK is portal-served and cannot load in a browser off the portal origin. */
  readonly portalServed: boolean;
}

// The genuine, documented SDK entry points. Kept in step with the adapters.
export const PLATFORMS: Record<string, PlatformDescriptor> = {
  yandex: {
    platform: "yandex",
    url: "/sdk.js", // portal-relative per Yandex requirement 1.7 — only resolves inside the portal
    globalName: "YaGames",
    methods: ["init"],
    portalServed: true,
  },
  crazygames: {
    platform: "crazygames",
    url: "https://sdk.crazygames.com/crazygames-sdk-v3.js",
    globalName: "CrazyGames.SDK",
    methods: ["init"],
    portalServed: false,
  },
  poki: {
    platform: "poki",
    url: "https://game-cdn.poki.com/scripts/v2/poki-sdk.js",
    globalName: "PokiSDK",
    methods: ["init", "gameLoadingFinished", "commercialBreak", "rewardedBreak", "gameplayStart", "gameplayStop"],
    portalServed: false,
  },
  gamedistribution: {
    platform: "gamedistribution",
    url: "https://html5.api.gamedistribution.com/main.min.js",
    globalName: "gdsdk",
    methods: ["showAd", "preloadAd"],
    portalServed: false,
  },
};

/**
 * Load the REAL SDK script into the page and inspect it. Attempts a bounded init() only to
 * record how the SDK behaves off-portal (expected to reject/timeout) — that outcome is
 * evidence, not a pass/fail of the game.
 */
export async function probeSdkLoad(
  page: Page,
  d: PlatformDescriptor,
  buildSha: string,
  attemptInit = true,
): Promise<SdkLoadEvidence> {
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  const raw = await page.evaluate(
    async ({ url, globalName, methods, attemptInit }) => {
      const out = {
        scriptLoaded: false,
        error: null as string | null,
        globalPresent: false,
        methodsFound: [] as string[],
        methodsMissing: [] as string[],
        initOutcome: "not-attempted" as "resolved" | "rejected" | "timeout" | "not-attempted",
        initDetail: null as string | null,
      };
      await new Promise<void>((resolve) => {
        const s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onload = () => {
          out.scriptLoaded = true;
          resolve();
        };
        s.onerror = () => {
          out.error = "script failed to load (unreachable, blocked, or portal-served)";
          resolve();
        };
        document.head.appendChild(s);
        setTimeout(() => {
          if (!out.scriptLoaded && !out.error) out.error = "timeout waiting for script";
          resolve();
        }, 15000);
      });
      const g = globalName
        .split(".")
        .reduce<Record<string, unknown> | null>(
          (o, k) => (o == null ? null : (o[k] as Record<string, unknown> | null)),
          window as unknown as Record<string, unknown>,
        );
      out.globalPresent = g != null;
      if (g != null) {
        for (const m of methods) {
          (typeof g[m] === "function" ? out.methodsFound : out.methodsMissing).push(m);
        }
      }
      if (attemptInit && g != null && typeof g["init"] === "function") {
        const init = g["init"] as () => unknown;
        try {
          await new Promise<void>((resolve) => {
            const t = setTimeout(() => {
              out.initOutcome = "timeout";
              out.initDetail = "init did not settle within 8s off-portal";
              resolve();
            }, 8000);
            Promise.resolve(init())
              .then(() => {
                clearTimeout(t);
                out.initOutcome = "resolved";
                resolve();
              })
              .catch((e: unknown) => {
                clearTimeout(t);
                out.initOutcome = "rejected";
                out.initDetail = String((e as { message?: string })?.message ?? e).slice(0, 200);
                resolve();
              });
          });
        } catch (e) {
          out.initOutcome = "rejected";
          out.initDetail = String(e).slice(0, 200);
        }
      }
      return out;
    },
    { url: d.url, globalName: d.globalName, methods: [...d.methods], attemptInit },
  );

  return {
    platform: d.platform,
    url: d.url,
    globalName: d.globalName,
    ...raw,
    at: new Date().toISOString(),
    buildSha,
  };
}

/** SDK-load cell: PASS only when the REAL script loaded and its global surface is present. */
export function classifySdkLoad(d: PlatformDescriptor, e: SdkLoadEvidence): LiveStatus {
  if (d.portalServed) return "BLOCKED"; // portal-relative SDK cannot load off the portal origin
  if (!e.scriptLoaded) return "FAIL"; // real URL should be reachable; if not, that is a real failure
  if (!e.globalPresent || e.methodsMissing.length > 0) return "FAIL";
  return "PASS";
}
