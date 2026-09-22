// Small helpers shared by the scripts under scripts/.
//
// Kept dependency-free on purpose: these run in CI before anything is guaranteed to be
// installed beyond the workspace's own devDependencies.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

/** The template/game repository root. */
export function repoRoot() {
  return resolve(import.meta.dirname, "..");
}

/**
 * Parse `--key value` and `--flag` into an object. Deliberately tiny — these scripts have a
 * handful of options each and a CLI framework would be more code than the scripts.
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/** True when the module at `metaUrl` is the entry point, not an import. Windows-safe. */
export function isEntryPoint(metaUrl) {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(entry).href;
}

export function readGameConfig(root = repoRoot()) {
  return parse(readFileSync(resolve(root, "game.config.yaml"), "utf8"));
}

/**
 * Serialise with object keys sorted, so a digest does not depend on property order.
 * Arrays keep their order — in an artifact, list order is meaning, not formatting.
 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The provenance content hash of an artifact.
 *
 * Computed over the artifact with its own hash slot blanked, because a value cannot contain
 * a digest of itself. Every gate pins its subject by this hash, so two runs over identical
 * content must produce the same string — hence the stable key order.
 */
export function contentHash(artifact) {
  const copy = JSON.parse(JSON.stringify(artifact));
  copy.provenance.content_hash = "";
  return "sha256:" + createHash("sha256").update(stableStringify(copy)).digest("hex");
}

/** The pinned profile version for a platform, read from game.config.yaml's pin. */
export function pinnedProfileVersion(gameConfig, platformId) {
  const entry = gameConfig.platforms.find((candidate) => candidate.id === platformId);
  if (!entry) throw new Error(`game.config.yaml does not target platform "${platformId}"`);
  const version = String(entry.profile).split("@")[1];
  if (!version) throw new Error(`platform "${platformId}" has an unpinned profile`);
  return version;
}
