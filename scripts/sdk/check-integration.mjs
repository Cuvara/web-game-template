#!/usr/bin/env node
// `pnpm sdk:check` - static checks of the platform integration in this repository.
//
// On the 1.2 line (template contract 1) the integration layer under src/platform/ is written
// by the Factory's `sdk` step, not by the template, so the one check here is the one a game
// can fail without anyone noticing: ad coverage per target platform (./ad-coverage.mjs) -
// every target whose vendored profile offers an ad kind the title commits to has a placement
// of that kind in src/platform/integration-plan.ts. A Y8 build shipped with no ads because
// the plan predated the retarget to Y8 (2026-10-21); this fails that build in CI.
//
// It reads source and YAML; it does not build or run the game.
//
// Usage:
//   node scripts/sdk/check-integration.mjs [--root <repo>]
//
// Output (stdout): { ok, root, status, checks: [{ id, ok, detail }], problems: [string] }
// Exit 1 when any problem is found. A repository with no integration plan yet is "skipped"
// and exits 0 (the template itself ships none).

import { resolve } from "node:path";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";
import { checkAdCoverage } from "./ad-coverage.mjs";

export function checkIntegration(root, gameConfig = readGameConfig(root)) {
  const ads = checkAdCoverage(root, gameConfig);
  return {
    ok: ads.problems.length === 0,
    root,
    status: ads.status,
    checks: ads.checks,
    problems: ads.problems,
  };
}

if (isEntryPoint(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.root === "string" ? resolve(args.root) : repoRoot();
  const report = checkIntegration(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  for (const problem of report.problems) process.stderr.write(`sdk:check: ${problem}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
