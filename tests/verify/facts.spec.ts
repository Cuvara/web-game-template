// Measure the package facts that only exist while the game is running.
//
// One measurement per platform artifact, because each platform ships different bytes: every
// build/platforms/<id>/dist listed in build/platforms/index.json (`pnpm build:platforms`), or
// — when there is no per-platform build — dist/ as the target platform. Each is served on its
// own preview server, so the artifact under test is the artifact that ships, and each run
// writes build/runtime-facts/<id>.json. The target platform's run is also written to
// build/runtime-facts.json, the path the Factory reads. scripts/verify/collect-facts.mjs merges
// these with the static facts before the assertions are evaluated.
//
// Portal SDK requests are blocked, the way an ad blocker would: nothing third-party is
// fetched, and every adapter must still boot the game without its SDK. What the portal's
// own script does is the portal's QA step, not a package fact.
//
// This spec does not assert much itself. Its job is to measure honestly; deciding what is
// acceptable belongs to the platform profile, not to a test file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");
const RUNTIME_DIR = resolve(ROOT, "build/runtime-facts");
const COMPAT_OUT = resolve(ROOT, "build/runtime-facts.json");

/** How long to sample frames for. Long enough to average out a slow first frame. */
const FPS_SAMPLE_MS = 2_000;
/** Chrome's CPU throttle multiplier. A stand-in for the low-end Android floor, not a phone. */
const LOWEND_CPU_THROTTLE = 4;
/** First port tried for the per-artifact preview servers; 4173 is the smoke suite's. */
const FIRST_PORT = 4273;

interface ProbeSnapshot {
  timeToInteractiveMs: number;
  loadingProgressCalls: number;
  signalReadyCalls: number;
  adsRequested: Record<string, number>;
  framesRendered: number;
  platformId: string | null;
  target: string | null;
  engine: string | null;
}

interface MeasureTarget {
  readonly id: string;
  /** Repo-relative artifact directory. */
  readonly dir: string;
}

interface GameConfigPlatform {
  readonly id: string;
  readonly role?: string;
}

// A portal's own ad stack loads third-party sub-resources the game cannot control: Google's
// IMA bridge, for one, requests over http from imasdk.googleapis.com when a portal SDK pulls
// it in. `insecure_requests` measures the GAME's own resources — the thing an https_only
// profile is asserting about — so those third-party ad-SDK hosts are not counted here, the
// same boundary the e2e smoke audit already draws. A portal's transport is the portal's.
const THIRD_PARTY_AD_HOSTS = [
  "imasdk.googleapis.com",
  "googleads",
  "googlesyndication",
  "doubleclick",
  "pagead",
  "amazon-adsystem.com",
  "publisher-services.amazon",
];

/**
 * The portal SDK hosts to block, from the same signature list collect-facts scans the
 * artifact with. Signatures that are not hosts (a global's name) cannot match a URL and are
 * skipped. Yandex's SDK is served same-origin at /sdk.js, so it is blocked by path.
 */
function portalSdkMatchers(): ((url: URL) => boolean)[] {
  const signatures = JSON.parse(
    readFileSync(resolve(ROOT, "packages/platform-sdk/sdk-signatures.json"), "utf8"),
  ) as Record<string, unknown>;
  const hosts = Object.values(signatures)
    .filter((value): value is string[] => Array.isArray(value))
    .flat()
    .filter((needle) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(needle));
  return [
    (url) => hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)),
    (url) => url.pathname === "/sdk.js",
  ];
}

function readGameConfigPlatforms(): GameConfigPlatform[] {
  // `||`, not `??`: an empty WGF_GAME_CONFIG means unset, as in scripts/_shared.mjs.
  const path = resolve(ROOT, process.env["WGF_GAME_CONFIG"] || "game.config.yaml");
  const config = parse(readFileSync(path, "utf8")) as { platforms?: GameConfigPlatform[] };
  return config.platforms ?? [];
}

/** Same rule as the build: WGF_TARGET_PLATFORM, else the first required entry, else the first. */
function targetPlatformId(platforms: GameConfigPlatform[]): string {
  const override = process.env["WGF_TARGET_PLATFORM"];
  if (override) return override;
  const entry = platforms.find((platform) => platform.role === "required") ?? platforms[0];
  if (!entry) throw new Error("game.config.yaml lists no platforms");
  return entry.id;
}

function measureTargets(targetId: string): MeasureTarget[] {
  const indexPath = resolve(ROOT, "build/platforms/index.json");
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
      platforms?: { id: string; dir?: string }[];
    };
    const listed = (index.platforms ?? []).map((entry) => ({
      id: entry.id,
      dir: entry.dir ?? `build/platforms/${entry.id}/dist`,
    }));
    if (listed.length > 0) return listed;
  }
  return [{ id: targetId, dir: "dist" }];
}

