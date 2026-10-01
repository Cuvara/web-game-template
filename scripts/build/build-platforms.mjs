// One independent build per platforms[] entry.
//
//   node scripts/build/build-platforms.mjs [--out build/platforms] [--skip-packages]
//
//   build/platforms/<id>/dist/        the artifact for that platform
//   build/platforms/<id>/build.json   what was built: platform, profile, engine, digest
//   build/platforms/index.json        every platform built, in platforms[] order
//
// Each build is `vite build` with WGF_TARGET_PLATFORM=<id>, so it bundles that platform's
// adapter and no other (scripts/build/game-config-plugin.ts). A portal rejects a bundle that
// carries another portal's SDK, which one shared build for every platform always would.
//
// Every entry is resolved before anything is built: a missing portal id (y8 app_id,
// gamemonetize game_id, gamedistribution game_id) fails the whole run up front instead of
// after the first few builds. WGF_ALLOW_UNCONFIGURED_PORTAL=1 lets it through for tests,
// marked portal_configured=false, which release:package refuses.
//
// dist_digest is the Factory's bundle_digest over the dist directory (distDigest in
// scripts/_shared.mjs), so the Factory can recompute it from a checkout and compare.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  distDigest,
  isEntryPoint,
  parseArgs,
  readGameConfig,
  repoRoot,
  resolvePlatformBuild,
} from "../_shared.mjs";

/** The HEAD commit, or null outside a git checkout. */
function commitSha(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const toPosix = (path) => path.split(sep).join("/");

/**
 * Build every platform. `out` is repo-relative: dist_digest hashes paths relative to the
 * repository root, and index.json records each dist by that same relative path.
 */
export function buildPlatforms({
  root = repoRoot(),
  out = "build/platforms",
  env = process.env,
  skipPackages = false,
  log = console.log,
} = {}) {
  const outDir = resolve(root, out);
  const outRel = toPosix(relative(root, outDir));
  if (isAbsolute(outRel) || outRel.startsWith("..") || outRel === "") {
    throw new Error(`--out must be a directory inside the repository, got ${out}`);
  }

  const gameConfig = readGameConfig(root, env);
  // Resolve all first: a run that cannot build every platform builds none.
  const builds = gameConfig.platforms.map((entry) => resolvePlatformBuild(root, entry.id, env));

  if (!skipPackages) {
    execFileSync("pnpm", ["-r", "--filter", "./packages/*", "build"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const vite = resolve(
    dirname(createRequire(resolve(root, "package.json")).resolve("vite/package.json")),
    "bin/vite.js",
  );
  const sha = commitSha(root);
  const index = {
    schema: "wgf-platform-builds/1",
    game_id: gameConfig.game.id,
    game_version: gameConfig.game.version,
    engine: gameConfig.engine.type,
    commit_sha: sha,
    platforms: [],
  };

  for (const { config, target, portalConfigured } of builds) {
    const platformDir = resolve(outDir, target.id);
    const distRel = `${outRel}/${target.id}/dist`;
    log(`building ${target.id} (${config.engine.type}) -> ${distRel}`);
    execFileSync(
      process.execPath,
      [vite, "build", "--outDir", resolve(root, distRel), "--emptyOutDir", "--logLevel", "warn"],
      { cwd: root, stdio: "inherit", env: { ...env, WGF_TARGET_PLATFORM: target.id } },
    );
    const digest = distDigest(root, distRel);
    if (!digest) throw new Error(`${distRel} is empty after the ${target.id} build`);
    const build = {
      schema: "wgf-platform-build/1",
      platform: target.id,
      profile: target.profile,
      role: target.role,
      engine: config.engine.type,
      game_id: config.game.id,
      game_version: config.game.version,
      commit_sha: sha,
      dist_digest: digest,
      portal_configured: portalConfigured,
    };
    writeFileSync(resolve(platformDir, "build.json"), JSON.stringify(build, null, 2) + "\n");
    index.platforms.push({
      id: target.id,
      profile: target.profile,
      role: target.role,
      dir: distRel,
      dist_digest: digest,
      portal_configured: portalConfigured,
    });
    log(`built ${target.id}: ${digest}${portalConfigured ? "" : " (portal NOT configured)"}`);
  }

  writeFileSync(resolve(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

if (isEntryPoint(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    buildPlatforms({
      ...(typeof args.out === "string" ? { out: args.out } : {}),
      skipPackages: args["skip-packages"] === true,
    });
  } catch (error) {
    console.error(`build:platforms: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
