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
// GameVui has no SDK and ships the generic-web build
// (docs/platforms/gamevui/platform-contract.md), so generic-web stands in.

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
  { id: "crazygames", profile: "crazygames@1.0.0", ad_kinds: ["interstitial", "rewarded"] },
  // Placeholder IDs, not credentials: the browser test serves a mock in place of the CDN
  // script, so they never reach Y8. They make the build inject the documented <script async>.
  {
    id: "y8",
    profile: "y8@1.0.0",
    ad_kinds: ["interstitial", "rewarded"],
    env: { WGF_Y8_APP_ID: "wgf-smoke-app", WGF_Y8_GAME_ID: "wgf-smoke-game" },
  },
  // The same target built with no Y8 settings at all: the game must still boot. A build
  // without an App ID fails unless explicitly let through, as here.
  {
    id: "y8",
    name: "y8-unconfigured",
    profile: "y8@1.0.0",
    ad_kinds: ["interstitial", "rewarded"],
    env: { WGF_Y8_APP_ID: "", WGF_Y8_GAME_ID: "", WGF_ALLOW_UNCONFIGURED_PORTAL: "1" },
  },
  // A Game ID shaped like a real one and belonging to no title (tests/gamedistribution/
  // fake-sdk.ts TEST_GD_GAME_ID). The browser smoke serves a mock SDK, so it is never sent.
  {
    id: "gamedistribution",
    profile: "gamedistribution@1.0.0",
    ad_kinds: ["interstitial", "rewarded"],
    entry: { game_id: "0123456789abcdef0123456789abcdef" },
  },
  // A placeholder shaped like a GameMonetize Game ID — never a real one — and a build with
  // none, which must run without ever requesting the SDK.
  {
    id: "gamemonetize",
    profile: "gamemonetize@1.0.0",
    ad_kinds: ["interstitial"],
    game_id: "smoke000000000000000000000000000",
  },
  {
    id: "gamemonetize",
    name: "gamemonetize-no-game-id",
    profile: "gamemonetize@1.0.0",
    ad_kinds: ["interstitial"],
    env: { WGF_ALLOW_UNCONFIGURED_PORTAL: "1" },
  },
];

// The game imports the @wgf/* packages from their dist, as `pnpm build` does.
execFileSync("pnpm", ["-r", "--filter", "./packages/*", "build"], { cwd: root, stdio: "inherit" });

const base = parse(readFileSync(resolve(root, "game.config.yaml"), "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const engine of ENGINES) {
  for (const platform of PLATFORMS) {
    const name = `${engine}-${platform.name ?? platform.id}`;
    const entry = {
      id: platform.id,
      profile: platform.profile,
      role: "required",
      ...platform.entry,
    };
    if (platform.game_id) entry.game_id = platform.game_id;
    const config = {
      ...base,
      engine: { ...base.engine, type: engine },
      platforms: [entry],
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
        // A GameMonetize Game ID comes from the generated config only, never from the
        // environment. The target is the config's one entry, and only the variants that say
        // so may build without their portal ids.
        env: {
          ...process.env,
          WGF_TARGET_PLATFORM: "",
          WGF_ALLOW_UNCONFIGURED_PORTAL: "",
          ...(platform.env ?? {}),
          WGF_GAME_CONFIG: configPath,
          WGF_GAMEMONETIZE_GAME_ID: "",
        },
      },
    );
    console.log(`built ${name}`);
  }
}
