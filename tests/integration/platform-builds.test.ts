// pnpm build:platforms, for real: one vite build per platforms[] entry, each isolated.
//
// A portal rejects a bundle that carries another portal's SDK, and every profile caps size, so
// a build for platform X must contain X's adapter alone and the configured engine alone. This
// builds two multi-platform configs — one per engine — through scripts/build/build-platforms.mjs
// and scans every shipped file for the signatures in packages/platform-sdk/sdk-signatures.json
// (the list release facts collection reads too) and for the other engine.
//
// Slow by vitest standards (six production builds), so each config is built once and shared.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";
// @ts-expect-error — plain ESM script without type declarations.
import { buildPlatforms } from "../../scripts/build/build-platforms.mjs";
// @ts-expect-error — plain ESM script without type declarations.
import { distDigest, testedEngines } from "../../scripts/_shared.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = `build/test-platforms-${process.pid}`;
const signatures = JSON.parse(
  readFileSync(resolve(ROOT, "packages/platform-sdk/sdk-signatures.json"), "utf8"),
) as Record<string, string[]>;

// Strings each engine's framework puts in its bundle and nothing else does: three.js registers
// window.__THREE__, and PixiJS names itself in its deprecation and error messages.
const ENGINE_SIGNATURES = { pixijs: ["pixi.js"], threejs: ["__THREE__"] } as const;
type Engine = keyof typeof ENGINE_SIGNATURES;

interface BuildJson {
  schema: string;
  platform: string;
  profile: string;
  role: string;
  engine: string;
  game_id: string;
  game_version: string;
  commit_sha: string | null;
  dist_digest: string;
  portal_configured: boolean;
}
interface IndexJson {
  schema: string;
  game_id: string;
  game_version: string;
  engine: string;
  commit_sha: string | null;
  platforms: {
    id: string;
    profile: string;
    role: string;
    dir: string;
    dist_digest: string;
    portal_configured: boolean;
  }[];
}

const entry = (id: string, role: string, extra: Record<string, string> = {}) => ({
  id,
  profile: `${id}@1.0.0`,
  role,
  ...extra,
});

// Both engines in the template itself. In a game repository only the game's own engine: its
// code imports that engine's library directly, so a build for the other engine would bundle
// both and prove nothing about a combination that never ships.
const ENGINES = testedEngines(ROOT) as Engine[];

const RUNS: Record<Engine, { platforms: ReturnType<typeof entry>[]; env: NodeJS.ProcessEnv }> = {
  pixijs: {
    platforms: [
      entry("generic-web", "required"),
      entry("y8", "optional", { app_id: "wgf-test-app", game_id: "wgf-test-game" }),
      entry("yandex", "optional"),
    ],
    env: {},
  },
  threejs: {
    platforms: [
      entry("poki", "required"),
      entry("crazygames", "optional"),
      entry("gamemonetize", "optional"),
    ],
    // No game_id on the gamemonetize entry: the environment supplies it, as a release job would.
    env: { WGF_GAMEMONETIZE_GAME_ID: "test000000000000000000000000000a" },
  },
};

