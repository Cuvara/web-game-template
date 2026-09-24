// The SDK module's release boundary: it prepares integration artifacts, it never publishes.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as sdk from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script without type declarations.
import { buildIntegration } from "../../scripts/sdk/prepare-integration.mjs";
// @ts-expect-error — plain ESM script without type declarations.
import { contentHash } from "../../scripts/_shared.mjs";

const root = resolve(import.meta.dirname, "../..");

const config = (ids: string[], adKinds: string[]) => ({
  game: { id: "matrix-game", name: "Matrix", version: "1.0.0" },
  engine: { type: "threejs" },
  platforms: ids.map((id, i) => ({
    id,
    profile: `${id}@1.0.0`,
    role: i === 0 ? "required" : "optional",
  })),
  monetization: { ad_kinds: adKinds, iap: false },
});

describe("prepare-integration", () => {
  const now = new Date("2026-09-23T00:00:00Z");

  it("describes every targeted platform's adapter and how its SDK is loaded", () => {
    const { integration } = buildIntegration(
      config(["yandex", "crazygames", "poki", "gamevui"], ["interstitial", "rewarded"]),
      sdk,
      { commitSha: "abc", now },
    );
    const byId = Object.fromEntries(
      integration.platforms.map((p: { id: string }) => [p.id, p]),
    ) as Record<string, { adapter: string; sdk: { source: string | null; loaded: string } }>;
    expect(byId["yandex"]).toMatchObject({
      adapter: "YandexPlatform",
      sdk: { source: "/sdk.js", loaded: "runtime" },
    });
    expect(byId["crazygames"]?.sdk).toEqual({
      source: sdk.CRAZYGAMES_SDK_URL,
      loaded: "html-head",
    });
    expect(byId["poki"]?.sdk).toEqual({ source: sdk.POKI_SDK_URL, loaded: "runtime" });
    expect(byId["gamevui"]).toMatchObject({
      adapter: "GameVuiPlatform",
      sdk: { source: null, loaded: "none" },
    });
    expect(integration.publishing).toMatch(/not performed/);
  });

  it("describes the Y8 adapter and its CDN script, and claims nothing live", () => {
    const { integration, report } = buildIntegration(
      config(["y8"], ["interstitial", "rewarded"]),
      sdk,
      { commitSha: "abc", now },
    );
    expect(integration.platforms[0]).toMatchObject({
      adapter: "Y8Platform",
      sdk: { source: sdk.Y8_SDK_URL, loaded: "html-head" },
      unserved_ad_kinds: [],
    });
    expect(report.platforms[0].status).toBe("partial");
    expect(report.platforms[0].features.map((f: { status: string }) => f.status)).not.toContain(
      "working",
    );
  });

  it("flags a declared ad kind an adapter cannot show", () => {
    const { problems } = buildIntegration(
      config(["poki", "gamevui"], ["rewarded", "banner"]),
      sdk,
      { now },
    );
    expect(problems).toEqual([
      'poki: the title declares "banner" ads, which the adapter cannot show',
      'gamevui: the title declares "rewarded" ads, which the adapter cannot show',
      'gamevui: the title declares "banner" ads, which the adapter cannot show',
    ]);
  });

  it("writes a Factory sdk-report whose hash reproduces and that claims no live verification", () => {
    const { report } = buildIntegration(config(["yandex", "gamevui"], []), sdk, {
      commitSha: "abc",
      now,
    });
    expect(report.provenance.content_hash).toBe(contentHash(report));
    expect(report.provenance.artifact_id).toBe("wgf:sdk-report:matrix-game:20260923-01");
    const yandex = report.platforms[0];
    expect(yandex.status).toBe("partial");
    expect(yandex.features.map((f: { status: string }) => f.status)).not.toContain("working");
    expect(report.platforms[1].status).toBe("working");
  });
});

describe("release boundary", () => {
  // Publishing belongs to the release pipeline. Nothing the SDK module ships or runs may
  // talk to a portal's upload API, a CLI that uploads, or the repository's credentials.
  const FORBIDDEN =
    /\bfetch\s*\(|XMLHttpRequest|sendBeacon|@poki\/cli|poki\s+upload|GITHUB_TOKEN|process\.env\[?["']?[A-Z_]*(TOKEN|SECRET|KEY)/;

  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it("no adapter, SDK script or SDK harness can publish", () => {
    const scanned = [
      ...files(resolve(root, "packages/platform-sdk/src")),
      ...files(resolve(root, "scripts/sdk")),
      ...files(resolve(root, "tests/sdk")),
      ...files(resolve(root, "tests/sdk-matrix")),
    ];
    expect(scanned.length).toBeGreaterThan(10);
    const offenders = scanned.filter((path) => FORBIDDEN.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
