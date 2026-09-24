#!/usr/bin/env node
// Package the built bundle once per targeted platform.
//
// Layout follows the Factory's release-candidate stage exactly:
//
//   release/<release-id>/
//     manifest.json      — written by make-manifest.mjs
//     <platform>.zip     — one package per targeted platform
//     checksums.txt
//     publications/<platform>.json
//
// Yandex requires a single index.html at the archive root, so the zip contains the contents
// of dist/, not a dist/ folder. Getting that wrong is a rejected submission that looks like
// a mystery.
//
// Usage: node scripts/release/package.mjs --release r1 [--platform <id>]

import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";
import { wrapperHtml } from "./gamedistribution-wrapper.mjs";

const RELEASE_ID = /^r[0-9]+$/;

export function sha256(buffer) {
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

/**
 * The files under `dir` that belong in a portal submission, as relative POSIX paths.
 *
 * Sourcemaps are deliberately excluded: the app build emits them (`sourcemap: "hidden"` in
 * vite.config.ts) so a release can be debugged on the build machine, but shipping them inside
 * the submission zip is dead weight (~4 MB uncompressed against caps as low as 50 MB) and
 * hands the game's readable source to anyone who unzips a public-portal build. They stay in
 * dist/, never in the archive.
 */
function submissionFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...submissionFiles(abs));
    } else if (!entry.name.endsWith(".map")) {
      out.push(abs);
    }
  }
  return out;
}

/** GameDistribution with `hosting: self-hosted`: the submission is the wrapper page only. */
export function isGameDistributionSelfHosted(target) {
  return target.id === "gamedistribution" && target.hosting === "self-hosted";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = args.release;
  if (!releaseId || !RELEASE_ID.test(releaseId)) {
    console.error(
      "usage: package.mjs --release r<n> [--platform <id>]   (release id must match ^r[0-9]+$)",
    );
    process.exit(2);
  }

  const root = repoRoot();
  const gameConfig = readGameConfig(root);
  const distDir = resolve(root, gameConfig.build?.output ?? "dist");

  if (!existsSync(distDir) || readdirSync(distDir).length === 0) {
    console.error(`${gameConfig.build?.output ?? "dist"} is empty — run \`pnpm build\` first`);
    process.exit(1);
  }

  const targets = args.platform
    ? gameConfig.platforms.filter((entry) => entry.id === args.platform)
    : gameConfig.platforms;
  if (targets.length === 0) {
    console.error(`game.config.yaml does not target platform "${args.platform}"`);
    process.exit(1);
  }

  const outDir = resolve(root, "release", releaseId);
  mkdirSync(outDir, { recursive: true });

  // Compute once: dist's shippable files, added at the archive root so index.html lands at
  // the top (Yandex requires it) and assets/ keeps its subfolder. Sourcemaps are dropped —
  // see submissionFiles.
  const files = submissionFiles(distDir);

  const packages = [];
  for (const target of targets) {
    const zip = new AdmZip();
    if (isGameDistributionSelfHosted(target)) {
      // A self-hosted GameDistribution title is served from game_url; what GameDistribution
      // receives is "a zipped index.html-file containing an iframe" with
      // gd_sdk_referrer_url (GD-HTML5 README). dist/ is deployed to game_url, not uploaded.
      zip.addFile("index.html", Buffer.from(wrapperHtml(target.game_url), "utf8"));
    } else {
      // addLocalFile with the CONTENTS at the archive root mirrors the old
      // addLocalFolder(dist, "") layout, minus the *.map files. The second arg is the zip
      // folder for the entry; the relative directory (posix-separated) preserves assets/
      // without a leading dist/.
      for (const abs of files) {
        const rel = relative(distDir, abs).split(sep);
        const zipFolder = rel.slice(0, -1).join("/");
        zip.addLocalFile(abs, zipFolder);
      }
    }
    const filename = `${target.id}.zip`;
    const zipPath = resolve(outDir, filename);
    zip.writeZip(zipPath);

    const bytes = readFileSync(zipPath);
    const entry = {
      platform_id: target.id,
      filename,
      size_mb: Number((bytes.length / 1024 / 1024).toFixed(3)),
      checksum: sha256(bytes),
    };
    packages.push(entry);
    console.log(`${filename}  ${entry.size_mb} MB  ${entry.checksum}`);
  }

  const checksums = packages.map((p) => `${p.checksum.slice("sha256:".length)}  ${p.filename}`);
  writeFileSync(resolve(outDir, "checksums.txt"), checksums.join("\n") + "\n");
  writeFileSync(resolve(outDir, "packages.json"), JSON.stringify(packages, null, 2) + "\n");

  console.log(`\nwrote release/${releaseId}/ (${packages.length} package(s), checksums.txt)`);
}

if (isEntryPoint(import.meta.url)) main();
