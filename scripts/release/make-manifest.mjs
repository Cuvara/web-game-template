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
// Immutability is enforced, not just described: an existing manifest.json is never replaced
// with different content (exit 1). Re-running with the same inputs is a no-op success — the
// comparison ignores only the fields that record WHEN a run happened (produced_at, built_at,
// frozen_at, the date in artifact_id, the CI run link) and the content_hash derived from them.
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
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** The template this repository was generated from; see release-manifest.schema.json. */
export const TEMPLATE_REPOSITORY = "Cuvara/web-game-template";

export class ManifestRefusal extends Error {}

function refuse(message) {
  throw new ManifestRefusal(message);
}

/**
 * The commit being released: GITHUB_SHA in CI, else HEAD. A manifest pins a commit or it pins
 * nothing, so there is no "unknown" fallback — outside a git work tree this refuses.
 */
export function commitSha(root, env = process.env) {
  let sha = env["GITHUB_SHA"];
  if (!sha) {
    try {
      sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      refuse("no commit to pin: not a git work tree and GITHUB_SHA is unset");
    }
  }
  if (!COMMIT_SHA.test(sha)) refuse(`"${sha}" is not a full commit sha`);
  return sha;
}

function changelogFrom(root, args) {
  if (typeof args.changelog === "string") return args.changelog.split("\n").filter(Boolean);
  try {
    const log = execFileSync("git", ["log", "-20", "--pretty=%s"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = log
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // changelog has minItems: 1 — an empty one would be schema-invalid, and a release with
    // nothing to say about itself is worth noticing rather than papering over.
    return lines.length > 0 ? lines : ["No changelog entries were supplied."];
  } catch {
    return ["No changelog entries were supplied."];
  }
}

/**
 * `template` for the manifest: which template, at which version, and where that version was
 * read. package.json's `wgf.template.version` survives a game bumping its own version; the
 * package version is the fallback for a repository that predates the marker. The contract
 * number stays in package.json (`wgf.template.contract`) — the Factory's schema has no field
 * for it.
 */
export function templateInfo(root) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const marked = pkg.wgf?.template?.version;
  return typeof marked === "string"
    ? { repository: TEMPLATE_REPOSITORY, version: marked, source: "package.json wgf.template" }
    : { repository: TEMPLATE_REPOSITORY, version: String(pkg.version), source: "package.json" };
}

/** A package record as the manifest schema allows it; build details stay in packages.json. */
function manifestPackage(record) {
  const { platform_id, filename, size_mb, checksum, content_digest, files } = record;
  return {
    platform_id,
    filename,
    size_mb,
    checksum,
    ...(content_digest !== undefined ? { content_digest } : {}),
    ...(files !== undefined ? { files } : {}),
  };
}

/** wgf:<artifact-type>:<scope-slug>:<yyyymmdd>-<nn> */
function artifactId(type, scope, date, sequence) {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `wgf:${type}:${scope}:${stamp}-${String(sequence).padStart(2, "0")}`;
}

/** The manifest minus the fields that only say when it was produced. */
export function comparable(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  if (copy.provenance) {
    delete copy.provenance.produced_at;
    delete copy.provenance.content_hash;
    if (typeof copy.provenance.artifact_id === "string") {
      copy.provenance.artifact_id = copy.provenance.artifact_id.replace(/:[0-9]{8}-/, ":-");
    }
  }
  if (copy.build_ref) {
    delete copy.build_ref.built_at;
    delete copy.build_ref.ci_run_url;
  }
  delete copy.frozen_at;
  return copy;
}

/** Build the manifest for `release/<releaseId>/` under `root`. Pure apart from reads. */
export function buildManifest({ root, args, env = process.env, now = new Date() }) {
  const releaseId = args.release;
  const version = args.version;
  if (typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
    refuse("--release must match ^r[0-9]+$ (r1, r2, ...)");
  }
  if (typeof version !== "string" || !SEMVER.test(version)) {
    refuse("--version must be semver, e.g. 1.0.0");
  }

  const gameConfig = readGameConfig(root);
  if (version !== String(gameConfig.game.version)) {
    refuse(
      `--version ${version} is not game.version ${gameConfig.game.version} in game.config.yaml; ` +
        `the manifest describes the build, and the build was made at game.version`,
    );
  }

  const packagesPath = resolve(root, "release", releaseId, "packages.json");
  if (!existsSync(packagesPath)) {
    refuse(`release/${releaseId}/packages.json is missing — run \`pnpm release:package\` first`);
  }
  const packages = JSON.parse(readFileSync(packagesPath, "utf8"));

  const commit = commitSha(root, env);
  for (const record of packages) {
    const built = record.build?.commit_sha;
    if (built && built !== commit) {
      refuse(`${record.filename} was built from ${built}, but the release commit is ${commit}`);
    }
  }

  const state = args.state ?? "draft";
  const frozen = args.freeze === true || state === "rc";
  const server = env["GITHUB_SERVER_URL"];
  const repository = env["GITHUB_REPOSITORY"];

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
    commit_sha: commit,
    build_ref: {
      built_at: now.toISOString(),
      ...(server && repository
        ? {
            url: `${server}/${repository}/tree/${commit}`,
            ci_run_url: `${server}/${repository}/actions/runs/${env["GITHUB_RUN_ID"]}`,
          }
        : {}),
    },
    packages: packages.map(manifestPackage),
    target_platforms: gameConfig.platforms.map((entry) => ({
      id: entry.id,
      role: entry.role,
      profile_version: String(entry.profile).split("@")[1],
    })),
    changelog: changelogFrom(root, args),
    template: templateInfo(root),
    ...(frozen ? { frozen_at: now.toISOString() } : {}),
  };

  manifest.provenance.content_hash = contentHash(manifest);
  return manifest;
}

/**
 * Write the manifest unless one is already there. Returns "written" or "unchanged"; refuses
 * when the existing manifest differs in anything but its timestamps.
 */
export function makeManifest({ root, args, env = process.env, now = new Date() }) {
  const manifest = buildManifest({ root, args, env, now });
  const path = resolve(root, "release", manifest.release_id, "manifest.json");
  if (existsSync(path)) {
    let existing;
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      refuse(`release/${manifest.release_id}/manifest.json exists and is not readable JSON`);
    }
    if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(manifest))) {
      return { manifest: existing, status: "unchanged" };
    }
    refuse(
      `release/${manifest.release_id}/manifest.json already exists with different content. ` +
        `A release manifest is immutable — cut a new release id instead of editing this one`,
    );
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, status: "written" };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = makeManifest({ root: repoRoot(), args });
  } catch (error) {
    if (!(error instanceof ManifestRefusal)) throw error;
    console.error(`release:manifest refused: ${error.message}`);
    process.exit(1);
  }
  const { manifest, status } = result;
  const verb = status === "written" ? "wrote" : "unchanged:";
  console.log(`${verb} release/${manifest.release_id}/manifest.json`);
  console.log(`  state ${manifest.state}${manifest.frozen_at ? " (frozen)" : ""}`);
  console.log(`  ${manifest.provenance.content_hash}`);
}

if (isEntryPoint(import.meta.url)) main();
