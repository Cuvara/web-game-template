// What a build decides from game.config.yaml and the environment: which platform it is for,
// which portal ids it carries, and whether it may be built at all (PLAN §1, contract 2).
//
// The rules live in src/core/game-config.ts. scripts/_shared.mjs evaluates that same file for
// the plain-Node scripts, so the last block checks the two entry points give one answer.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { KNOWN_PLATFORM_IDS as SDK_PLATFORM_IDS } from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
// @ts-expect-error — plain ESM script without type declarations.
import * as shared from "../../scripts/_shared.mjs";
import {
  KNOWN_PLATFORM_IDS,
  applyPortalIdOverrides,
  missingPortalIds,
  resolveBuild,
  resolveTargetPlatform,
  validateGameConfig,
  type PlatformEntry,
} from "../../src/core/game-config.js";

const ROOT = resolve(import.meta.dirname, "../..");
const GD_ID = "0123456789abcdef0123456789abcdef";
const GM_ID = "test000000000000000000000000000a";

type Entry = Record<string, unknown>;
const entry = (id: string, extra: Entry = {}, role = "required"): Entry => ({
  id,
  profile: `${id}@1.0.0`,
  role,
  ...extra,
});
const config = (...platforms: Entry[]) => ({
  game: { id: "g", name: "G", version: "0.1.0" },
  engine: { type: "pixijs" },
  platforms,
  monetization: { ad_kinds: [], iap: false },
  build: { command: "pnpm build", output: "dist" },
  verification: {},
  publishing: { enabled: false },
});

describe("platform ids", () => {
  it("are the ids @wgf/platform-sdk has adapters for", () => {
    expect([...KNOWN_PLATFORM_IDS]).toEqual([...SDK_PLATFORM_IDS]);
  });

  it("an unknown id fails", () => {
    expect(() => validateGameConfig(config(entry("newgrounds")))).toThrow(/not a known platform/);
  });

  it("a repeated id fails: one build per id", () => {
    expect(() => validateGameConfig(config(entry("poki"), entry("poki", {}, "optional")))).toThrow(
      /listed twice/,
    );
  });

  it("a profile pinned to another platform fails", () => {
    expect(() => validateGameConfig(config({ ...entry("poki"), profile: "yandex@1.0.0" }))).toThrow(
      /does not match id/,
    );
  });
});

describe("portal ids on platform entries", () => {
  it("y8 takes app_id and game_id", () => {
    expect(() =>
      validateGameConfig(config(entry("y8", { app_id: "app-1", game_id: "game.1" }))),
    ).not.toThrow();
  });

  it("app_id is y8's alone; game_id is not read for portals without one", () => {
    expect(() => validateGameConfig(config(entry("poki", { app_id: "a" })))).toThrow(
      /app_id applies to y8 only/,
    );
    expect(() => validateGameConfig(config(entry("poki", { game_id: GM_ID })))).toThrow(
      /only read for/,
    );
  });

  it.each([{ app_id: "<app id>" }, { app_id: "ok", game_id: "has space" }, { app_id: 7 }])(
    "a malformed y8 id fails: %j",
    (ids) => {
      expect(() => validateGameConfig(config(entry("y8", ids)))).toThrow(/malformed/);
    },
  );

  it("the environment overrides the file, and an empty variable counts as unset", () => {
    const raw = config(entry("y8", { app_id: "from-file" }), entry("gamemonetize", {}, "optional"));
    const overridden = applyPortalIdOverrides(raw, {
      WGF_Y8_APP_ID: " from-env ",
      WGF_Y8_GAME_ID: "",
      WGF_GAMEMONETIZE_GAME_ID: GM_ID,
    }) as ReturnType<typeof config>;
    expect(overridden.platforms).toEqual([
      entry("y8", { app_id: "from-env" }),
      entry("gamemonetize", { game_id: GM_ID }, "optional"),
    ]);
    // A copy: the parsed file is left as it was.
    expect(raw.platforms[0]).toEqual(entry("y8", { app_id: "from-file" }));
  });

  it("an override applies only to its own platform's entry", () => {
    const overridden = applyPortalIdOverrides(config(entry("poki")), {
      WGF_Y8_APP_ID: "a",
      WGF_GAMEMONETIZE_GAME_ID: GM_ID,
    }) as ReturnType<typeof config>;
    expect(overridden.platforms).toEqual([entry("poki")]);
  });

  it("names what each portal build is missing", () => {
    const missing = (e: Entry) => missingPortalIds(e as unknown as PlatformEntry);
    expect(missing(entry("y8", { game_id: "g" }))).toEqual(["app_id"]);
    expect(missing(entry("gamemonetize"))).toEqual(["game_id"]);
    expect(missing(entry("gamedistribution"))).toEqual(["game_id"]);
    expect(missing(entry("poki"))).toEqual([]);
    expect(missing(entry("y8", { app_id: "a" }))).toEqual([]);
  });
});

