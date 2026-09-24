#!/usr/bin/env node
// Evaluate a platform profile's assertions against measured package facts.
//
// This is the runtime half of release validation. The profile is read from
// config/platforms/, which holds the version game.config.yaml pins — never the latest one.
// Validating against a newer profile than the build was made for is named as a failure mode
// by the Factory's platform-validation stage, and it is an easy mistake to make invisibly.
//
// Output is a list of criterionResult objects — {criterion_id, measured, breached} — which
// is exactly the shape platform-publication.assertion_results expects. Passes are recorded
// as well as failures: "which rules did we check" is as much of the record as "which
// failed".
//
// Before any assertion runs, the profile itself is checked against the pin: its version must
// equal the one game.config.yaml's platforms entry names, and when config/platforms/pinned.json
// records a content hash for it, the file must hash to that. A mismatch is reported as a
// blocking breach (`profile_pin`), not as a crash — it is a finding about the release, and
// the record should say which rule set was actually applied.
//
// Exit code is 1 if any BLOCKING assertion breached. Warnings are reported and do not fail.
// Exit code 2 is a usage/config error (no profile, no facts): nothing was evaluated.
//
// Usage:
//   node scripts/verify/evaluate-assertions.mjs --platform generic-web \
//     [--facts <path>] [--out <path>]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

/** Read a dotted path such as `package.perf.time_to_interactive_s` out of the facts. */
function readPath(facts, path) {
  let current = facts;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !(segment in current)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function requireNumbers(op, left, right) {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new Error(
      `operator "${op}" needs numbers on both sides, got ${JSON.stringify(left)} and ${JSON.stringify(right)}`,
    );
  }
}

/** Deep equality good enough for the literal types criteria-expression allows. */
function equal(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  }
  return a === b;
}

/**
 * Containment, per the operator's definition in criteria-expression.schema.json: an array
 * measurement asks whether every element of `right` is present in it; a scalar measurement
 * asks whether it appears in `right`.
 */
function contains(measured, right) {
  const wanted = Array.isArray(right) ? right : [right];
  if (Array.isArray(measured)) {
    return wanted.every((item) => measured.some((candidate) => equal(candidate, item)));
  }
  return wanted.some((item) => equal(measured, item));
}

function evaluateComparison(expression, facts) {
  const { left, op, right_path: rightPath } = expression;
  const { found, value } = readPath(facts, left);

  if (op === "exists") return { measured: value ?? null, holds: found && value !== null };
  if (op === "absent") return { measured: value ?? null, holds: !found || value === null };

  if (!found) {
    throw new Error(`fact "${left}" was not measured, so "${op}" cannot be evaluated`);
  }

  // `right` is a literal; `right_path` is another measured value. The schema makes them
  // mutually exclusive, because nothing mechanical can tell `right: casual` (a literal) from
  // `right: platform.capabilities.ads` (a path) — so the rarer one is declared.
  let right = expression.right;
  if (rightPath !== undefined) {
    if (right !== undefined) {
      throw new Error(`comparison on "${left}" gives both right and right_path`);
    }
    const resolved = readPath(facts, rightPath);
    if (!resolved.found) {
      throw new Error(`fact "${rightPath}" was not measured, so "${op}" cannot be evaluated`);
    }
    right = resolved.value;
  }

  switch (op) {
    case "gt":
      requireNumbers(op, value, right);
      return { measured: value, holds: value > right };
    case "gte":
      requireNumbers(op, value, right);
      return { measured: value, holds: value >= right };
    case "lt":
      requireNumbers(op, value, right);
      return { measured: value, holds: value < right };
    case "lte":
      requireNumbers(op, value, right);
      return { measured: value, holds: value <= right };
    case "eq":
      return { measured: value, holds: equal(value, right) };
    case "neq":
      return { measured: value, holds: !equal(value, right) };
    case "in":
      return { measured: value, holds: contains(value, right) };
    case "not_in":
      return { measured: value, holds: !contains(value, right) };
    default:
      throw new Error(`unknown operator "${op}"`);
  }
}

/** Evaluate any expression node: a comparison, or one of the all_of/any_of/not composites. */
export function evaluate(expression, facts) {
  if (expression === null || typeof expression !== "object") {
    throw new Error(`expression must be an object, got ${JSON.stringify(expression)}`);
  }
  if (Array.isArray(expression.all_of)) {
    const parts = expression.all_of.map((part) => evaluate(part, facts));
    return { measured: parts.map((part) => part.measured), holds: parts.every((p) => p.holds) };
  }
  if (Array.isArray(expression.any_of)) {
    const parts = expression.any_of.map((part) => evaluate(part, facts));
    return { measured: parts.map((part) => part.measured), holds: parts.some((p) => p.holds) };
  }
  if (expression.not !== undefined) {
    const inner = evaluate(expression.not, facts);
    return { measured: inner.measured, holds: !inner.holds };
  }
  return evaluateComparison(expression, facts);
}

/**
 * Run every assertion in a profile. Returns criterionResult objects plus the severity, so
 * the caller can decide what is fatal without re-reading the profile.
 */
export function evaluateProfile(profile, facts, now = new Date().toISOString()) {
  return (profile.assertions ?? []).map((assertion) => {
    const severity = assertion.severity ?? "blocking";
    try {
      const { measured, holds } = evaluate(assertion.check, facts);
      return {
        criterion_id: assertion.id,
        measured: measured ?? null,
        breached: !holds,
        evaluated_at: now,
        severity,
        ...(assertion.rationale ? { note: assertion.rationale } : {}),
      };
    } catch (error) {
      // An assertion that cannot be evaluated is a breach. Treating it as a pass would let
      // a fact we forgot to measure silently satisfy a blocking rule.
      return {
        criterion_id: assertion.id,
        measured: null,
        breached: true,
        evaluated_at: now,
        severity,
        note: `not evaluable: ${error.message}`,
      };
    }
  });
}

