// LIVE portal validation runner — the intended entry point (`pnpm test:sdk:live`).
//
// Rules this enforces:
//   - Explicit opt-in: WGF_LIVE=1 must be set. Without it, exit BLOCKED (code 3) — never run,
//     never fall back to mocks.
//   - The suite it runs (tests/live/) only ever loads real SDKs. There is no mock in tests/live/.
//   - It aggregates the sanitized per-platform evidence into a matrix and prints it. It never
//     turns a BLOCKED/NOT_APPLICABLE cell into PASS.
//
// A missing/blocked prerequisite is reported as BLOCKED, distinct from a real FAIL.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const OPT_IN = process.env["WGF_LIVE"] === "1";

if (!OPT_IN) {
  console.error(
    [
      "BLOCKED: live portal validation did not run.",
      "",
      "Set WGF_LIVE=1 to opt in. This suite reaches real portal SDK CDNs and, for the",
      "portal-gated flows (init/ads/reward/storage), needs the portal environment or a",
      "publisher account. It never falls back to mocks and never reports a mock as live.",
      "",
      "  WGF_LIVE=1 pnpm test:sdk:live",
    ].join("\n"),
  );
  process.exit(3); // 3 = BLOCKED (distinct from a test FAIL)
}

let buildSha = "unknown";
try {
  buildSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
} catch {
  /* not fatal */
}

console.log(`Running LIVE portal validation (build ${buildSha}) — real SDKs, no mocks.\n`);
const run = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "--config", "tests/live/live.config.ts"],
  { cwd: root, stdio: "inherit", env: { ...process.env, WGF_BUILD_SHA: buildSha } },
);

// Aggregate the sanitized evidence each spec wrote.
const platforms = ["yandex", "crazygames", "poki", "gamevui", "gamemonetize"];
const matrix = {};
for (const p of platforms) {
  const f = resolve(root, `docs/audits/live/${p}/sdk-load.json`);
  matrix[p] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { sdkLoadStatus: "UNVERIFIED" };
}

const cell = (p) => matrix[p]?.sdkLoadStatus ?? "UNVERIFIED";
console.log("\nLIVE SDK-load matrix (real script reachability + surface; init/ads/reward are BLOCKED off-portal):");
console.log("  platform     SDK-load");
for (const p of platforms) console.log(`  ${p.padEnd(12)} ${cell(p)}`);

const summary = resolve(root, "docs/audits/live/summary.json");
mkdirSync(resolve(root, "docs/audits/live"), { recursive: true });
writeFileSync(
  summary,
  JSON.stringify(
    {
      buildSha,
      at: new Date().toISOString(),
      note:
        "SDK-load = real SDK script reachable + global surface present, exercised in Chromium. " +
        "init/ads/reward/storage/submission are BLOCKED off-portal (need portal env or publisher account).",
      sdkLoad: Object.fromEntries(platforms.map((p) => [p, cell(p)])),
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${summary}`);
process.exit(run.status ?? 1);
