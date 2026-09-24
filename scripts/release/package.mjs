#!/usr/bin/env node
// Package each targeted platform's own build.
//
// Layout follows the Factory's release-candidate stage exactly:
//
//   release/<release-id>/
//     manifest.json      — written by make-manifest.mjs
//     <platform>.zip     — one package per targeted platform
//     packages.json      — per package: checksum, content digest, dist digest, build info
//     checksums.txt
//     publications/<platform>.json
//
// Every platform is built separately (`pnpm build:platforms`), because a build bundles only
// its own portal's adapter. So <platform>.zip is made from build/platforms/<id>/dist — never
// from dist/, which is a single dev/e2e build for one target — and only after the build it
// came from is shown to be the one being released:
//
//   - its build.json names the current HEAD (a build of another commit is stale),
//   - its portal was configured (a WGF_ALLOW_UNCONFIGURED_PORTAL=1 build is for tests only),
//   - its dist still hashes to the dist_digest recorded at build time (nothing edited since).
//
// The archives are deterministic: entries in name order, one fixed timestamp
// (SOURCE_DATE_EPOCH, else 1980-01-01T00:00:00Z), fixed permissions and "made by" host. The
// same dist gives the same bytes on any machine, so `checksum` identifies what ships, and
// re-running a release reproduces it rather than producing a lookalike.
//
// Portals serve the archive root, so the zip contains the contents of dist/, not a dist/
// folder, and index.html must be at the top. Getting that wrong is a rejected submission that
// looks like a mystery.
//
// Usage: node scripts/release/package.mjs --release r1 [--platform <id>]

import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";
import { wrapperHtml } from "./gamedistribution-wrapper.mjs";
import { entryNameProblem, uncompressedSizeProblem } from "./yandex-archive.mjs";

const RELEASE_ID = /^r[0-9]+$/;

/** 1980-01-01T00:00:00Z: the earliest instant an MS-DOS zip timestamp can hold. */
export const ZIP_EPOCH_MIN = Date.UTC(1980, 0, 1) / 1000;
const ZIP_EPOCH_MAX = Date.UTC(2107, 11, 31, 23, 59, 58) / 1000;

/** Unix mode of every file entry: -rw-r--r--, whatever the build machine's umask was. */
const FILE_MODE = 0o644;
/** "Version made by": zip 2.0 on UNIX, so the header does not record the packaging OS. */
const MADE_BY = 0x0300 | 20;

export class ReleaseRefusal extends Error {}

function refuse(message) {
  throw new ReleaseRefusal(message);
}

export function sha256(buffer) {
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The digest of a build directory, identical to the Factory's `bundle_digest`
 * (scripts/wgf_release/step.py): an os.walk — each directory's files in sorted order, then
 * its sorted subdirectories, node_modules skipped — feeding
 * `relpath-from-root utf8 + "\0" + sha256(bytes)` into one sha256. The path is relative to
 * the REPOSITORY root, not to the dist, so the digest also pins where the bundle lives.
 * Null for a directory without files, as there.
 */
export function distDigest(root, dir) {
  const outer = createHash("sha256");
  let count = 0;
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const dirs = entries.filter((e) => e.isDirectory() && e.name !== "node_modules");
    for (const name of files.sort(byCodePoint)) {
      const full = join(current, name);
      const rel = relative(root, full).split("\\").join("/");
      outer.update(Buffer.from(rel + "\0", "utf8"));
      outer.update(createHash("sha256").update(readFileSync(full)).digest());
      count++;
    }
    for (const name of dirs.map((e) => e.name).sort(byCodePoint)) walk(join(current, name));
  };
  walk(resolve(dir));
  return count > 0 ? "sha256:" + outer.digest("hex") : null;
}

/**
 * The Factory's `content_digest` of an archive: sha256 over `name + "\0" + sha256(bytes)` in
 * name order (scripts/wgf_release/package.py). Unlike `checksum` it ignores timestamps and
 * compression — what ships, not how it was wrapped.
 */