const sha256 = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

/**
 * Check that `profile` is the profile the game pinned. Returns criterionResult objects —
 * empty when there is nothing to object to — so a mismatch lands in the same record as
 * every other assertion.
 *
 *   profileBytes — the raw file, for the content hash.
 *   pinned       — parsed config/platforms/pinned.json, or null when absent. Profiles not
 *                  vendored from the Factory (y8, gamedistribution) have no entry and so no
 *                  hash to check; their version pin is still checked.
 */
export function checkProfilePin({
  platformId,
  profile,
  profileBytes,
  gameConfig,
  pinned,
  now = new Date().toISOString(),
}) {
  const breach = (criterionId, measured, note) => ({
    criterion_id: criterionId,
    measured,
    breached: true,
    evaluated_at: now,
    severity: "blocking",
    note,
  });
  const results = [];

  const entry = (gameConfig?.platforms ?? []).find((candidate) => candidate.id === platformId);
  const [pinnedId, pinnedVersion] = String(entry?.profile ?? "").split("@");
  if (!entry) {
    results.push(
      breach("profile_pin", null, `game.config.yaml platforms[] has no entry for "${platformId}"`),
    );
  } else if (!pinnedVersion) {
    results.push(breach("profile_pin", null, `platform "${platformId}" has an unpinned profile`));
  } else if (pinnedId !== platformId || profile?.id !== platformId) {
    results.push(
      breach(
        "profile_pin",
        `${profile?.id}@${profile?.version}`,
        `pin ${entry.profile} does not name profile "${platformId}"`,
      ),
    );
  } else if (String(profile?.version) !== pinnedVersion) {
    results.push(
      breach(
        "profile_pin",
        String(profile?.version),
        `config/platforms/${platformId}.yaml is version ${profile?.version}, ` +
          `game.config.yaml pins ${entry.profile}`,
      ),
    );
  }

  const record = (pinned?.profiles ?? []).find((candidate) => candidate.id === platformId);
  if (record?.content_hash) {
    const actual = sha256(profileBytes);
    // core.autocrlf=true checks the vendored copy out with CRLF endings; the Factory hashed
    // the LF bytes. A difference in line endings alone is a checkout artifact, not a drift.
    const normalised = sha256(Buffer.from(profileBytes.toString("utf8").replace(/\r\n/g, "\n")));
    if (actual !== record.content_hash && normalised !== record.content_hash) {
      results.push(
        breach(
          "profile_content_hash",
          actual,
          `config/platforms/${platformId}.yaml does not hash to ${record.content_hash} ` +
            "recorded in pinned.json — the vendored profile was edited or replaced",
        ),
      );
    }
    if (record.version !== undefined && String(record.version) !== String(profile?.version)) {
      results.push(
        breach(
          "profile_pin",
          String(profile?.version),
          `pinned.json records ${platformId}@${record.version}, the file is ${profile?.version}`,
        ),
      );
    }
  }

  return results;
}

function usageError(message) {
  console.error(`evaluate-assertions: ${message}`);
  process.exit(2);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = args.platform;
  if (!platform || platform === true) {
    console.error("usage: evaluate-assertions.mjs --platform <id> [--facts <path>] [--out <path>]");
    process.exit(2);
  }

  const root = repoRoot();
  const profileRel = `config/platforms/${platform}.yaml`;
  const profilePath = resolve(root, profileRel);
  const factsRel = args.facts ?? `build/facts/${platform}.json`;
  const factsPath = resolve(root, factsRel);

  if (!existsSync(profilePath)) {
    usageError(`no platform profile at ${profileRel} — "${platform}" has no vendored profile`);
  }
  if (!existsSync(factsPath)) {
    usageError(
      `no facts at ${factsRel} — run \`node scripts/verify/collect-facts.mjs --platform ${platform}\` first`,
    );
  }

  const profileBytes = readFileSync(profilePath);
  let profile;
  let facts;
  try {
    profile = parse(profileBytes.toString("utf8"));
  } catch (error) {
    usageError(`${profileRel} is not valid YAML: ${error.message}`);
  }
  try {
    facts = JSON.parse(readFileSync(factsPath, "utf8"));
  } catch (error) {
    usageError(`${factsRel} is not valid JSON: ${error.message}`);
  }
  const pinnedPath = resolve(root, "config/platforms/pinned.json");
  const pinned = existsSync(pinnedPath) ? JSON.parse(readFileSync(pinnedPath, "utf8")) : null;

  const results = [
    ...checkProfilePin({
      platformId: platform,
      profile,
      profileBytes,
      gameConfig: readGameConfig(root),
      pinned,
    }),
    ...evaluateProfile(profile, facts),
  ];
  const blocking = results.filter((r) => r.breached && r.severity === "blocking");
  const warnings = results.filter((r) => r.breached && r.severity !== "blocking");

  for (const result of results) {
    const mark = result.breached ? (result.severity === "blocking" ? "FAIL" : "WARN") : "ok  ";
    const note = result.note ? ` — ${result.note}` : "";
    console.log(
      `${mark}  ${result.criterion_id}  measured=${JSON.stringify(result.measured)}${note}`,
    );
  }

  console.log(
    `\n${platform} @ ${profile.version}: ${results.length - blocking.length - warnings.length} passed, ` +
      `${warnings.length} warning, ${blocking.length} blocking`,
  );

  if (args.out) {
    const out = resolve(root, args.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
    console.log(`wrote ${args.out}`);
  }

  process.exit(blocking.length > 0 ? 1 : 0);
}

if (isEntryPoint(import.meta.url)) main();
