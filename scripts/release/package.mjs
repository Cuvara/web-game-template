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
import { resolve } from "node:path";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

const RELEASE_ID = /^r[0-9]+$/;

export function sha256(buffer) {
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = args.release;
  if (!releaseId || !RELEASE_ID.test(releaseId)) {
    console.error("usage: package.mjs --release r<n> [--platform <id>]   (release id must match ^r[0-9]+$)");
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

  const packages = [];
  for (const target of targets) {
    const zip = new AdmZip();
    // addLocalFolder with an empty zipPath puts dist's CONTENTS at the archive root.
    zip.addLocalFolder(distDir, "");
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
