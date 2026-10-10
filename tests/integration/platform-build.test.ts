// One build carries one portal adapter.
//
// A portal rejects a bundle that carries another portal's SDK — CrazyGames: "Only Ads
// requested through the CrazyGames SDK are allowed" (https://docs.crazygames.com/requirements/ads/),
// which scripts/crazygames-audit.mjs checks as unexpected_dependencies. The Vite plugin
// defines __WGF_PLATFORM__ from game.config.yaml and createPlatform keeps only that adapter,
// so a production build for platform X must contain X's SDK signature and nobody else's.
//
// Slow by vitest standards (one production build per platform), so the builds run once.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { selectedPlatform } from "../../scripts/build/game-config-plugin.js";
import { validateGameConfig } from "../../src/core/game-config.js";

const ROOT = resolve(import.meta.dirname, "../..");

// What each adapter puts in a bundle and no other code does: its SDK URL or global. The same
// strings scripts/crazygames-audit.mjs looks for.
const SIGNATURES = {
  crazygames: /sdk\.crazygames\.com/,
  yandex: /YaGames\b/,
  poki: /game-cdn\.poki\.com|PokiSDK/,
  y8: /cdn\.y8\.com/,
  gamedistribution: /gamedistribution\.com|gdsdk/i,
  gamemonetize: /gamemonetize\.com/i,
} as const;
type Portal = keyof typeof SIGNATURES;
const PORTALS = Object.keys(SIGNATURES) as Portal[];
// Targets with no portal SDK: their build must carry none. generic-web is the scaffold's
// default target, so the most common build of all.
const NO_SDK = ["generic-web", "gamevui"] as const;
type Target = Portal | (typeof NO_SDK)[number];
const TARGETS: Target[] = [...PORTALS, ...NO_SDK];

const GAME_IDS: Partial<Record<Target, string>> = {
  gamedistribution: "0123456789abcdef0123456789abcdef",
  gamemonetize: "test000000000000000000000000000a",
};

function configFor(target: Target): Record<string, unknown> {
  // The target is the required entry; another portal rides along as optional, which is the
  // case that used to leak every adapter into the bundle.
  const other: Portal = target === "yandex" ? "poki" : "yandex";
  const entry = (id: Target, role: string) => ({
    id,
    profile: `${id}@1.0.0`,
    role,
    ...(GAME_IDS[id] ? { game_id: GAME_IDS[id] } : {}),
  });
  return {
    game: { id: `iso-${target}`, name: "Isolation", version: "0.1.0" },
    engine: { type: "pixijs" },
    platforms: [entry(other, "optional"), entry(target, "required")],
    monetization: { ad_kinds: ["interstitial", "rewarded"], iap: false },
    build: { command: "pnpm build", output: "dist" },
    verification: {},
    publishing: { enabled: false },
  };
}

/** Every file under `dir`, maps included: the CrazyGames audit reads those too. */
function bundleText(dir: string): string {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) => {
      const full = join(at, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  return walk(dir)
    .map((file) => readFileSync(file, "latin1"))
    .join("\n");
}

const work = mkdtempSync(join(tmpdir(), "wgf-platform-build-"));
const bundles = {} as Record<Target, string>;

beforeAll(() => {
  // The app imports @wgf/platform-sdk from its dist, as `pnpm build` does.
  execFileSync("pnpm", ["-r", "--filter", "./packages/*", "build"], {
    cwd: ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  for (const target of TARGETS) {
    const configPath = join(work, `${target}.game.config.yaml`);
    writeFileSync(configPath, stringify(configFor(target)));
    const outDir = join(work, target);
    execFileSync("pnpm", ["exec", "vite", "build", "--outDir", outDir, "--emptyOutDir"], {
      cwd: ROOT,
      stdio: "pipe",
      shell: process.platform === "win32",
      env: { ...process.env, WGF_GAME_CONFIG: configPath, WGF_Y8_APP_ID: "test-app" },
    });
    bundles[target] = bundleText(outDir);
  }
}, 600_000);

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("a build carries the selected platform's adapter alone", () => {
  for (const target of PORTALS) {
    it(`${target}: its own SDK, no other portal's`, () => {
      const text = bundles[target];
      // Booleans, not toMatch: a failure would otherwise print the whole bundle.
      expect(SIGNATURES[target].test(text), `${target} missing from its own build`).toBe(true);
      for (const other of PORTALS) {
        if (other !== target)
          expect(SIGNATURES[other].test(text), `${other} in a ${target} build`).toBe(false);
      }
    });
  }
  for (const target of NO_SDK) {
    it(`${target}: no portal SDK at all`, () => {
      const text = bundles[target];
      for (const portal of PORTALS)
        expect(SIGNATURES[portal].test(text), `${portal} in a ${target} build`).toBe(false);
    });
  }
});

describe("selectedPlatform", () => {
  it("is the first required entry, else the first — as primaryPlatform in src/core/config.ts", () => {
    expect(selectedPlatform(validateGameConfig(configFor("crazygames"))).id).toBe("crazygames");
    const none = configFor("crazygames") as { platforms: { role: string }[] };
    for (const entry of none.platforms) entry.role = "optional";
    expect(selectedPlatform(validateGameConfig(none)).id).toBe("yandex");
  });
});
