#!/usr/bin/env node
// Build the GameVui submission package from dist/.
//
// GameVui documents one thing about submissions: send the game by email or through the
// contact form (docs/platforms/gamevui/source-matrix.md). It documents no format and no
// required files, so the package holds only what that needs and nothing invented:
//
//   release/gamevui/
//     build/<slug>-<version>.zip   the web build, index.html at the archive root
//     manifest/manifest.json       what is in the zip, sizes and SHA-256 digests
//     manifest/checksums.txt
//     submission-report.md         written by check-compliance.mjs, not here
//
// No screenshots/ or metadata/ folder: GameVui asks for neither, and packaging them would
// imply it does. The title, description and controls a GameVui game page shows go into the
// cover-email draft in submission-report.md instead.
//
// Deterministic: entries sorted, timestamps and permissions fixed, no build time recorded.
// Two runs over the same dist/ produce byte-identical files.
//
// This script sends nothing anywhere.
//
// Usage: node scripts/package-submission.mjs [--dist <dir>] [--out <dir>]

import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXAMPLE_ROOT, OUT_DIR, REPO_ROOT, walk } from "./audit.mjs";

/**
 * Zip entries store DOS time, which is local wall-clock time with no zone. Built with the
 * local-time constructor so every machine writes the same fields (2000-01-01 00:00) — a
 * UTC Date would come out as a different wall-clock time, and different bytes, per zone.
 */
const FIXED_TIME = new Date(2000, 0, 1, 0, 0, 0);
/**
 * Permission bits only: adm-zip adds the regular-file type and shifts into the high word
 * itself. A pre-shifted value is masked to zero, and Info-ZIP then extracts files nobody
 * can read — which is what this used to do.
 */
const FILE_ATTR = 0o644;
const EXPECTED_MODE = 0o100644;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Zip dist/'s contents (not the folder) deterministically. */
export function zipBuild(distDir) {
  const zip = new AdmZip();
  const entries = walk(distDir).map((file) => relative(distDir, file).split("\\").join("/"));
  for (const name of entries) {
    zip.addFile(name, readFileSync(join(distDir, name)), "", FILE_ATTR);
    const entry = zip.getEntry(name);
    entry.header.time = FIXED_TIME;
  }
  return { buffer: zip.toBuffer(), entries };
}

export function buildPackage({ distDir, outDir, metadata }) {
  const first = zipBuild(distDir);
  const second = zipBuild(distDir);
  const zipName = `${metadata.slug}-${metadata.version}.zip`;

  const rereadEntries = new AdmZip(first.buffer).getEntries();
  const reread = rereadEntries.map((entry) => entry.entryName);
  const badModes = rereadEntries.filter((entry) => entry.attr >>> 16 !== EXPECTED_MODE);
  const checks = {
    "package.index_at_root": {
      ok: reread.includes("index.html"),
      detail: reread.includes("index.html")
        ? "index.html at archive root"
        : "no index.html at archive root",
    },
    "package.entry_modes": {
      ok: badModes.length === 0,
      detail: badModes.length
        ? `${badModes.length} entries not mode 0644, e.g. ${badModes[0].entryName} ${(badModes[0].attr >>> 16).toString(8)}`
        : "every entry is a regular file, mode 0644",
    },
    "package.deterministic_layout": {
      ok: first.buffer.equals(second.buffer),
      detail: first.buffer.equals(second.buffer)
        ? `two builds of the zip are byte-identical (sha256 ${sha256(first.buffer).slice(0, 12)}…)`
        : "two builds of the zip differ",
    },
  };

  const manifest = {
    generator: "examples/gamevui-compliance-demo/scripts/package-submission.mjs",
    platform: "gamevui",
    note: "GameVui publishes no package format. This layout is this repository's, not GameVui's.",
    game: { slug: metadata.slug, version: metadata.version, title: metadata.title },
    zip: {
      file: `build/${zipName}`,
      bytes: first.buffer.length,
      sha256: sha256(first.buffer),
      entries: first.entries.map((name) => {
        const bytes = readFileSync(join(distDir, name));
        return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
      }),
    },
  };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "build"), { recursive: true });
  mkdirSync(join(outDir, "manifest"), { recursive: true });
  writeFileSync(join(outDir, "build", zipName), first.buffer);
  writeFileSync(
    join(outDir, "manifest", "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  writeFileSync(
    join(outDir, "manifest", "checksums.txt"),
    `${manifest.zip.sha256}  build/${zipName}\n`,
  );

  return {
    checks,
    measures: { "package.zip_bytes": first.buffer.length, "package.entries": first.entries.length },
    manifest,
  };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const distDir = resolve(arg("dist", resolve(EXAMPLE_ROOT, "dist")));
  const outDir = resolve(arg("out", resolve(REPO_ROOT, "release/gamevui")));
  if (!existsSync(join(distDir, "index.html"))) {
    console.error(`${distDir}/index.html not found — run \`pnpm build\` first`);
    process.exit(1);
  }
  const metadata = JSON.parse(
    readFileSync(resolve(EXAMPLE_ROOT, "gamevui.submission.json"), "utf8"),
  );
  const result = buildPackage({ distDir, outDir, metadata });

  const factsPath = resolve(OUT_DIR, "package-facts.json");
  mkdirSync(dirname(factsPath), { recursive: true });
  writeFileSync(
    factsPath,
    JSON.stringify({ checks: result.checks, measures: result.measures }, null, 2) + "\n",
  );

  for (const [name, check] of Object.entries(result.checks)) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${name}  ${check.detail}`);
  }
  console.log(
    `${result.manifest.zip.file}  ${result.manifest.zip.bytes} bytes  sha256:${result.manifest.zip.sha256}`,
  );
  console.log(`wrote ${relative(REPO_ROOT, outDir)}/ — nothing was sent anywhere`);
  if (Object.values(result.checks).some((check) => !check.ok)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