describe("the build target", () => {
  const three = validateGameConfig(
    config(entry("generic-web", {}, "optional"), entry("poki"), entry("crazygames")),
  );

  it("defaults to the first required entry, else the first entry", () => {
    expect(resolveTargetPlatform(three, {}).id).toBe("poki");
    const optionalOnly = validateGameConfig(
      config(entry("yandex", {}, "optional"), entry("poki", {}, "optional")),
    );
    expect(resolveTargetPlatform(optionalOnly, {}).id).toBe("yandex");
  });

  it("WGF_TARGET_PLATFORM picks any entry, and must name one", () => {
    expect(resolveTargetPlatform(three, { WGF_TARGET_PLATFORM: "generic-web" }).id).toBe(
      "generic-web",
    );
    expect(resolveTargetPlatform(three, { WGF_TARGET_PLATFORM: "" }).id).toBe("poki");
    expect(() => resolveTargetPlatform(three, { WGF_TARGET_PLATFORM: "yandex" })).toThrow(
      /WGF_TARGET_PLATFORM "yandex" is not in platforms\[\]/,
    );
  });
});

describe("a build whose portal ids are missing", () => {
  it.each([
    ["y8", entry("y8"), /y8 build needs app_id .*WGF_Y8_APP_ID/],
    ["gamemonetize", entry("gamemonetize"), /gamemonetize build needs game_id .*WGF_GAMEMONETIZE/],
  ])("fails for %s", (_id, platform, message) => {
    expect(() => resolveBuild(config(platform), {})).toThrow(message);
  });

  it("gamedistribution fails already at validation: its Game ID has no default", () => {
    expect(() => resolveBuild(config(entry("gamedistribution")), {})).toThrow(/game_id/);
  });

  it("builds, marked unconfigured, only with WGF_ALLOW_UNCONFIGURED_PORTAL=1", () => {
    const build = resolveBuild(config(entry("y8")), { WGF_ALLOW_UNCONFIGURED_PORTAL: "1" });
    expect(build.target.id).toBe("y8");
    expect(build.portalConfigured).toBe(false);
    expect(() =>
      resolveBuild(config(entry("y8")), { WGF_ALLOW_UNCONFIGURED_PORTAL: "true" }),
    ).toThrow(/needs app_id/);
  });

  it("only the target's ids matter: another entry may still lack its own", () => {
    const raw = config(entry("poki"), entry("y8", {}, "optional"));
    expect(resolveBuild(raw, {})).toMatchObject({ portalConfigured: true, target: { id: "poki" } });
    expect(() => resolveBuild(raw, { WGF_TARGET_PLATFORM: "y8" })).toThrow(/needs app_id/);
  });

  it("is configured once the environment supplies the ids", () => {
    const build = resolveBuild(config(entry("y8"), entry("gamedistribution", { game_id: GD_ID })), {
      WGF_Y8_APP_ID: "app-1",
    });
    expect(build.portalConfigured).toBe(true);
    expect(build.target).toEqual(entry("y8", { app_id: "app-1" }));
  });
});

describe("scripts/_shared.mjs applies the same rules", () => {
  const write = (raw: unknown): string => {
    const path = join(mkdtempSync(join(tmpdir(), "wgf-shared-")), "game.config.yaml");
    writeFileSync(path, stringify(raw));
    return path;
  };
  const cases: [string, unknown][] = [
    ["valid", config(entry("poki"), entry("y8", { app_id: "a" }, "optional"))],
    ["unknown id", config(entry("newgrounds"))],
    ["duplicate id", config(entry("poki"), entry("poki", {}, "optional"))],
    ["pin mismatch", config({ ...entry("poki"), profile: "yandex@1.0.0" })],
    ["bad gd id", config(entry("gamedistribution", { game_id: "abc" }))],
    ["bad engine", { ...config(entry("poki")), engine: { type: "godot" } }],
  ];

  it.each(cases)("readGameConfig agrees with validateGameConfig: %s", (_name, raw) => {
    const env = { WGF_GAME_CONFIG: write(raw) };
    let expected: unknown;
    try {
      expected = validateGameConfig(raw);
    } catch (error) {
      expect(() => shared.readGameConfig(ROOT, env)).toThrow((error as Error).message);
      return;
    }
    expect(shared.readGameConfig(ROOT, env)).toEqual(expected);
  });

  it("applies the environment overrides and resolves the target the same way", () => {
    const raw = config(entry("generic-web", {}, "optional"), entry("y8"), entry("gamemonetize"));
    const env = {
      WGF_GAME_CONFIG: write(raw),
      WGF_Y8_APP_ID: "app-1",
      WGF_GAMEMONETIZE_GAME_ID: GM_ID,
    };
    const loaded = shared.readGameConfig(ROOT, env);
    expect(loaded).toEqual(validateGameConfig(applyPortalIdOverrides(raw, env)));
    expect(shared.targetPlatform(loaded, env).id).toBe("y8");
    expect(shared.targetPlatform(loaded, { WGF_TARGET_PLATFORM: "gamemonetize" }).id).toBe(
      "gamemonetize",
    );
    expect(shared.resolvePlatformBuild(ROOT, "gamemonetize", env)).toEqual(
      resolveBuild(raw, { ...env, WGF_TARGET_PLATFORM: "gamemonetize" }),
    );
    expect(() =>
      shared.resolvePlatformBuild(ROOT, "gamemonetize", { WGF_GAME_CONFIG: env.WGF_GAME_CONFIG }),
    ).toThrow(/needs game_id/);
  });
});