async function serve(dir: string, port: number): Promise<{ server: PreviewServer; url: string }> {
  // configFile: false — this serves bytes that are already built; the project config's
  // plugins would rebuild nothing here, and must not decide what is served.
  const server = await preview({
    configFile: false,
    root: ROOT,
    logLevel: "silent",
    build: { outDir: resolve(ROOT, dir) },
    preview: { port, strictPort: false, host: "localhost" },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error(`preview server for ${dir} reported no local URL`);
  return { server, url };
}

async function blockPortalSdks(page: Page, matchers: ((url: URL) => boolean)[]): Promise<void> {
  await page.route(
    (url) => matchers.some((matches) => matches(url)),
    (route) => route.abort("blockedbyclient"),
  );
}

async function measure(
  browser: Browser,
  page: Page,
  baseURL: string,
  matchers: ((url: URL) => boolean)[],
): Promise<{ facts: Record<string, unknown>; probe: ProbeSnapshot }> {
  const insecureRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.startsWith("http://") &&
      !url.startsWith("http://localhost") &&
      !THIRD_PARTY_AD_HOSTS.some((host) => url.includes(host))
    )
      insecureRequests.push(url);
  });
  await blockPortalSdks(page, matchers);

  // window.open has to be counted before the bundle runs, so it goes in an init script.
  await page.addInitScript(() => {
    (window as unknown as { __externalOpens: number }).__externalOpens = 0;
    const original = window.open.bind(window);
    window.open = ((...args: Parameters<typeof window.open>) => {
      (window as unknown as { __externalOpens: number }).__externalOpens += 1;
      return original(...args);
    }) as typeof window.open;
  });

  await page.goto(baseURL);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

  const probe = await page.evaluate<ProbeSnapshot>(() => {
    const wgf = window.__wgf__;
    if (!wgf) throw new Error("window.__wgf__ is missing — installProbe() did not run");
    const usage = wgf.usage();
    // `target` is read loosely: older probes do not expose it.
    const loose = wgf as unknown as { platformId?: string; target?: string; engine?: string };
    return {
      timeToInteractiveMs: wgf.timeToInteractiveMs,
      loadingProgressCalls: usage.loadingProgressCalls,
      signalReadyCalls: usage.signalReadyCalls,
      adsRequested: usage.adsRequested as unknown as Record<string, number>,
      framesRendered: wgf.framesRendered(),
      platformId: loose.platformId ?? null,
      target: loose.target ?? null,
      engine: loose.engine ?? null,
    };
  });

  const externalLinks = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("a[href]")].filter((anchor) => {
      try {
        return new URL((anchor as HTMLAnchorElement).href).origin !== window.location.origin;
      } catch {
        return false;
      }
    }).length;
    return anchors + (window as unknown as { __externalOpens: number }).__externalOpens;
  });

  // Frame rate under a CPU throttle. Chrome's throttle is a proxy for a low-end device, not
  // a measurement of one — GameVui's fps assertion is a warning for exactly this reason.
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: LOWEND_CPU_THROTTLE });
  const before = await page.evaluate(() => window.__wgf__!.framesRendered());
  await page.waitForTimeout(FPS_SAMPLE_MS);
  const after = await page.evaluate(() => window.__wgf__!.framesRendered());
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const throttledFps = Number((((after - before) * 1000) / FPS_SAMPLE_MS).toFixed(1));

  // A separate mobile-emulated context: booting on a phone viewport is its own fact, and
  // CrazyGames lists missing mobile support as a rejection cause.
  const mobileContext = await browser.newContext({ ...devices["Pixel 5"] });
  const mobilePage = await mobileContext.newPage();
  let mobileSupported = false;
  try {
    await blockPortalSdks(mobilePage, matchers);
    await mobilePage.goto(baseURL);
    await expect(mobilePage.locator("#hud")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });
    mobileSupported = true;
  } finally {
    await mobileContext.close();
  }

  const facts = {
    package: {
      calls_loading_api: probe.loadingProgressCalls > 0 && probe.signalReadyCalls > 0,
      insecure_requests: insecureRequests.length,
      external_links: externalLinks,
      mobile_supported: mobileSupported,
      perf: {
        time_to_interactive_s: Number((probe.timeToInteractiveMs / 1000).toFixed(3)),
        lowend_android_fps: throttledFps,
      },
    },
    adsRequested: probe.adsRequested,
    // What the running build said it was. collect-facts refuses to merge these facts into
    // another platform's record when this disagrees with the platform it is collecting.
    observed: { platformId: probe.platformId, target: probe.target, engine: probe.engine },
    measured_at: new Date().toISOString(),
    note: "lowend_android_fps is a CPU-throttled desktop proxy, not a device measurement",
  };
  return { facts, probe };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

const TARGET_ID = targetPlatformId(readGameConfigPlatforms());
const TARGETS = measureTargets(TARGET_ID);
const SDK_MATCHERS = portalSdkMatchers();

TARGETS.forEach((target, index) => {
  test(`measure runtime package facts: ${target.id}`, async ({ page, browser }) => {
    const artifact = resolve(ROOT, target.dir);
    expect(existsSync(resolve(artifact, "index.html")), `${target.dir}/index.html`).toBe(true);

    const { server, url } = await serve(target.dir, FIRST_PORT + index);
    try {
      const { facts, probe } = await measure(browser, page, url, SDK_MATCHERS);
      const record = { platform: target.id, artifact: target.dir, ...facts };

      writeJson(resolve(RUNTIME_DIR, `${target.id}.json`), record);
      if (target.id === TARGET_ID) writeJson(COMPAT_OUT, record);

      // The one thing this file does assert: the probe reported a game that actually
      // started. Every fact above is meaningless if it did not.
      expect(probe.framesRendered).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});
