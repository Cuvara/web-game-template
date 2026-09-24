// `package.platform_sdk` is the fact that says which portal SDK a package ships, and three
// profiles make it blocking. It is derived from the artifact's bytes, so these tests build
// small artifacts on disk and check what is read off them — including the case the old
// derivation got wrong: it reported the requested platform id whatever the bundle held.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectFacts,
  loadSdkSignatures,
  platformSdkFromPortals,
  resolveArtifact,
  resolveRuntimePath,
  scanPlatformSdk,
  // @ts-expect-error — plain ESM script without type declarations.
} from "../../scripts/verify/collect-facts.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const SIGNATURES = loadSdkSignatures(REPO) as Record<string, string[]>;

// The URL strings the adapters load their SDKs from (packages/platform-sdk/src/adapters).
const POKI_BUNDLE = `const u="https://game-cdn.poki.com/scripts/v2/poki-sdk.js";`;
const CRAZYGAMES_BUNDLE = `const u="https://sdk.crazygames.com/crazygames-sdk-v3.js";`;
const GENERIC_BUNDLE = `console.log("a game with no portal");`;

/** The derivation collect-facts.mjs used before it read the artifact. Kept to show the bug. */
function oldPlatformSdkFact(platformId: string): string {
  return platformId === "generic-web" ? "none" : platformId;
}

let root: string;

function write(relative: string, content: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const gameConfig = (platforms: { id: string }[] = [{ id: "generic-web" }]) => ({
  platforms,
  monetization: { ad_kinds: [] },
  build: { output: "dist" },
});

function facts(platformId: string, runtime: unknown = null) {
  return collectFacts({
    root,
    platformId,
    gameConfig: gameConfig(),
    runtime,
    signatures: SIGNATURES,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wgf-facts-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sdk-signatures.json", () => {
  it("lists every portal that ships an SDK, and not the SDK-less platforms", () => {
    expect(Object.keys(SIGNATURES).sort()).toEqual(
      ["crazygames", "gamedistribution", "gamemonetize", "poki", "y8", "yandex"].sort(),
    );
    expect(SIGNATURES).not.toHaveProperty("generic-web");
    expect(SIGNATURES).not.toHaveProperty("gamevui");
    for (const needles of Object.values(SIGNATURES)) expect(needles.length).toBeGreaterThan(0);
  });

  // A signature that is a substring of another portal's would make one SDK read as two.
  it("has no signature that matches another portal's SDK URL", () => {
    const urls: Record<string, string> = {
      crazygames: "https://sdk.crazygames.com/crazygames-sdk-v3.js",
      poki: "https://game-cdn.poki.com/scripts/v2/poki-sdk.js",
      y8: "https://cdn.y8.com/minimal-sdk/2-0/y8.min.js",
      gamedistribution: "https://html5.api.gamedistribution.com/main.min.js",
      gamemonetize: "https://api.gamemonetize.com/sdk.js",
    };
    for (const [portal, url] of Object.entries(urls)) {
      const matched = Object.entries(SIGNATURES)
        .filter(([, needles]) => needles.some((needle) => url.includes(needle)))
        .map(([id]) => id);
      expect(matched, url).toEqual([portal]);
    }
  });
});

describe("platform_sdk is derived from the artifact", () => {
  it('reads a generic-web artifact as "none"', () => {
    write("dist/index.html", `<script type="module" src="./assets/index.js"></script>`);
    write("dist/assets/index.js", GENERIC_BUNDLE);
    expect(facts("generic-web").package.platform_sdk).toBe("none");
  });

  it('reads an artifact carrying the Poki SDK URL as "poki", with the file as evidence', () => {
    write("dist/index.html", "<html></html>");
    write("dist/assets/index-abc.js", POKI_BUNDLE);
    const result = facts("poki");
    expect(result.package.platform_sdk).toBe("poki");
    expect(result.evidence.platform_sdk_matches).toEqual({ poki: ["assets/index-abc.js"] });
  });

  it('reads an artifact carrying two portals\' SDKs as "mixed:<sorted ids>"', () => {
    write("dist/assets/a.js", POKI_BUNDLE);
    write("dist/assets/b.js", CRAZYGAMES_BUNDLE);
    expect(facts("poki").package.platform_sdk).toBe("mixed:crazygames,poki");
  });

  it("finds a signature in shipped HTML, not only in scripts", () => {
    write("dist/index.html", `<script src="https://api.gamemonetize.com/sdk.js"></script>`);
    expect(facts("gamemonetize").package.platform_sdk).toBe("gamemonetize");
  });

  it("ignores source maps and non-script assets, which do not ship SDK code", () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    write("dist/assets/index.js.map", POKI_BUNDLE);
    write("dist/locales/en.json", `{"x":"${POKI_BUNDLE.replace(/"/g, "")}"}`);
    expect(facts("generic-web").package.platform_sdk).toBe("none");
  });

  it('reads a GameVui artifact, which ships no SDK, as "none"', () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    expect(facts("gamevui").package.platform_sdk).toBe("none");
  });

  // The regression this derivation exists to fix. The old code never looked at the bundle:
  // asked about poki it said "poki" for an SDK-less build and for a build with every SDK in
  // it, so the profile's `platform_sdk == poki` assertion could not fail.
  it("does not echo the requested platform id back, as the old derivation did", () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    expect(oldPlatformSdkFact("poki")).toBe("poki");
    expect(facts("poki").package.platform_sdk).toBe("none");

    write("dist/assets/other.js", CRAZYGAMES_BUNDLE + POKI_BUNDLE);
    expect(oldPlatformSdkFact("poki")).toBe("poki");
    expect(facts("poki").package.platform_sdk).toBe("mixed:crazygames,poki");

    // And for generic-web it said "none" even when a portal SDK was bundled.
    expect(oldPlatformSdkFact("generic-web")).toBe("none");
    expect(facts("generic-web").package.platform_sdk).toBe("mixed:crazygames,poki");
  });

  it("does not let a runtime file override the derived value", () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    const runtime = { package: { platform_sdk: "poki", insecure_requests: 0 } };
    const result = facts("generic-web", runtime);
    expect(result.package.platform_sdk).toBe("none");
    expect(result.package.insecure_requests).toBe(0);
  });
});

