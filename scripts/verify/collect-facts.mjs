#!/usr/bin/env node
// Measure the package facts a platform profile's assertions are written against.
//
// Facts come from two places and it matters which is which:
//
//   STATIC   — read off the built bundle and the config it was built from. Deterministic.
//   RUNTIME  — observed by driving the built bundle in a browser (scripts run this after
//              `playwright test --project verify` has written build/runtime-facts.json).
//
// Two facts are deliberately NOT taken from the runtime observation: uses_banner_ads and
// uses_rewarded_ads come from `monetization.ad_kinds` in game.config.yaml. A run can prove
// an ad was requested; it cannot prove one is never requested, and on GameVui
// `uses_rewarded_ads` is a blocking assertion. The observation is still used — as a
// cross-check that the code has not drifted from what the design declared.
//
// Usage:
//   node scripts/verify/collect-facts.mjs --platform generic-web [--runtime <path>] [--out <path>]

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

function directorySizeMb(dir) {
  const bytes = walkFiles(dir).reduce((total, file) => total + statSync(file).size, 0);
  return Number((bytes / 1024 / 1024).toFixed(3));
}

/**
 * Locales the package actually ships, read from the built output rather than from a
 * declaration. Yandex, CrazyGames and GameVui all make a locale a blocking assertion, and
 * the thing they care about is whether the file is in the bundle.
 */
function shippedLocales(root, outDir) {
  const dir = resolve(root, outDir, "locales");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

function screenshotCount(root, outDir) {
  return walkFiles(resolve(root, outDir, "metadata/screenshots")).length;
}

/**
 * generic-web asserts `package.platform_sdk == none`, which is a statement about the bundle:
 * no portal SDK was loaded. Every other platform asserts its own id.
 */
function platformSdkFact(platformId) {
  return platformId === "generic-web" ? "none" : platformId;
}

export function collectFacts({ root, platformId, gameConfig, runtime }) {
  const outDir = gameConfig.build?.output ?? "dist";
  const adKinds = gameConfig.monetization?.ad_kinds ?? [];

  const facts = {
    package: {
      size_mb: directorySizeMb(resolve(root, outDir)),
      locales: shippedLocales(root, outDir),
      platform_sdk: platformSdkFact(platformId),
      uses_banner_ads: adKinds.includes("banner"),
      uses_rewarded_ads: adKinds.includes("rewarded"),
      uses_interstitial_ads: adKinds.includes("interstitial"),
      ...(runtime?.package ?? {}),
      perf: { ...(runtime?.package?.perf ?? {}) },
    },
    metadata: {
      screenshots: screenshotCount(root, outDir),
      ...(runtime?.metadata ?? {}),
    },
  };

  // Static wins over runtime for the declared ad facts — see the header.
  facts.package.uses_banner_ads = adKinds.includes("banner");
  facts.package.uses_rewarded_ads = adKinds.includes("rewarded");
  facts.package.platform_sdk = platformSdkFact(platformId);

  return facts;
}

/**
 * The code asking for an ad kind the design never declared is a drift between
 * game.config.yaml and the game. It fails here rather than at a portal review, which is
 * the whole point of measuring both.
 */
export function crossCheckAds(adKinds, observedRequests) {
  const undeclared = Object.entries(observedRequests ?? {})
    .filter(([kind, count]) => count > 0 && !adKinds.includes(kind))
    .map(([kind]) => kind);
  return undeclared;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platformId = args.platform;
  if (!platformId) {
    console.error("usage: collect-facts.mjs --platform <id> [--runtime <path>] [--out <path>]");
    process.exit(2);
  }

  const root = repoRoot();
  const gameConfig = readGameConfig(root);
  const runtimePath = resolve(root, args.runtime ?? "build/runtime-facts.json");

  let runtime = null;
  if (existsSync(runtimePath)) {
    runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
  } else {
    console.warn(
      `no runtime facts at ${args.runtime ?? "build/runtime-facts.json"} — ` +
        `run \`pnpm test:verify\` first, or assertions on observed facts will report as not evaluable`,
    );
  }

  const facts = collectFacts({ root, platformId, gameConfig, runtime });

  const undeclared = crossCheckAds(gameConfig.monetization?.ad_kinds ?? [], runtime?.adsRequested);
  if (undeclared.length > 0) {
    console.error(
      `the game requested ${undeclared.join(", ")} ad(s) but game.config.yaml ` +
        `monetization.ad_kinds does not declare them — the code and the design disagree`,
    );
    process.exit(1);
  }

  const out = resolve(root, args.out ?? `build/facts/${platformId}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(facts, null, 2) + "\n");
  console.log(JSON.stringify(facts, null, 2));
  console.log(`\nwrote ${args.out ?? `build/facts/${platformId}.json`}`);
}

if (isEntryPoint(import.meta.url)) main();
