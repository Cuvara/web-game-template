// Build the template game against one engine, without editing game.config.yaml.
//
//   node scripts/verify/engine-build.mjs phaserjs     -> dist/, built for engine.type phaserjs
//
// The template implements more than one engine and the committed game.config.yaml can only
// name one of them, so a build of the others is never proved by `pnpm build` alone. This
// generates a config that differs from the committed one in `engine.type` and nothing else,
// then runs the normal build against it through WGF_GAME_CONFIG — the same hook the SDK
// smoke build uses. The e2e suite then runs unchanged (`pnpm preview`, `pnpm test:e2e`), so
// every engine is judged by the same boot, canvas and stepping assertions.
//
// An engine the template does not implement is rejected by the build's own validator
// (src/core/game-config.ts, through the game-config plugin), which is the one list of
// engines — this script deliberately keeps no copy of it.
//
// It builds; it asserts nothing. Playwright does that.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const root = resolve(import.meta.dirname, "..", "..");
const out = resolve(root, "build", "engine");

/** Writes game.config.yaml with `engine.type` replaced, and returns its path. */
export function writeEngineConfig(engine, { rootDir = root, outDir = out } = {}) {
  const config = parse(readFileSync(resolve(rootDir, "game.config.yaml"), "utf8"));
  config.engine = { ...config.engine, type: engine };
  mkdirSync(outDir, { recursive: true });
  const path = resolve(outDir, `${engine}.game.config.yaml`);
  writeFileSync(path, stringify(config), "utf8");
  return path;
}

function main(argv) {
  const engine = argv[0];
  if (!engine) {
    console.error("usage: node scripts/verify/engine-build.mjs <engine.type>");
    process.exit(2);
  }
  const configPath = writeEngineConfig(engine);
  console.warn(`building engine.type: ${engine}`);
  execFileSync("pnpm", ["build"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, WGF_GAME_CONFIG: configPath },
  });
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
