// Build the game once per engine × platform for the SDK browser smoke
// (tests/sdk-browser/, playwright.sdk.config.ts).
//
// Each bundle is the template game — the real PixiJS or Three.js renderer, the real boot
// sequence in src/main.ts — built against a generated game.config whose required platform
// is the one under test. Portal SDK scripts are not bundled: the adapters load them at
// runtime, and the browser test serves mocks in their place. Nothing is published.
//
//   node scripts/verify/sdk-smoke-build.mjs            -> build/sdk-smoke/<engine>-<platform>/
//
// CrazyGames is absent until its adapter is on this ref; GameVui has no SDK and ships the
// generic-web build (docs/platforms/gamevui/platform-contract.md), so generic-web stands in.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";

const root = resolve(import.meta.dirname, "..", "..");
const out = resolve(root, "build", "sdk-smoke");

export const ENGINES = ["pixijs", "threejs"];
export const PLATFORMS = [
  { id: "generic-web", profile: "generic-web@1.0.0", ad_kinds: [] },
  { id: "yandex", profile: "yandex@1.0.0", ad_kinds: ["interstitial", "rewarded"] },
  { id: "poki", profile: "poki@1.0.0", ad_kinds: ["interstitial", "rewarded"] },
];

// The game imports the @wgf/* packages from their dist, as `pnpm build` does.
execFileSync("pnpm", ["-r", "--filter", "./packages/*", "build"], { cwd: root, stdio: "inherit" });

const base = parse(readFileSync(resolve(root, "game.config.yaml"), "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const engine of ENGINES) {
  for (const platform of PLATFORMS) {
    const name = `${engine}-${platform.id}`;
    const config = {
      ...base,
      engine: { ...base.engine, type: engine },
      platforms: [{ id: platform.id, profile: platform.profile, role: "required" }],
      monetization: { ...base.monetization, ad_kinds: platform.ad_kinds },
    };
    const configPath = resolve(out, `${name}.game.config.yaml`);
    writeFileSync(configPath, stringify(config));
    // --base ./ so every bundle works from its own sub-directory of one preview server.
    execFileSync(
      "pnpm",
      [
        "exec",
        "vite",
        "build",
        "--base",
        "./",
        "--outDir",
        resolve(out, name),
        "--emptyOutDir",
        "--logLevel",
        "warn",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, WGF_GAME_CONFIG: configPath },
      },
    );
    console.log(`built ${name}`);
  }
}
