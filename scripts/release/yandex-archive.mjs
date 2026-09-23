#!/usr/bin/env node
// Package a build directory as the ZIP the Yandex Games Console accepts.
//
// Requirement 1.22: index.html at the archive root — not inside a folder named after the
// build — and no spaces or Cyrillic in any file name. 1.21: at most 100 MB uncompressed.
// Zipping the directory itself instead of its contents is the classic way to get the first
// one wrong, so the archive is re-read after writing and checked.
//
// This only produces the file. Uploading it is manual: the Console has no public upload
// API (see docs/publishing.md).
//
// Usage:
//   node scripts/release/yandex-archive.mjs --dir <build dir> --out <file.zip>

import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import AdmZip from "adm-zip";
import { isEntryPoint, parseArgs } from "../_shared.mjs";

const MAX_UNCOMPRESSED_MB = 100;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function packageArchive({ dir, out }) {
  const files = walk(dir);
  const zip = new AdmZip();
  for (const file of files) {
    const name = relative(dir, file).split("\\").join("/");
    if (/\s/.test(name) || /[^\x20-\x7e]/.test(name)) {
      throw new Error(`"${name}": no spaces or non-ASCII characters allowed (requirement 1.22)`);
    }
    if (name.endsWith(".map")) continue; // not needed on the portal, and it publishes source
    const folder = dirname(name);
    zip.addLocalFile(file, folder === "." ? "" : folder);
  }
  mkdirSync(dirname(out), { recursive: true });
  zip.writeZip(out);

  // Verify what was written, not what was intended.
  const written = new AdmZip(out).getEntries().filter((entry) => !entry.isDirectory);
  const names = written.map((entry) => entry.entryName);
  if (!names.includes("index.html")) {
    throw new Error("index.html is not at the archive root (requirement 1.22)");
  }
  const uncompressed = written.reduce((sum, entry) => sum + entry.header.size, 0);
  const uncompressedMb = uncompressed / 1024 / 1024;
  if (uncompressedMb > MAX_UNCOMPRESSED_MB) {
    throw new Error(`${uncompressedMb.toFixed(1)} MB uncompressed; the limit is 100 (1.21)`);
  }
  return {
    out,
    entries: names.length,
    uncompressed_mb: Number(uncompressedMb.toFixed(3)),
    zip_mb: Number((statSync(out).size / 1024 / 1024).toFixed(3)),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !args.out) {
    console.error("usage: yandex-archive.mjs --dir <build dir> --out <file.zip>");
    process.exit(2);
  }
  const result = packageArchive({ dir: resolve(args.dir), out: resolve(args.out) });
  console.log(JSON.stringify({ ...result, out: args.out }, null, 2));
}

if (isEntryPoint(import.meta.url)) main();