/** Every shipped file under `dir` — what a zip would contain, so no source maps. */
function shippedText(dir: string): string {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) => {
      const full = join(at, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  return walk(dir)
    .filter((file) => !file.endsWith(".map"))
    .map((file) => readFileSync(file, "latin1"))
    .join("\n");
}

const results = {} as Record<Engine, { out: string; index: IndexJson }>;

beforeAll(() => {
  // The app imports the @wgf/* packages from their dist, as `pnpm build` does.
  execFileSync("pnpm", ["-r", "--filter", "./packages/*", "build"], {
    cwd: ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const configDir = mkdtempSync(join(tmpdir(), "wgf-platforms-"));
  for (const engine of ENGINES) {
    const configPath = join(configDir, `${engine}.game.config.yaml`);
    writeFileSync(
      configPath,
      stringify({
        game: { id: `iso-${engine}`, name: "Isolation", version: "0.3.0" },
        engine: { type: engine },
        platforms: RUNS[engine].platforms,
        monetization: { ad_kinds: ["interstitial", "rewarded"], iap: false },
        build: { command: "pnpm build", output: "dist" },
        verification: {},
        publishing: { enabled: false },
      }),
    );
    const out = `${OUT}/${engine}`;
    const env = {
      ...process.env,
      WGF_TARGET_PLATFORM: "",
      WGF_ALLOW_UNCONFIGURED_PORTAL: "",
      WGF_Y8_APP_ID: "",
      WGF_Y8_GAME_ID: "",
      WGF_GAMEMONETIZE_GAME_ID: "",
      ...RUNS[engine].env,
      WGF_GAME_CONFIG: configPath,
    };
    const index = buildPlatforms({ root: ROOT, out, env, skipPackages: true, log: () => {} });
    results[engine] = { out, index };
  }
}, 600_000);

afterAll(() => {
  rmSync(resolve(ROOT, OUT), { recursive: true, force: true });
});

describe.each(ENGINES)("build:platforms, %s", (engine) => {
  const ids = RUNS[engine].platforms.map((platform) => platform.id);
  const other: Engine = engine === "pixijs" ? "threejs" : "pixijs";

  it("writes index.json listing every platform in platforms[] order", () => {
    const { index, out } = results[engine];
    expect(index).toEqual(
      JSON.parse(readFileSync(resolve(ROOT, out, "index.json"), "utf8")) as IndexJson,
    );
    expect(index).toMatchObject({
      schema: "wgf-platform-builds/1",
      game_id: `iso-${engine}`,
      game_version: "0.3.0",
      engine,
    });
    expect(index.platforms.map((platform) => platform.id)).toEqual(ids);
    expect(index.platforms.map((platform) => platform.dir)).toEqual(
      ids.map((id) => `${out}/${id}/dist`),
    );
  });

  it.each(ids)("%s: build.json describes the build, and its digest is the dist's", (id) => {
    const { index, out } = results[engine];
    const build = JSON.parse(
      readFileSync(resolve(ROOT, out, id, "build.json"), "utf8"),
    ) as BuildJson;
    const listed = index.platforms.find((platform) => platform.id === id)!;
    expect(build).toEqual({
      schema: "wgf-platform-build/1",
      platform: id,
      profile: `${id}@1.0.0`,
      role: listed.role,
      engine,
      game_id: `iso-${engine}`,
      game_version: "0.3.0",
      commit_sha: index.commit_sha,
      dist_digest: listed.dist_digest,
      portal_configured: true,
    });
    expect(build.dist_digest).toBe(distDigest(ROOT, `${out}/${id}/dist`));
  });

  it("gives every platform its own digest", () => {
    const digests = results[engine].index.platforms.map((platform) => platform.dist_digest);
    expect(new Set(digests).size).toBe(digests.length);
  });

  it.each(ids)("%s: bundles its own portal SDK and no other", (id) => {
    const text = shippedText(resolve(ROOT, results[engine].out, id, "dist"));
    for (const [platform, list] of Object.entries(signatures)) {
      for (const signature of list) {
        const found = text.includes(signature);
        expect(found, `${id} build, ${platform} signature "${signature}"`).toBe(platform === id);
      }
    }
  });

  it.each(ids)(`%s: bundles ${engine} and not ${other}`, (id) => {
    const text = shippedText(resolve(ROOT, results[engine].out, id, "dist"));
    for (const signature of ENGINE_SIGNATURES[engine]) expect(text).toContain(signature);
    for (const signature of ENGINE_SIGNATURES[other]) expect(text).not.toContain(signature);
  });
});

describe("build:platforms refuses before building anything", () => {
  const writeConfig = (platforms: ReturnType<typeof entry>[]): string => {
    const path = join(mkdtempSync(join(tmpdir(), "wgf-platforms-")), "game.config.yaml");
    writeFileSync(
      path,
      stringify({
        game: { id: "refused", name: "Refused", version: "0.1.0" },
        engine: { type: "pixijs" },
        platforms,
        monetization: { ad_kinds: [], iap: false },
        build: { command: "pnpm build", output: "dist" },
        verification: {},
        publishing: { enabled: false },
      }),
    );
    return path;
  };
  const attempt = (platforms: ReturnType<typeof entry>[], env: NodeJS.ProcessEnv = {}) =>
    buildPlatforms({
      root: ROOT,
      out: `${OUT}/refused`,
      env: { WGF_GAME_CONFIG: writeConfig(platforms), ...env },
      skipPackages: true,
      log: () => {},
    });

  it("a platform missing its portal id fails the whole run", () => {
    expect(() => attempt([entry("poki", "required"), entry("y8", "optional")])).toThrow(
      /y8 build needs app_id/,
    );
    expect(() => statSync(resolve(ROOT, OUT, "refused"))).toThrow();
  });

  it("an output directory outside the repository", () => {
    expect(() =>
      buildPlatforms({ root: ROOT, out: relative(ROOT, tmpdir()), skipPackages: true }),
    ).toThrow(/inside the repository/);
  });
});
