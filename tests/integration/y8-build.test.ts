// Y8 build wiring: where the App ID / Game ID come from, what a Y8 build puts in <head>, and
// the profile a Y8 release is validated against.
//
// The SDK URL is written in two places that cannot import each other — the adapter and the
// Vite plugin, which runs before the packages are built — so they are checked to agree.
//
// Contract 2 changed two behaviours tested here: the IDs may sit on the y8 platform entry
// (app_id, game_id), with WGF_Y8_APP_ID / WGF_Y8_GAME_ID overriding them, and a Y8 build
// without an App ID now fails instead of warning (WGF_ALLOW_UNCONFIGURED_PORTAL=1 excepted).

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Y8_SDK_URL, validateY8Config } from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { gameConfigPlugin, platformConfigFor } from "../../scripts/build/game-config-plugin.js";
import { resolveBuild } from "../../src/core/game-config.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

describe("Y8 SDK URL", () => {
  it("is the documented CDN script, and the plugin injects the same one", () => {
    expect(Y8_SDK_URL).toBe("https://cdn.y8.com/minimal-sdk/2-0/y8.min.js");
    expect(read("scripts/build/game-config-plugin.ts")).toContain(`"${Y8_SDK_URL}"`);
  });
});

describe("Y8 settings: the platform entry, overridden by the build environment", () => {
  const raw = (ids: Record<string, string> = {}) => ({
    ...(parse(read("game.config.yaml")) as Record<string, unknown>),
    platforms: [{ id: "y8", profile: "y8@1.0.0", role: "required", ...ids }],
  });

  it("unset: the build fails, unless explicitly let through unconfigured", () => {
    expect(() => resolveBuild(raw(), {})).toThrow(/y8 build needs app_id .*WGF_Y8_APP_ID/);
    const build = resolveBuild(raw(), { WGF_ALLOW_UNCONFIGURED_PORTAL: "1" });
    expect(build.portalConfigured).toBe(false);
    expect(platformConfigFor(build.target)).toEqual({ y8: null });
    expect(validateY8Config(platformConfigFor(build.target).y8).ok).toBe(false);
  });

  it("App ID with or without a Game ID, from the file or the environment", () => {
    const fromFile = resolveBuild(raw({ app_id: "app-1" }), {}).target;
    expect(platformConfigFor(fromFile)).toEqual({ y8: { appId: "app-1", gameId: null } });
    const fromEnv = resolveBuild(raw({ app_id: "app-1" }), {
      WGF_Y8_APP_ID: " app-2 ",
      WGF_Y8_GAME_ID: "game-1",
    }).target;
    expect(platformConfigFor(fromEnv)).toEqual({ y8: { appId: "app-2", gameId: "game-1" } });
  });

  it.each([
    [{ WGF_Y8_APP_ID: "<app id>" }, /app_id "<app id>" is malformed/],
    [{ WGF_Y8_APP_ID: "ok", WGF_Y8_GAME_ID: "has space" }, /game_id "has space" is malformed/],
    [{ WGF_Y8_GAME_ID: "game-1" }, /needs app_id/],
  ])("malformed or incomplete settings fail the build: %j", (env, message) => {
    expect(() => resolveBuild(raw(), env)).toThrow(message);
  });

  it("agrees with the adapter's own validation for anything the build accepts", () => {
    const { target } = resolveBuild(raw({ app_id: "a.b_c-1", game_id: "g" }), {});
    expect(validateY8Config(platformConfigFor(target).y8)).toMatchObject({
      ok: true,
      warnings: [],
    });
  });
});

describe("the Vite plugin for a Y8 build", () => {
  const configFor = (id: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "wgf-y8-"));
    const base = parse(read("game.config.yaml")) as Record<string, unknown>;
    const path = join(dir, "game.config.yaml");
    writeFileSync(
      path,
      stringify({ ...base, platforms: [{ id, profile: `${id}@1.0.0`, role: "required" }] }),
    );
    return path;
  };

  const run = (id: string, env: Record<string, string>) => {
    const plugin = gameConfigPlugin({
      configPath: configFor(id),
      localesDir: resolve(root, "public/locales"),
      env,
    });
    const html = (plugin.transformIndexHtml as () => unknown)();
    const load = plugin.load as (this: unknown, id: string) => string | null;
    const module = load.call({ warn: () => undefined }, "\0virtual:platform-config");
    return { html, module };
  };

  it("configured: an async <script> in <head>, and the IDs in the bundle's platform config", () => {
    const { html, module } = run("y8", { WGF_Y8_APP_ID: "app-1", WGF_Y8_GAME_ID: "g-1" });
    expect(html).toEqual([
      { tag: "script", attrs: { src: Y8_SDK_URL, async: true }, injectTo: "head-prepend" },
    ]);
    expect(module).toBe(
      `export default ${JSON.stringify({ y8: { appId: "app-1", gameId: "g-1" } })};`,
    );
  });

  it("unconfigured: fails the build", () => {
    expect(() => run("y8", {})).toThrow(/y8 build needs app_id/);
  });

  it("unconfigured but let through: no script, and the game runs without the SDK", () => {
    const { html, module } = run("y8", { WGF_ALLOW_UNCONFIGURED_PORTAL: "1" });
    expect(html).toEqual([]);
    expect(module).toContain('"y8":null');
  });

  it("another platform's build never carries Y8 IDs or the Y8 script", () => {
    const { html, module } = run("generic-web", { WGF_Y8_APP_ID: "app-1" });
    expect(html).toEqual([]);
    expect(module).toContain('"y8":null');
  });
});

describe("the proposed Y8 profile", () => {
  const profile = parse(read("config/platforms/y8.yaml")) as {
    id: string;
    status: string;
    capabilities: { ads: string[]; cloud_saves: boolean; auth: string };
    requirements: { loading_api: string };
    assertions: { id: string; check: { left: string; right: string } }[];
  };

  it("describes what the docs document, and asserts the SDK is present", () => {
    expect(profile.id).toBe("y8");
    expect(profile.status).toBe("unverified");
    expect(profile.capabilities.ads).toEqual(["interstitial", "rewarded"]);
    expect(profile.capabilities.auth).toBe("optional");
    expect(profile.requirements.loading_api).toBe("none");
    expect(profile.assertions).toContainEqual(
      expect.objectContaining({
        id: "y8_sdk_present",
        check: expect.objectContaining({ left: "package.platform_sdk", right: "y8" }),
      }),
    );
  });

  it("is not passed off as vendored from the Factory", () => {
    const pinned = JSON.parse(read("config/platforms/pinned.json")) as {
      profiles: { id: string }[];
    };
    expect(pinned.profiles.map((p) => p.id)).not.toContain("y8");
  });
});
