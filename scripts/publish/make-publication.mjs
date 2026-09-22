#!/usr/bin/env node
// Write release/<release-id>/publications/<platform-id>.json per targeted platform.
//
// This is the record of a submission, and deliberately not an integration with one. The
// Factory's publish stage is explicit that no portal APIs are wired up: submission is a
// human checklist plus this file. So the script's job is to carry the assertion results
// forward, set the state they imply, and lay out the checklist a person works through.
//
// State is derived, never asserted:
//   any blocking assertion breached -> validation-failed
//   otherwise                       -> validated
//
// Usage:
//   node scripts/publish/make-publication.mjs --release r1 [--platform <id>]
//     [--state submitted] [--portal-reference <id>] [--submitted-by <name>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { contentHash, isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

const RELEASE_ID = /^r[0-9]+$/;

/**
 * The checklist a human works through. Built from the profile so it says what THIS portal
 * requires — a generic checklist is one nobody reads.
 */
function checklistFor(profile) {
  const items = [
    {
      item: `Open the ${profile.name} developer console and create or open the draft`,
      done: false,
    },
    { item: `Upload ${profile.id}.zip from this release directory`, done: false },
  ];

  const locales = profile.requirements?.locales_required ?? [];
  if (locales.length > 0) {
    items.push({
      item: `Confirm required locale(s) present: ${locales.join(", ")}`,
      done: false,
      note: "Listed as a rejection cause on this portal.",
    });
  }

  const meta = profile.metadata_requirements ?? {};
  if (meta.screenshots_min) {
    items.push({ item: `Attach at least ${meta.screenshots_min} screenshots`, done: false });
  }
  if (meta.icon_required) items.push({ item: "Attach the icon", done: false });
  if (meta.age_rating_required) items.push({ item: "Set the age rating", done: false });
  for (const locale of meta.descriptions_locales ?? []) {
    items.push({ item: `Write the store description in ${locale}`, done: false });
  }

  for (const rejection of profile.review?.common_rejections ?? []) {
    items.push({ item: `Re-read before submitting — past rejection: ${rejection}`, done: false });
  }

  items.push({ item: "Submit for moderation and record the portal reference below", done: false });
  return items;
}

function expectedBy(profile, from) {
  const days = profile.review?.typical_days?.[1];
  if (!days) return undefined;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = args.release;
  if (!releaseId || !RELEASE_ID.test(releaseId)) {
    console.error("usage: make-publication.mjs --release r<n> [--platform <id>]");
    process.exit(2);
  }

  const root = repoRoot();
  const gameConfig = readGameConfig(root);
  const releaseDir = resolve(root, "release", releaseId);
  const manifestPath = resolve(releaseDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    console.error(
      `release/${releaseId}/manifest.json is missing — run \`pnpm release:manifest\` first`,
    );
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const targets = args.platform
    ? gameConfig.platforms.filter((entry) => entry.id === args.platform)
    : gameConfig.platforms;

  const outDir = resolve(releaseDir, "publications");
  mkdirSync(outDir, { recursive: true });

  const now = new Date();
  let anyFailed = false;

  for (const target of targets) {
    const profile = parse(
      readFileSync(resolve(root, "config/platforms", `${target.id}.yaml`), "utf8"),
    );
    const resultsPath = resolve(root, "build/assertions", `${target.id}.json`);
    const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : [];

    const blocking = results.filter((r) => r.breached && (r.severity ?? "blocking") === "blocking");
    const derivedState = blocking.length > 0 ? "validation-failed" : "validated";
    const state = args.state ?? derivedState;

    if (blocking.length > 0) anyFailed = true;
    if (args.state && blocking.length > 0) {
      console.error(
        `refusing to set ${target.id} to "${args.state}": ${blocking.length} blocking assertion(s) breached`,
      );
      process.exit(1);
    }

    const publication = {
      provenance: {
        artifact_id: `wgf:platform-publication:${target.id}:${now.toISOString().slice(0, 10).replace(/-/g, "")}-01`,
        artifact_type: "platform-publication",
        schema_version: "1.0.0",
        title_id: gameConfig.game.id,
        produced_by: { role: "release", actor: "automation" },
        produced_at: now.toISOString(),
        inputs: [
          {
            artifact_id: manifest.provenance.artifact_id,
            artifact_type: "release-manifest",
            content_hash: manifest.provenance.content_hash,
          },
        ],
        content_hash: "",
        status: "draft",
      },
      release_id: releaseId,
      title_id: gameConfig.game.id,
      platform_id: target.id,
      profile_version: String(target.profile).split("@")[1],
      role: target.role,
      state,
      // Strip the severity helper: it is how this script decides, not part of the schema.
      assertion_results: results.map(({ severity: _severity, ...rest }) => rest),
      submission: {
        package_filename: `${target.id}.zip`,
        checklist: checklistFor(profile),
        ...(args["submitted-by"] ? { submitted_by: String(args["submitted-by"]) } : {}),
        ...(args["portal-reference"] ? { portal_reference: String(args["portal-reference"]) } : {}),
        ...(state === "submitted" ? { submitted_at: now.toISOString() } : {}),
      },
      ...(state === "submitted" && expectedBy(profile, now)
        ? { review: { expected_by: expectedBy(profile, now) } }
        : {}),
    };

    publication.provenance.content_hash = contentHash(publication);

    writeFileSync(
      resolve(outDir, `${target.id}.json`),
      JSON.stringify(publication, null, 2) + "\n",
    );
    console.log(
      `${target.id}: ${state}  (${results.length} assertion result(s), ${blocking.length} blocking)`,
    );
  }

  console.log(`\nwrote release/${releaseId}/publications/`);
  if (anyFailed) {
    console.error(
      "\nat least one platform is validation-failed — this release cannot be submitted",
    );
    process.exit(1);
  }
}

if (isEntryPoint(import.meta.url)) main();
