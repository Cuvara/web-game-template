// The build target's adapter comes from `virtual:target-platform`, generated per build by
// scripts/build/game-config-plugin.ts, which imports one @wgf/platform-sdk subpath. Nothing
// here runs a build (tests/integration/platform-builds.test.ts does); this checks that what
// the generated module constructs is what the registry's createPlatform constructs, that the
// subpath it imports is exported, and that the SDK signature list covers every adapter.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CRAZYGAMES_SDK_URL,
  GAMEDISTRIBUTION_SDK_URL,
  GAMEMONETIZE_SDK_URL,
  KNOWN_PLATFORM_IDS,
  POKI_SDK_URL,
  Y8_SDK_URL,
  createPlatform,
  type CreatePlatformOptions,
} from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
import {
  TARGET_ADAPTERS,
  adapterSubpath,
  targetPlatformModule,
} from "../../scripts/build/game-config-plugin.js";

const ROOT = resolve(import.meta.dirname, "../..");
const SDK = resolve(ROOT, "packages/platform-sdk");
const pkg = JSON.parse(readFileSync(resolve(SDK, "package.json"), "utf8")) as {
  sideEffects: unknown;
  exports: Record<string, { import: string; types: string } | string>;
};
const signatures = JSON.parse(readFileSync(resolve(SDK, "sdk-signatures.json"), "utf8")) as Record<
  string,
  string[]
>;

const OPTIONS: CreatePlatformOptions = {
  namespace: "target-test",
  y8: { appId: "app-1", gameId: null },
  gamedistribution: { gameId: "0123456789abcdef0123456789abcdef" },
  portalGameId: "test000000000000000000000000000a",
};

describe("virtual:target-platform", () => {
  it("has an adapter for every platform id", () => {
    expect(Object.keys(TARGET_ADAPTERS).sort()).toEqual([...KNOWN_PLATFORM_IDS].sort());
  });

  it.each([...KNOWN_PLATFORM_IDS])("%s: constructs what createPlatform constructs", async (id) => {
    const adapter = TARGET_ADAPTERS[id]!;
    const module = (await import(resolve(SDK, "src", `${adapter.source}.ts`))) as Record<
      string,
      new (options: unknown) => unknown
    >;
    const Class = module[adapter.className]!;
    // The generated constructor call, evaluated against the adapter module the build would
    // import — the same source as the subpath's dist.
    const construct = new Function(
      "Adapter",
      "options",
      `return new Adapter(${adapter.args});`,
    ) as (Adapter: typeof Class, options: CreatePlatformOptions) => object;
    const fromTarget = construct(Class, OPTIONS);
    const fromRegistry = createPlatform(id, OPTIONS);
    expect(fromTarget.constructor).toBe(fromRegistry.constructor);
    expect(JSON.stringify(Object.keys(fromTarget))).toBe(JSON.stringify(Object.keys(fromRegistry)));
  });

  it("imports only the target's subpath", () => {
    const source = targetPlatformModule("poki");
    expect(source.match(/from "([^"]+)"/g)).toEqual([`from "@wgf/platform-sdk/adapters/poki"`]);
    expect(source).toContain('export const TARGET_PLATFORM_ID = "poki";');
    expect(() => targetPlatformModule("newgrounds")).toThrow(/no adapter/);
  });
});

describe("@wgf/platform-sdk package exports", () => {
  it("is side-effect free, so unused adapters drop out of a bundle", () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it.each([...KNOWN_PLATFORM_IDS])("exports ./%s's adapter as a subpath", (id) => {
    const source = TARGET_ADAPTERS[id]!.source;
    expect(pkg.exports[`./${adapterSubpath(id)}`]).toEqual({
      types: `./dist/${source}.d.ts`,
      import: `./dist/${source}.js`,
    });
  });
});

describe("sdk-signatures.json", () => {
  it("lists every platform, and nothing else", () => {
    expect(Object.keys(signatures).sort()).toEqual([...KNOWN_PLATFORM_IDS].sort());
  });

  it.each([
    ["crazygames", CRAZYGAMES_SDK_URL],
    ["gamedistribution", GAMEDISTRIBUTION_SDK_URL],
    ["gamemonetize", GAMEMONETIZE_SDK_URL],
    ["poki", POKI_SDK_URL],
    ["y8", Y8_SDK_URL],
  ])("%s: a signature matches the adapter's SDK URL", (id, url) => {
    expect(signatures[id]!.some((signature) => url.includes(signature))).toBe(true);
  });

  it("no signature of one platform matches another's SDK URL", () => {
    const urls: Record<string, string> = {
      crazygames: CRAZYGAMES_SDK_URL,
      gamedistribution: GAMEDISTRIBUTION_SDK_URL,
      gamemonetize: GAMEMONETIZE_SDK_URL,
      poki: POKI_SDK_URL,
      y8: Y8_SDK_URL,
    };
    for (const [id, list] of Object.entries(signatures)) {
      for (const [other, url] of Object.entries(urls)) {
        if (other === id) continue;
        for (const signature of list) expect(url, `${id}:${signature}`).not.toContain(signature);
      }
    }
  });

  it("platforms without a portal SDK have no signature", () => {
    expect(signatures["generic-web"]).toEqual([]);
    expect(signatures["gamevui"]).toEqual([]);
  });

  it("yandex's is its SDK global: the /sdk.js URL is shared with GameMonetize's", () => {
    expect(readFileSync(resolve(SDK, "src/adapters/yandex.ts"), "utf8")).toContain("YaGames");
    expect(signatures["yandex"]).toEqual(["YaGames"]);
  });
});
