#!/usr/bin/env node
// Measure the package facts a platform profile's assertions are written against.
//
// Facts come from two places and it matters which is which:
//
//   STATIC   — read off the built artifact for THIS platform and the config it was built
//              from. Deterministic.
//   RUNTIME  — observed by driving that artifact in a browser (`playwright test --project
//              verify` writes build/runtime-facts/<id>.json, and build/runtime-facts.json for
//              the target platform).
//
// The artifact is build/platforms/<id>/dist when build/platforms/index.json lists the
// platform (`pnpm build:platforms`), else the single-target build in dist/. Measuring dist/
// for a platform it was not built for would judge the wrong bytes, so the artifact used is
// recorded in the output.
//
// `package.platform_sdk` is DERIVED from the artifact, never from the platform id asked
// about: every shipped .js/.html file is scanned for the portal SDK signatures in
// packages/platform-sdk/sdk-signatures.json. Exactly one portal found -> that id; none ->
// "none"; several -> "mixed:<sorted ids>". Reporting the requested id back (what this script
// used to do) made the profile's `platform_sdk` assertion a tautology that passed for any
// bundle, including one that shipped every portal's SDK or none at all.
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
import { dirname, join, relative, resolve } from "node:path";
import { isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

const SIGNATURES_PATH = "packages/platform-sdk/sdk-signatures.json";
const PLATFORM_INDEX_PATH = "build/platforms/index.json";

/** Files a portal SDK reference can live in. Source maps are not shipped, so not scanned. */
const SCANNED_EXTENSIONS = [".js", ".mjs", ".cjs", ".html", ".htm"];

/** A usage/config error: reported as one line with exit code 2, never as a stack. */
export class FactsError extends Error {}

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

function readJsonIfPresent(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const toPosix = (path) => path.split("\\").join("/");

/**
 * Locales the package actually ships, read from the built output rather than from a
 * declaration. Yandex, CrazyGames and GameVui all make a locale a blocking assertion, and
 * the thing they care about is whether the file is in the bundle.
 */
function shippedLocales(artifactDir) {
  const dir = join(artifactDir, "locales");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

function screenshotCount(artifactDir) {
  return walkFiles(join(artifactDir, "metadata/screenshots")).length;
}

/**
 * Which directory holds the artifact for `platformId`, and the per-platform build record
 * when there is one. A per-platform build is preferred whenever the index lists the
 * platform; dist/ is the fallback for a plain `pnpm build`.
 */
export function resolveArtifact(root, platformId, gameConfig) {
  const index = readJsonIfPresent(resolve(root, PLATFORM_INDEX_PATH));
  const entry = index?.platforms?.find((candidate) => candidate.id === platformId);
  if (entry) {
    const dir = resolve(root, entry.dir ?? `build/platforms/${platformId}/dist`);
    const buildJson = readJsonIfPresent(resolve(dir, "..", "build.json"));
    return { dir, source: "platform-build", build: buildJson ?? entry };
  }
  const dir = resolve(root, gameConfig.build?.output ?? "dist");
  return { dir, source: "dist", build: null };
}

/** The portal SDK signatures — the single source shared with the build's isolation check. */
export function loadSdkSignatures(root) {
  const path = resolve(root, SIGNATURES_PATH);
  if (!existsSync(path)) throw new FactsError(`missing ${SIGNATURES_PATH}`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Object.fromEntries(
    Object.entries(raw).filter(([key, value]) => !key.startsWith("_") && Array.isArray(value)),
  );
}

/**
 * Scan every shipped script/page in `artifactDir` for portal SDK signatures. Returns the
 * derived fact plus the evidence (which file matched which portal), so a surprising
 * "mixed:" can be traced to the file that carries it.
 */
export function scanPlatformSdk(artifactDir, signatures) {
  const evidence = {};
  for (const file of walkFiles(artifactDir)) {
    if (!SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension))) continue;
    const text = readFileSync(file, "utf8");
    for (const [portal, needles] of Object.entries(signatures)) {
      if (needles.some((needle) => text.includes(needle))) {
        (evidence[portal] ??= []).push(toPosix(relative(artifactDir, file)));
      }
    }
  }
  return { platform_sdk: platformSdkFromPortals(Object.keys(evidence)), evidence };
}

/** One portal -> its id; none -> "none"; several -> "mixed:<sorted ids>". */
export function platformSdkFromPortals(portals) {
  const sorted = [...new Set(portals)].sort();
  if (sorted.length === 0) return "none";
  if (sorted.length === 1) return sorted[0];
  return `mixed:${sorted.join(",")}`;
}

/**
 * Runtime facts for `platformId`: its own file first, then the target-platform compat file.
 * An explicit --runtime path wins over both.
 */
export function resolveRuntimePath(root, platformId, override) {
  if (override) return resolve(root, override);
  const own = resolve(root, `build/runtime-facts/${platformId}.json`);
  return existsSync(own) ? own : resolve(root, "build/runtime-facts.json");
}

/** The platform id the running game reported, if the runtime facts recorded one. */
export function runtimePlatform(runtime) {
  const observed = runtime?.observed ?? {};
  return observed.platformId ?? observed.target ?? runtime?.platform ?? null;
}

export function collectFacts({ root, platformId, gameConfig, runtime, artifact, signatures }) {
  const resolved = artifact ?? resolveArtifact(root, platformId, gameConfig);
  if (!existsSync(resolved.dir)) {
    throw new FactsError(
      `no built artifact for ${platformId} at ${toPosix(relative(root, resolved.dir))} — ` +
        "run `pnpm build` (or `pnpm build:platforms`) first",
    );
  }
  const scan = scanPlatformSdk(resolved.dir, signatures ?? loadSdkSignatures(root));
  const adKinds = gameConfig.monetization?.ad_kinds ?? [];
  const observedPlatform = runtimePlatform(runtime);

  const facts = {
    package: {
      ...(runtime?.package ?? {}),
      size_mb: directorySizeMb(resolved.dir),
      locales: shippedLocales(resolved.dir),
      // Static wins over runtime for the artifact-derived and declared facts — see header.
      platform_sdk: scan.platform_sdk,
      uses_banner_ads: adKinds.includes("banner"),
      uses_rewarded_ads: adKinds.includes("rewarded"),
      uses_interstitial_ads: adKinds.includes("interstitial"),
      ...(typeof resolved.build?.portal_configured === "boolean"
        ? { portal_configured: resolved.build.portal_configured }
        : {}),
      ...(observedPlatform !== null
        ? {
            runtime_platform: observedPlatform,
            runtime_platform_matches: observedPlatform === platformId,
          }
        : {}),
      perf: { ...(runtime?.package?.perf ?? {}) },
    },
    metadata: {
      ...(runtime?.metadata ?? {}),
      screenshots: screenshotCount(resolved.dir),
    },
    evidence: {
      artifact: toPosix(relative(root, resolved.dir)),
      artifact_source: resolved.source,
      platform_sdk_matches: scan.evidence,
    },
  };

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
  if (!platformId || platformId === true) {
    console.error("usage: collect-facts.mjs --platform <id> [--runtime <path>] [--out <path>]");
    process.exit(2);
  }

  const root = repoRoot();
  const gameConfig = readGameConfig(root);
  const runtimePath = resolveRuntimePath(root, platformId, args.runtime);
  const runtimeLabel = toPosix(relative(root, runtimePath));

  let runtime = null;
  if (existsSync(runtimePath)) {
    runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
  } else {
    console.warn(
      `no runtime facts at ${runtimeLabel} — ` +
        `run \`pnpm test:verify\` first, or assertions on observed facts will report as not evaluable`,
    );
  }

  let facts;
  try {
    facts = collectFacts({ root, platformId, gameConfig, runtime });
  } catch (error) {
    if (!(error instanceof FactsError)) throw error;
    console.error(`collect-facts: ${error.message}`);
    process.exit(2);
  }

  // Runtime facts measured on another platform's build describe different bytes. Merging
  // them would put, say, the generic-web run's insecure_requests on a Poki package.
  if (facts.package.runtime_platform_matches === false) {
    console.error(
      `runtime facts in ${runtimeLabel} were observed on platform ` +
        `"${facts.package.runtime_platform}", not "${platformId}" — ` +
        `run \`pnpm test:verify\` against the ${platformId} build`,
    );
    process.exit(1);
  }

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