describe("platformSdkFromPortals", () => {
  it("names one portal, none, or a sorted de-duplicated mix", () => {
    expect(platformSdkFromPortals([])).toBe("none");
    expect(platformSdkFromPortals(["y8"])).toBe("y8");
    expect(platformSdkFromPortals(["yandex", "poki", "yandex"])).toBe("mixed:poki,yandex");
  });

  it("scanPlatformSdk on a missing directory finds nothing", () => {
    expect(scanPlatformSdk(join(root, "absent"), SIGNATURES).platform_sdk).toBe("none");
  });
});

describe("artifact resolution", () => {
  const index = (platforms: unknown[]) =>
    write(
      "build/platforms/index.json",
      JSON.stringify({ schema: "wgf-platform-builds/1", platforms }),
    );

  it("uses build/platforms/<id>/dist when the index lists the platform", () => {
    write("dist/assets/index.js", CRAZYGAMES_BUNDLE);
    write("build/platforms/poki/dist/assets/index.js", POKI_BUNDLE);
    write(
      "build/platforms/poki/build.json",
      JSON.stringify({ platform: "poki", portal_configured: false }),
    );
    index([{ id: "poki", dir: "build/platforms/poki/dist", portal_configured: true }]);

    const result = facts("poki");
    expect(result.evidence.artifact).toBe("build/platforms/poki/dist");
    expect(result.evidence.artifact_source).toBe("platform-build");
    expect(result.package.platform_sdk).toBe("poki");
    // build.json is the per-build record and wins over the index summary.
    expect(result.package.portal_configured).toBe(false);
  });

  it("falls back to the index entry's portal_configured when build.json is absent", () => {
    write("build/platforms/y8/dist/index.js", `"https://cdn.y8.com/minimal-sdk/2-0/y8.min.js"`);
    index([{ id: "y8", dir: "build/platforms/y8/dist", portal_configured: true }]);
    expect(facts("y8").package.portal_configured).toBe(true);
  });

  it("falls back to dist/ for a platform the index does not list", () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    index([{ id: "poki", dir: "build/platforms/poki/dist" }]);
    const artifact = resolveArtifact(root, "generic-web", gameConfig());
    expect(artifact.source).toBe("dist");
    expect(facts("generic-web").package).not.toHaveProperty("portal_configured");
  });

  it("refuses to measure an artifact that does not exist", () => {
    expect(() => facts("generic-web")).toThrow(/no built artifact for generic-web at dist/);
  });

  it("measures size, locales and screenshots off the same artifact", () => {
    write("build/platforms/poki/dist/locales/en.json", "{}");
    write("build/platforms/poki/dist/locales/ru.json", "{}");
    write("build/platforms/poki/dist/metadata/screenshots/1.png", "x");
    write("dist/locales/vi.json", "{}");
    index([{ id: "poki", dir: "build/platforms/poki/dist" }]);
    const result = facts("poki");
    expect(result.package.locales).toEqual(["en", "ru"]);
    expect(result.metadata.screenshots).toBe(1);
  });
});

describe("runtime facts", () => {
  it("prefers build/runtime-facts/<id>.json, then the target-platform compat file", () => {
    expect(resolveRuntimePath(root, "poki")).toBe(resolve(root, "build/runtime-facts.json"));
    write("build/runtime-facts/poki.json", "{}");
    expect(resolveRuntimePath(root, "poki")).toBe(resolve(root, "build/runtime-facts/poki.json"));
    expect(resolveRuntimePath(root, "poki", "x.json")).toBe(resolve(root, "x.json"));
  });

  it("records the platform the running build reported, and whether it matches", () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    const same = facts("generic-web", { observed: { platformId: "generic-web" } });
    expect(same.package.runtime_platform).toBe("generic-web");
    expect(same.package.runtime_platform_matches).toBe(true);

    const other = facts("poki", { observed: { platformId: "generic-web", target: "poki" } });
    expect(other.package.runtime_platform).toBe("generic-web");
    expect(other.package.runtime_platform_matches).toBe(false);
  });

  it("omits runtime_platform when the runtime file recorded none", () => {
    write("dist/assets/index.js", GENERIC_BUNDLE);
    const result = facts("generic-web", { package: { insecure_requests: 0 } });
    expect(result.package).not.toHaveProperty("runtime_platform");
  });
});

describe("the repository's own profiles", () => {
  // generic-web's standalone assertion is the one the "none" value exists for.
  it("generic-web asserts platform_sdk == none", () => {
    const profile = readFileSync(resolve(REPO, "config/platforms/generic-web.yaml"), "utf8");
    expect(profile).toMatch(/left: package\.platform_sdk, op: eq, right: none/);
  });
});
