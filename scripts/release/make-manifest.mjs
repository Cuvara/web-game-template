#!/usr/bin/env node
// Write release/<release-id>/manifest.json, conforming to release-manifest.schema.json.
//
// The manifest is immutable from the release-candidate stage onward: a fixed commit, fixed
// packages and their checksums, and a frozen_at timestamp. Any change produces a new
// release rather than an edit to this one — which is what makes a rollback a republish of a
// known-good manifest rather than a rebuild.
//
// `target_platforms[].profile_version` is read from the pin in game.config.yaml, not from
// whatever version of the profile happens to be current. That pin is what release
// validation later judges the build against.
//
// Usage:
//   node scripts/release/make-manifest.mjs --release r1 --version 1.0.0 \
//     [--kind initial|content|hotfix|rollback] [--state draft|rc] [--freeze]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { contentHash, isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

const RELEASE_ID = /^r[0-9]+$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function commitSha(root) {
  if (process.env["GITHUB_SHA"]) return process.env["GITHUB_SHA"];
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function changelogFrom(root, args) {
  if (args.changelog) return String(args.changelog).split("\n").filter(Boolean);
  try {
    const log = execFileSync("git", ["log", "-20", "--pretty=%s"], { cwd: root, encoding: "utf8" });
    const lines = log.split("\n").map((line) => line.trim()).filter(Boolean);
    // changelog has minItems: 1 — an empty one would be schema-invalid, and a release with
    // nothing to say about itself is worth noticing rather than papering over.
    return lines.length > 0 ? lines : ["No changelog entries were supplied."];
  } catch {
    return ["No changelog entries were supplied."];
  }
}

/** wgf:<artifact-type>:<scope-slug>:<yyyymmdd>-<nn> */
function artifactId(type, scope, date, sequence) {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `wgf:${type}:${scope}:${stamp}-${String(sequence).padStart(2, "0")}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = args.release;
  const version = args.version;

  if (!releaseId || !RELEASE_ID.test(releaseId)) {
    console.error("--release must match ^r[0-9]+$ (r1, r2, ...)");
    process.exit(2);
  }
  if (!version || !SEMVER.test(version)) {
    console.error("--version must be semver, e.g. 1.0.0");
    process.exit(2);
  }

  const root = repoRoot();
  const gameConfig = readGameConfig(root);
  const outDir = resolve(root, "release", releaseId);
  const packagesPath = resolve(outDir, "packages.json");

  if (!existsSync(packagesPath)) {
    console.error(`release/${releaseId}/packages.json is missing — run \`pnpm release:package\` first`);
    process.exit(1);
  }
  const packages = JSON.parse(readFileSync(packagesPath, "utf8"));

  const now = new Date();
  const state = args.state ?? "draft";
  const frozen = args.freeze === true || state === "rc";

  const manifest = {
    provenance: {
      artifact_id: artifactId("release-manifest", gameConfig.game.id, now, 1),
      artifact_type: "release-manifest",
      schema_version: "1.0.0",
      title_id: gameConfig.game.id,
      produced_by: { role: "release", actor: "automation" },
      produced_at: now.toISOString(),
      // The governed inputs — tech-plan and game-design — live in the Factory, not in the
      // game repository, so CI cannot pin them here. What CI CAN pin is recorded below in
      // target_platforms[].profile_version and commit_sha. The Factory fills inputs[] when
      // it records this release against the title.
      inputs: [],
      content_hash: "",
      status: frozen ? "final" : "draft",
    },
    release_id: releaseId,
    title_id: gameConfig.game.id,
    version,
    kind: args.kind ?? "content",
    state,
    commit_sha: commitSha(root),
    build_ref: {
      built_at: now.toISOString(),
      ...(process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_REPOSITORY"]
        ? {
            url: `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}/tree/${commitSha(root)}`,
            ci_run_url: `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}/actions/runs/${process.env["GITHUB_RUN_ID"]}`,
          }
        : {}),
    },
    packages,
    target_platforms: gameConfig.platforms.map((entry) => ({
      id: entry.id,
      role: entry.role,
      profile_version: String(entry.profile).split("@")[1],
    })),
    changelog: changelogFrom(root, args),
    ...(frozen ? { frozen_at: now.toISOString() } : {}),
  };

  manifest.provenance.content_hash = contentHash(manifest);

  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote release/${releaseId}/manifest.json`);
  console.log(`  state ${manifest.state}${frozen ? " (frozen)" : ""}`);
  console.log(`  ${manifest.provenance.content_hash}`);
}

if (isEntryPoint(import.meta.url)) main();
