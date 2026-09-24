#!/usr/bin/env node
// Prepare the SDK integration artifacts for the platforms game.config.yaml targets.
//
//   build/sdk/integration.json   per platform: adapter, how its SDK is loaded, what it can
//                                 do, and any ad kind the title declares that the adapter
//                                 cannot serve
//   build/sdk/sdk-report.json    the Factory's sdk-report artifact (sdk-report.schema.json)
//
// This PREPARES integration; it does not perform one. It makes no network request, loads
// no portal script, and never uploads or submits anything: publishing belongs to the
// release pipeline (GitHub Actions, behind the G5/G6 gates), and portal submission is a
// human checklist (scripts/publish/make-publication.mjs). The feature statuses it writes
// are "partial" for every portal SDK feature on purpose — they were exercised against
// mocked SDKs (tests/sdk-matrix, tests/unit/sdk-contract.test.ts), not a live portal.
//
// Reads the built @wgf/platform-sdk, so run `pnpm build` first.
//
// Usage:
//   node scripts/sdk/prepare-integration.mjs [--out build/sdk] [--commit <sha>]
//
// Exit 1 when the title declares an ad kind a targeted platform's adapter cannot show.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contentHash, isEntryPoint, parseArgs, readGameConfig, repoRoot } from "../_shared.mjs";

const FORMAT = "wgf-sdk-integration/1";
const OBSERVED_BY = "tests/sdk-matrix and tests/unit/sdk-contract.test.ts, mocked portal SDK";

/** How each adapter reaches its portal SDK, per the portal's own documentation. */
function sdkSources(sdk) {
  return {
    yandex: { source: sdk.YANDEX_SDK_URL, loaded: "runtime" },
    poki: { source: sdk.POKI_SDK_URL, loaded: "runtime" },
    crazygames: { source: sdk.CRAZYGAMES_SDK_URL, loaded: "html-head" },
    // <script async> in <head> when the build has an App ID; the adapter injects it otherwise.
    y8: { source: sdk.Y8_SDK_URL, loaded: "html-head" },
  };
}

function featuresFor(capabilities, hasSdk, adKinds) {
  const sdkFeature = (feature, applies = true) => ({
    feature,
    status: hasSdk && applies ? "partial" : "not-required",
    ...(hasSdk && applies ? { observed_by: OBSERVED_BY } : {}),
  });
  const features = [
    sdkFeature("init"),
    sdkFeature("loading", capabilities.loadingApi !== "none"),
    sdkFeature("gameplay-start-stop"),
  ];
  for (const kind of adKinds) {
    const served = capabilities.ads.includes(kind);
    features.push({
      feature: kind,
      status: served ? "partial" : "not-started",
      ...(served
        ? { observed_by: OBSERVED_BY }
        : { note: "declared in game.config.yaml, not offered by this adapter" }),
    });
  }
  features.push(
    capabilities.cloudSaves
      ? { feature: "cloud-save", status: "partial", observed_by: OBSERVED_BY }
      : { feature: "local-save", status: "working", observed_by: "tests/unit/storage.test.ts" },
  );
  return features;
}

/**
 * The two artifacts, as plain objects. Pure: everything it reads is passed in, so tests
 * hand it the platform-sdk source instead of the build.
 */
export function buildIntegration(
  gameConfig,
  sdk,
  { commitSha = "unknown", now = new Date() } = {},
) {
  const sources = sdkSources(sdk);
  const adKinds = gameConfig.monetization?.ad_kinds ?? [];
  const problems = [];

  const platforms = gameConfig.platforms.map((entry) => {
    const platform = sdk.createPlatform(entry.id, { namespace: gameConfig.game.id });
    const source = sources[entry.id] ?? { source: null, loaded: "none" };
    const unserved = adKinds.filter((kind) => !platform.capabilities.ads.includes(kind));
    for (const kind of unserved) {
      problems.push(`${entry.id}: the title declares "${kind}" ads, which the adapter cannot show`);
    }
    return {
      id: entry.id,
      profile: entry.profile,
      role: entry.role,
      adapter: platform.constructor.name,
      sdk: source,
      capabilities: platform.capabilities,
      unserved_ad_kinds: unserved,
      features: featuresFor(platform.capabilities, source.source !== null, adKinds),
    };
  });

  const integration = {
    format: FORMAT,
    game: { id: gameConfig.game.id, version: gameConfig.game.version },
    engine: gameConfig.engine.type,
    commit_sha: commitSha,
    platforms: platforms.map(({ features: _features, ...rest }) => rest),
    limitations: "docs/sdk.md#known-limitations",
    publishing: "not performed here — the release pipeline publishes, behind G5 and G6",
    problems,
  };

  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const report = {
    provenance: {
      artifact_id: `wgf:sdk-report:${gameConfig.game.id}:${stamp}-01`,
      artifact_type: "sdk-report",
      schema_version: "1.0.0",
      title_id: gameConfig.game.id,
      produced_by: { role: "sdk", actor: "automation" },
      produced_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      inputs: [],
      content_hash: "",
      status: "draft",
    },
    title_id: gameConfig.game.id,
    build_ref: { commit_sha: commitSha },
    platforms: platforms.map((platform) => {
      const pending = platform.features.some(
        (f) => f.status !== "working" && f.status !== "not-required",
      );
      return {
        platform_id: platform.id,
        profile_version: String(platform.profile).split("@")[1] ?? "unpinned",
        status: pending ? "partial" : "working",
        features: platform.features,
        note: platform.sdk.source
          ? "Verified against a mocked portal SDK only; the portal's own QA or draft upload is still required."
          : "No portal SDK to integrate; runs as a plain web game.",
      };
    }),
  };
  report.provenance.content_hash = contentHash(report);
  return { integration, report, problems };
}

function commitSha(root) {
  if (process.env["GITHUB_SHA"]) return process.env["GITHUB_SHA"];
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const dist = resolve(root, "packages/platform-sdk/dist/index.js");
  if (!existsSync(dist)) {
    console.error("packages/platform-sdk is not built; run `pnpm build` first");
    process.exit(2);
  }
  const sdk = await import(pathToFileURL(dist).href);
  const { integration, report, problems } = buildIntegration(readGameConfig(root), sdk, {
    commitSha: typeof args.commit === "string" ? args.commit : commitSha(root),
  });

  const out = resolve(root, typeof args.out === "string" ? args.out : "build/sdk");
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "integration.json"), JSON.stringify(integration, null, 2) + "\n");
  writeFileSync(resolve(out, "sdk-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${out}/integration.json and ${out}/sdk-report.json`);
  for (const problem of problems) console.error(`problem: ${problem}`);
  if (problems.length > 0) process.exit(1);
}

if (isEntryPoint(import.meta.url)) await main();
