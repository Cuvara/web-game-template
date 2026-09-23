#!/usr/bin/env node
// Static audit of the built demo: what is in dist/, and what the bundle refers to.
//
// Writes build/gamevui-demo/static-audit.json at the repository root. Every check is named
// `static.<name>` there, which is how compliance/requirements.mjs refers to it.
//
// Usage: node scripts/audit.mjs [--dist <dir>] [--out <file>]

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OFFICIAL_AGE_RATINGS } from "../compliance/requirements.mjs";

export const EXAMPLE_ROOT = resolve(import.meta.dirname, "..");
export const REPO_ROOT = resolve(EXAMPLE_ROOT, "../..");
export const OUT_DIR = resolve(REPO_ROOT, "build/gamevui-demo");

/** Extensions a code-only build may contain. Anything else is an asset someone must vouch for. */
const CODE_EXTENSIONS = new Set([".html", ".js", ".css", ".json"]);

/**
 * Strings whose presence in the bundle would mean the build reaches for an undocumented
 * GameVui global, GameVui's own hosting, or an ad network. Case-sensitive on purpose:
 * minified identifiers keep their case.
 */
export const FORBIDDEN_REFERENCES = [
  "GameVuiTool",
  "GVAdBreak",
  "window.GV",
  "gamevui-tool",
  "score.min.js",
  "e.gamevui.vn",
  "gamevui.vn/",
  "adsbygoogle",
  "googlesyndication",
  "doubleclick",
  "realclick",
  "googletagmanager",
  "google-analytics",
];

export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    })
    .sort();
}

/** src/href attributes in the HTML that would break when served from a sub-folder. */
export function rootRelativeUrls(html) {
  return [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith("/") || /^[a-z]+:\/\//i.test(url));
}

export function audit({ distDir, metadata }) {
  const files = walk(distDir).map((file) => ({
    path: relative(distDir, file).split("\\").join("/"),
    bytes: statSync(file).size,
  }));
  const sizeBytes = files.reduce((total, file) => total + file.bytes, 0);
  const checks = {};
  const measures = {};

  const indexPath = join(distDir, "index.html");
  const html = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  const badUrls = rootRelativeUrls(html);
  checks["static.relative_urls"] = {
    ok: html !== "" && badUrls.length === 0,
    detail:
      html === ""
        ? "dist/index.html missing"
        : badUrls.length
          ? `absolute: ${badUrls.join(", ")}`
          : "all relative",
  };

  const bundleText = files
    .filter((file) => file.path.endsWith(".js") || file.path.endsWith(".html"))
    .map((file) => readFileSync(join(distDir, file.path), "utf8"))
    .join("\n");
  const found = FORBIDDEN_REFERENCES.filter((needle) => bundleText.includes(needle));
  checks["static.no_portal_globals"] = {
    ok: found.length === 0,
    detail: found.length
      ? `found: ${found.join(", ")}`
      : `none of ${FORBIDDEN_REFERENCES.length} references`,
  };

  const nonCode = files.filter((file) => !CODE_EXTENSIONS.has(extname(file.path)));
  const sourceMaps = files.filter((file) => file.path.endsWith(".map"));
  checks["static.asset_inventory"] = {
    ok: nonCode.length === 0 && sourceMaps.length === 0,
    detail: nonCode.length
      ? `non-code files: ${nonCode.map((f) => f.path).join(", ")}`
      : `${files.length} code files, no binary assets`,
  };

  const locales = files
    .filter((file) => file.path.startsWith("locales/") && file.path.endsWith(".json"))
    .map((file) => file.path.slice("locales/".length, -".json".length));
  checks["static.locales"] = {
    ok: locales.includes("vi"),
    detail: `shipped: ${locales.join(", ") || "none"}`,
  };

  const tables = Object.fromEntries(
    locales.map((locale) => [
      locale,
      JSON.parse(readFileSync(join(distDir, "locales", `${locale}.json`), "utf8")),
    ]),
  );
  const missingControls = locales.flatMap((locale) =>
    ["controls.desktop", "controls.mobile"]
      .filter((key) => !tables[locale][key])
      .map((key) => `${locale}:${key}`),
  );
  checks["static.controls_text"] = {
    ok: locales.length > 0 && missingControls.length === 0,
    detail: missingControls.length
      ? `missing: ${missingControls.join(", ")}`
      : "desktop and mobile controls in every shipped locale",
  };

  const needed = [
    ["title", "vi"],
    ["title", "en"],
    ["description", "vi"],
    ["description", "en"],
  ];
  const missingMeta = needed
    .filter(([field, locale]) => !metadata?.[field]?.[locale])
    .map((pair) => pair.join("."));
  for (const device of ["desktop", "mobile"]) {
    for (const locale of ["vi", "en"]) {
      if (!metadata?.controls?.[device]?.[locale]) missingMeta.push(`controls.${device}.${locale}`);
    }
  }
  checks["static.metadata_complete"] = {
    ok: missingMeta.length === 0,
    detail: missingMeta.length
      ? `missing: ${missingMeta.join(", ")}`
      : "title, description and controls in vi and en",
  };

  checks["static.age_rating_valid"] = {
    ok: OFFICIAL_AGE_RATINGS.includes(metadata?.proposed_age_rating),
    detail: `proposed ${String(metadata?.proposed_age_rating)}; official values ${OFFICIAL_AGE_RATINGS.join(", ")}`,
  };

  measures["static.size_bytes"] = sizeBytes;
  measures["static.file_count"] = files.length;
  measures["static.largest_file"] = files.reduce(
    (a, b) => (b.bytes > (a?.bytes ?? -1) ? b : a),
    null,
  );

  return { checks, measures, files };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const distDir = resolve(arg("dist", resolve(EXAMPLE_ROOT, "dist")));
  const out = resolve(arg("out", resolve(OUT_DIR, "static-audit.json")));
  if (!existsSync(join(distDir, "index.html"))) {
    console.error(`${distDir}/index.html not found — run \`pnpm build\` first`);
    process.exit(1);
  }
  const metadata = JSON.parse(
    readFileSync(resolve(EXAMPLE_ROOT, "gamevui.submission.json"), "utf8"),
  );
  const result = audit({ distDir, metadata });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");

  for (const [name, check] of Object.entries(result.checks)) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${name}  ${check.detail}`);
  }
  console.log(
    `size ${(result.measures["static.size_bytes"] / 1024).toFixed(1)} KiB in ${result.measures["static.file_count"]} files`,
  );
  console.log(`wrote ${relative(REPO_ROOT, out)}`);
  if (Object.values(result.checks).some((check) => !check.ok)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