export function contentDigest(entries) {
  const outer = createHash("sha256");
  for (const { name, data } of [...entries].sort((a, b) => byCodePoint(a.name, b.name))) {
    outer.update(Buffer.from(name + "\0", "utf8"));
    outer.update(createHash("sha256").update(data).digest());
  }
  return "sha256:" + outer.digest("hex");
}

/**
 * Whether a dist file belongs in a portal submission.
 *
 * Sourcemaps are deliberately excluded: the app build emits them (`sourcemap: "hidden"` in
 * vite.config.ts) so a release can be debugged on the build machine, but shipping them inside
 * the submission zip is dead weight (~4 MB uncompressed against caps as low as 50 MB) and
 * hands the game's readable source to anyone who unzips a public-portal build. .gitkeep is a
 * repository placeholder that public/ can carry into dist/; it is not part of the game.
 */
export function isShipped(name) {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return !name.endsWith(".map") && base !== ".gitkeep";
}

/** The shippable files under `dir`: `{ name, data }`, POSIX names, in name order. */
export function submissionEntries(dir) {
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), name + "/");
      else if (entry.isFile() && isShipped(name)) {
        out.push({ name, data: readFileSync(join(current, entry.name)) });
      }
    }
  };
  walk(dir, "");
  return out.sort((a, b) => byCodePoint(a.name, b.name));
}

/**
 * The fixed entry timestamp, in seconds: SOURCE_DATE_EPOCH (reproducible-builds.org) when set,
 * else 1980-01-01T00:00:00Z. Earlier values are clamped — a zip cannot represent them.
 */
export function sourceDateEpoch(env = process.env) {
  const raw = env["SOURCE_DATE_EPOCH"];
  if (raw === undefined || raw === "") return ZIP_EPOCH_MIN;
  if (!/^[0-9]+$/.test(raw)) refuse(`SOURCE_DATE_EPOCH must be whole seconds, got "${raw}"`);
  const seconds = Number(raw);
  if (seconds > ZIP_EPOCH_MAX) refuse(`SOURCE_DATE_EPOCH ${raw} is past what a zip can hold`);
  return Math.max(seconds, ZIP_EPOCH_MIN);
}

/**
 * An MS-DOS date/time word pair from the UTC fields of `seconds`. adm-zip converts a Date with
 * its LOCAL-time getters, which would make the bytes depend on the packaging machine's
 * timezone; this is computed in UTC instead.
 */
export function dosTimestamp(seconds) {
  const d = new Date(seconds * 1000);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return ((date << 16) | time) >>> 0;
}

/** A deterministic zip of `entries` (already in the order they should appear). */
export function deterministicZip(entries, epochSeconds) {
  const zip = new AdmZip();
  const stamp = dosTimestamp(epochSeconds);
  for (const { name, data } of entries) {
    const entry = zip.addFile(name, data, "", FILE_MODE);
    entry.header.timeval = stamp;
    entry.header.made = MADE_BY;
  }
  return zip.toBuffer();
}

/** GameDistribution with `hosting: self-hosted`: the submission is the wrapper page only. */
export function isGameDistributionSelfHosted(target) {
  return target.id === "gamedistribution" && target.hosting === "self-hosted";
}

/** The current HEAD, or null outside a git work tree. */
export function gitHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return refuse(`${what} is not readable JSON (${error.message})`);
  }
}

/** `requirements.max_bundle_mb` of the vendored, pinned profile, when it declares one. */
function profileCapMb(root, platformId) {
  const path = resolve(root, "config/platforms", `${platformId}.yaml`);
  if (!existsSync(path)) return null;
  const cap = parse(readFileSync(path, "utf8"))?.requirements?.max_bundle_mb;
  return typeof cap === "number" ? cap : null;
}

/**
 * Check one platform's build and assemble its archive in memory. Refuses — nothing is
 * written — unless the build is present, current, configured and unmodified.
 */
