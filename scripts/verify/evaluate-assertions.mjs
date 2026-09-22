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
// Exit code is 1 if any BLOCKING assertion breached. Warnings are reported and do not fail.
//
// Usage:
//   node scripts/verify/evaluate-assertions.mjs --platform generic-web \
//     [--facts <path>] [--out <path>]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { isEntryPoint, parseArgs, repoRoot } from "../_shared.mjs";

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = args.platform;
  if (!platform) {
    console.error("usage: evaluate-assertions.mjs --platform <id> [--facts <path>] [--out <path>]");
    process.exit(2);
  }

  const root = repoRoot();
  const profilePath = resolve(root, "config/platforms", `${platform}.yaml`);
  const factsPath = resolve(root, args.facts ?? `build/facts/${platform}.json`);

  const profile = parse(readFileSync(profilePath, "utf8"));
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));

  const results = evaluateProfile(profile, facts);
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
