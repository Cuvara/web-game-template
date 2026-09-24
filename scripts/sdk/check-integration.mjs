#!/usr/bin/env node
// Check that the template's boot wiring is intact (contract 2, `pnpm sdk:check`).
//
// The Factory no longer patches src/main.ts: the template boots through bootPlatform,
// installs PlatformGameplay with the generated INTEGRATION_PLAN, and hands the game its
// context through createGame. That only holds while those lines are there, so this fails —
// exit 1, with a JSON report the Factory's `sdk` step reads — the moment any of them is
// gone, instead of letting a build ship with the platform seam silently unwired.
//
// It reads source text; it does not build or run anything. Comments are stripped first, so
// a commented-out call does not count as wiring.
//
// Usage:
//   node scripts/sdk/check-integration.mjs [--root <repo>]
//
// Output (stdout): { ok, root, checks: [{ id, ok, file, detail }], problems: [string] }

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isEntryPoint, parseArgs, repoRoot } from "../_shared.mjs";

export const MAIN_FILE = "src/main.ts";
export const PLAN_FILE = "src/platform/integration-plan.ts";
export const GAMEPLAY_FILE = "src/platform/gameplay.ts";
export const SEAM_FILE = "src/platform/game-integration.ts";
export const GAME_ENTRY = "src/game/index.ts";

/** Source without comments. Naive about comment markers inside strings, which is fine here. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// What main.ts must do, in boot order. Each is a call site, not a mention.
const MAIN_CALLS = [
  ["boot-platform", /\bbootPlatform\s*\(/, "boots the platform through bootPlatform()"],
  ["gameplay-installed", /\binstallGameplay\s*\(/, "installs gameplay with installGameplay()"],
  ["gameplay-constructed", /\bnew\s+PlatformGameplay\s*\(/, "constructs PlatformGameplay"],
  ["create-game", /\bcreateGame\s*\(/, "creates the game through createGame(context)"],
  ["signal-ready", /\.signalReady\s*\(/, "signals ready"],
];

// Construction and installation may be written either way round; the rest may not.
const BOOT_ORDER = ["boot-platform", "gameplay-installed", "create-game", "signal-ready"];

const MAIN_IMPORTS = [
  ["imports-gameplay", /from\s+["']\.\/platform\/gameplay\.js["']/, "./platform/gameplay.js"],
  [
    "imports-plan",
    /from\s+["']\.\/platform\/integration-plan\.js["']/,
    "./platform/integration-plan.js",
  ],
  ["imports-game", /from\s+["']\.\/game\/index\.js["']/, "./game/index.js"],
];

const EXPORTS_CREATE_GAME =
  /export\s+(?:async\s+)?function\s+createGame\b|export\s+const\s+createGame\b|export\s*\{[^}]*\bcreateGame\b[^}]*\}/;

export function checkIntegration(root) {
  const checks = [];
  const add = (id, ok, file, detail) => checks.push({ id, ok, file, detail });
  const read = (file) => {
    const path = resolve(root, file);
    return existsSync(path) ? stripComments(readFileSync(path, "utf8")) : null;
  };

  const main = read(MAIN_FILE);
  if (main === null) {
    add("main-present", false, MAIN_FILE, "src/main.ts is missing");
  } else {
    for (const [id, pattern, what] of MAIN_IMPORTS) {
      add(id, pattern.test(main), MAIN_FILE, `imports ${what}`);
    }
    const found = new Map();
    for (const [id, pattern, what] of MAIN_CALLS) {
      const match = pattern.exec(main);
      add(id, match !== null, MAIN_FILE, what);
      if (match) found.set(id, match.index);
    }
    // The boot order is the contract portals check: platform first, the game before ready.
    const positions = BOOT_ORDER.filter((id) => found.has(id)).map((id) => [id, found.get(id)]);
    const sorted = [...positions].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    add(
      "boot-order",
      positions.length === BOOT_ORDER.length && sorted.join() === BOOT_ORDER.join(),
      MAIN_FILE,
      `calls in order: ${BOOT_ORDER.join(" -> ")}` +
        (positions.length === BOOT_ORDER.length ? ` (found: ${sorted.join(" -> ")})` : ""),
    );
    // The app never constructs a platform from the registry: that bypasses bootPlatform's
    // degradation and bundles every portal's adapter.
    add(
      "no-registry-boot",
      !/\bcreatePlatform\s*\(/.test(main),
      MAIN_FILE,
      "does not call createPlatform() directly",
    );
  }

  const plan = read(PLAN_FILE);
  add(
    "integration-plan",
    plan !== null && /export\s+const\s+INTEGRATION_PLAN\b/.test(plan),
    PLAN_FILE,
    plan === null ? `${PLAN_FILE} is missing` : "exports const INTEGRATION_PLAN",
  );

  const gameplay = read(GAMEPLAY_FILE);
  add(
    "gameplay-module",
    gameplay !== null &&
      ["bootPlatform", "installGameplay", "PlatformGameplay"].every((name) =>
        new RegExp(`export\\s+(?:async\\s+)?(?:function|class)\\s+${name}\\b`).test(gameplay),
      ),
    GAMEPLAY_FILE,
    gameplay === null
      ? `${GAMEPLAY_FILE} is missing`
      : "exports bootPlatform, installGameplay and PlatformGameplay",
  );

  const seam = read(SEAM_FILE);
  add(
    "game-integration",
    seam !== null && /export\s+class\s+PlatformGameIntegration\b/.test(seam),
    SEAM_FILE,
    seam === null ? `${SEAM_FILE} is missing` : "exports class PlatformGameIntegration",
  );

  const entry = read(GAME_ENTRY);
  add(
    "game-entry",
    entry !== null && EXPORTS_CREATE_GAME.test(entry),
    GAME_ENTRY,
    entry === null ? `${GAME_ENTRY} is missing` : "exports createGame",
  );

  const problems = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.file}: ${check.detail} — not satisfied (${check.id})`);
  return { ok: problems.length === 0, root, checks, problems };
}

if (isEntryPoint(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.root === "string" ? resolve(args.root) : repoRoot();
  const report = checkIntegration(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