function preparePackage({ root, target, indexEntry, head, epoch }) {
  const id = target.id;
  const platformDir = resolve(root, "build/platforms", id);
  const buildPath = resolve(platformDir, "build.json");
  const distRel = indexEntry.dir ?? `build/platforms/${id}/dist`;
  const distDir = resolve(root, distRel);

  if (!existsSync(buildPath)) {
    refuse(`build/platforms/${id}/build.json is missing — run \`pnpm build:platforms\` first`);
  }
  if (!existsSync(distDir) || readdirSync(distDir).length === 0) {
    refuse(`${distRel} is missing or empty — run \`pnpm build:platforms\` first`);
  }
  const build = readJson(buildPath, `build/platforms/${id}/build.json`);
  if (build.platform !== id) {
    refuse(`build/platforms/${id}/build.json is a build for "${build.platform}", not "${id}"`);
  }

  // Outside a git work tree there is no HEAD to compare with; only a build that recorded no
  // commit either (a tarball checkout, a fixture) may pass without one.
  if (head === null) {
    if (build.commit_sha !== null) {
      refuse(
        `${id}: build names commit ${build.commit_sha}, but this is not a git work tree, so ` +
          `the build cannot be tied to the checkout`,
      );
    }
  } else if (build.commit_sha !== head) {
    refuse(
      `${id}: build is stale — built from ${build.commit_sha ?? "no commit"}, HEAD is ${head}. ` +
        `Rebuild with \`pnpm build:platforms\``,
    );
  }

  if (build.portal_configured !== true || indexEntry.portal_configured === false) {
    refuse(
      `${id}: built without its portal id (portal_configured=false, ` +
        `WGF_ALLOW_UNCONFIGURED_PORTAL). Such a build is for tests only; configure the portal ` +
        `id and rebuild`,
    );
  }

  const digest = distDigest(root, distDir);
  for (const [source, recorded] of [
    [`build/platforms/${id}/build.json`, build.dist_digest],
    ["build/platforms/index.json", indexEntry.dist_digest],
  ]) {
    if (digest !== recorded) {
      refuse(
        `${id}: ${distRel} hashes to ${digest}, but ${source} recorded ${recorded} — the dist ` +
          `changed after it was built. Rebuild with \`pnpm build:platforms\``,
      );
    }
  }

  let entries;
  if (isGameDistributionSelfHosted(target)) {
    // A self-hosted GameDistribution title is served from game_url; what GameDistribution
    // receives is "a zipped index.html-file containing an iframe" with gd_sdk_referrer_url
    // (GD-HTML5 README). The dist is deployed to game_url, not uploaded.
    let html;
    try {
      html = wrapperHtml(target.game_url);
    } catch (error) {
      refuse(`${id}: ${error.message}`);
    }
    entries = [{ name: "index.html", data: Buffer.from(html, "utf8") }];
  } else {
    entries = submissionEntries(distDir);
  }

  if (!entries.some((entry) => entry.name === "index.html")) {
    refuse(`${id}: ${distRel} has no index.html at its root; portals serve the archive root`);
  }

  if (id === "yandex") {
    // Yandex requirements 1.21 / 1.22, the same rules scripts/release/yandex-archive.mjs
    // applies to a hand-packaged build.
    for (const { name } of entries) {
      const problem = entryNameProblem(name);
      if (problem) refuse(`yandex: ${problem}`);
    }
    const tooBig = uncompressedSizeProblem(entries.reduce((sum, e) => sum + e.data.length, 0));
    if (tooBig) refuse(`yandex: ${tooBig}`);
  }

  const bytes = deterministicZip(entries, epoch);
  const sizeMb = bytes.length / 1024 / 1024;
  const cap = profileCapMb(root, id);
  if (cap !== null && sizeMb > cap) {
    refuse(`${id}: package is ${sizeMb.toFixed(3)} MB; the ${id} profile caps it at ${cap} MB`);
  }

  const filename = `${id}.zip`;
  return {
    bytes,
    record: {
      platform_id: id,
      filename,
      size_mb: Number(sizeMb.toFixed(3)),
      checksum: sha256(bytes),
      content_digest: contentDigest(entries),
      files: entries.length,
      dist_digest: digest,
      build: {
        dir: distRel,
        profile: build.profile,
        role: build.role,
        engine: build.engine,
        game_version: build.game_version,
        commit_sha: build.commit_sha,
        portal_configured: build.portal_configured,
      },
    },
  };
}

