// Measure the package facts that only exist while the game is running.
//
// Runs against the built bundle through `pnpm preview`, same as the smoke suite, because
// the artifact under test has to be the artifact that ships. Writes
// build/runtime-facts.json, which scripts/verify/collect-facts.mjs merges with the static
// facts before the assertions are evaluated.
//
// This spec does not assert much itself. Its job is to measure honestly; deciding what is
// acceptable belongs to the platform profile, not to a test file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { devices, expect, test } from "@playwright/test";

const OUT = resolve(import.meta.dirname, "../../build/runtime-facts.json");

/** How long to sample frames for. Long enough to average out a slow first frame. */
const FPS_SAMPLE_MS = 2_000;
/** Chrome's CPU throttle multiplier. A stand-in for the low-end Android floor, not a phone. */
const LOWEND_CPU_THROTTLE = 4;

interface ProbeSnapshot {
  timeToInteractiveMs: number;
  loadingProgressCalls: number;
  signalReadyCalls: number;
  adsRequested: Record<string, number>;
  framesRendered: number;
}

test("measure runtime package facts", async ({ page, browser, baseURL }) => {
  const insecureRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") && !url.startsWith("http://localhost"))
      insecureRequests.push(url);
  });

  // window.open has to be counted before the bundle runs, so it goes in an init script.
  await page.addInitScript(() => {
    (window as unknown as { __externalOpens: number }).__externalOpens = 0;
    const original = window.open.bind(window);
    window.open = ((...args: Parameters<typeof window.open>) => {
      (window as unknown as { __externalOpens: number }).__externalOpens += 1;
      return original(...args);
    }) as typeof window.open;
  });

  await page.goto("/");
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

  const probe = await page.evaluate<ProbeSnapshot>(() => {
    const wgf = window.__wgf__;
    if (!wgf) throw new Error("window.__wgf__ is missing — installProbe() did not run");
    const usage = wgf.usage();
    return {
      timeToInteractiveMs: wgf.timeToInteractiveMs,
      loadingProgressCalls: usage.loadingProgressCalls,
      signalReadyCalls: usage.signalReadyCalls,
      adsRequested: usage.adsRequested as unknown as Record<string, number>,
      framesRendered: wgf.framesRendered(),
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
  const mobileContext = await browser.newContext({
    ...devices["Pixel 5"],
    ...(baseURL ? { baseURL } : {}),
  });
  const mobilePage = await mobileContext.newPage();
  let mobileSupported = false;
  try {
    await mobilePage.goto("/");
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
    measured_at: new Date().toISOString(),
    note: "lowend_android_fps is a CPU-throttled desktop proxy, not a device measurement",
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(facts, null, 2) + "\n");

  // The one thing this file does assert: the probe reported a game that actually started.
  // Every fact above is meaningless if it did not.
  expect(probe.framesRendered).toBeGreaterThan(0);
});