/**
 * Package `release/<releaseId>/` from build/platforms under `root`. Returns the package
 * records. Throws ReleaseRefusal, before writing anything, when any target cannot ship.
 */
export function packageRelease({ root, releaseId, platform, env = process.env }) {
  if (!RELEASE_ID.test(releaseId ?? "")) refuse("release id must match ^r[0-9]+$");
  const gameConfig = readGameConfig(root);

  const targets = platform
    ? gameConfig.platforms.filter((entry) => entry.id === platform)
    : gameConfig.platforms;
  if (targets.length === 0) refuse(`game.config.yaml does not target platform "${platform}"`);

  const indexPath = resolve(root, "build/platforms/index.json");
  if (!existsSync(indexPath)) {
    refuse("build/platforms/index.json is missing — run `pnpm build:platforms` first");
  }
  const index = readJson(indexPath, "build/platforms/index.json");
  if (index.schema !== "wgf-platform-builds/1" || !Array.isArray(index.platforms)) {
    refuse(`build/platforms/index.json is not a wgf-platform-builds/1 index`);
  }

  const head = gitHead(root);
  const epoch = sourceDateEpoch(env);
  const prepared = targets.map((target) => {
    const indexEntry = index.platforms.find((entry) => entry.id === target.id);
    if (!indexEntry) {
      refuse(`${target.id} was not built (not in build/platforms/index.json)`);
    }
    return preparePackage({ root, target, indexEntry, head, epoch });
  });

  const packages = prepared.map((p) => p.record);
  const outDir = resolve(root, "release", releaseId);
  const packagesJson = JSON.stringify(packages, null, 2) + "\n";

  // A release with a manifest is frozen: its packages may be reproduced, never replaced.
  const manifestPath = resolve(outDir, "manifest.json");
  const packagesPath = resolve(outDir, "packages.json");
  if (existsSync(manifestPath)) {
    const existing = existsSync(packagesPath) ? readFileSync(packagesPath, "utf8") : null;
    if (existing !== packagesJson) {
      refuse(
        `release/${releaseId} already has a manifest and these packages differ from the ones ` +
          `it records; a release is immutable — cut a new release id`,
      );
    }
  }

  mkdirSync(outDir, { recursive: true });
  for (const { bytes, record } of prepared) writeFileSync(resolve(outDir, record.filename), bytes);
  const checksums = packages.map((p) => `${p.checksum.slice("sha256:".length)}  ${p.filename}`);
  writeFileSync(resolve(outDir, "checksums.txt"), checksums.join("\n") + "\n");
  writeFileSync(packagesPath, packagesJson);
  return packages;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = args.release;
  if (typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
    console.error(
      "usage: package.mjs --release r<n> [--platform <id>]   (release id must match ^r[0-9]+$)",
    );
    process.exit(2);
  }
  let packages;
  try {
    packages = packageRelease({
      root: repoRoot(),
      releaseId,
      platform: typeof args.platform === "string" ? args.platform : undefined,
    });
  } catch (error) {
    if (!(error instanceof ReleaseRefusal)) throw error;
    console.error(`release:package refused: ${error.message}`);
    process.exit(1);
  }
  for (const p of packages) console.log(`${p.filename}  ${p.size_mb} MB  ${p.checksum}`);
  console.log(`\nwrote release/${releaseId}/ (${packages.length} package(s), checksums.txt)`);
}

if (isEntryPoint(import.meta.url)) main();
