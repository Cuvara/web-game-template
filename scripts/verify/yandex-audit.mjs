#!/usr/bin/env node
// Static audit of a build directory against the Yandex Games requirements that can be read
// off the files themselves.
//
// This does not replace moderation and does not claim to. It catches the mechanical causes
// of rejection before a human sees the build: a nested index.html, an absolute asset path
// that breaks on the portal's CDN, an S3 URL written into the code, a stray debugger, a
// missing Russian string. What only a person can judge — whether Game Ready fires at the
// right moment, whether the ad placement feels right — is in the compliance report's
// manual checklist, not here.
//
// Every check names the requirement it is for, from
// https://yandex.com/dev/games/doc/en/concepts/requirements.
//
// Usage:
//   node scripts/verify/yandex-audit.mjs --dir <build dir> [--out <report.json>]
//     [--max-asset-mb 5] [--required-locales ru,en]
//
// Exit code 1 if any check is an error. Warnings are printed and do not fail.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { isEntryPoint, parseArgs } from "../_shared.mjs";

const MAX_ARCHIVE_MB = 100; // 1.21
const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".svg", ".map"]);

/**
 * URL literals that are not requests. XML namespaces are identifiers that happen to look
 * like URLs; the browser never fetches them. Anything else found in the bundle is reported,
 * because a static scan cannot tell a link in an error message from a fetch.
 */
const NAMESPACE_URLS = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/xmlns/",
  "http://www.w3.org/1998/Math/MathML",
];

const SECRET_PATTERNS = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{50,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Anthropic/OpenAI key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
  ["Yandex OAuth token", /\by0_[A-Za-z0-9_-]{40,}/],
];

const DEV_PATTERNS = [
  ["localhost URL", /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/],
  ["Vite dev client", /@vite\/client|\/@fs\/|import\.meta\.hot|__vite_ping/],
  ["webpack dev server", /webpack-dev-server|sockjs-node/],
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function unique(values) {
  return [...new Set(values)].sort();
}

/** Every http(s) or protocol-relative URL literal in a text file. */
function urlLiterals(text) {
  const found = text.match(/(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[^\s"'`)<>\\]*/gi) ?? [];
  return found.filter((url) => url.startsWith("http") || url.startsWith("//"));
}

function isNamespace(url) {
  return NAMESPACE_URLS.some((ns) => url === ns || url.startsWith(ns));
}

/**
 * @param {{ dir: string, maxAssetMb?: number, requiredLocales?: string[] }} options
 * @returns {{ checks: Array<{id: string, requirement: string, status: "pass"|"warn"|"error", detail: string}>, facts: object }}
 */
export function auditBuild({ dir, maxAssetMb = 5, requiredLocales = ["ru"] }) {
  const checks = [];
  const add = (id, requirement, status, detail) => checks.push({ id, requirement, status, detail });

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    add("build_present", "—", "error", `${dir} is not a directory; build first`);
    return { checks, facts: {} };
  }

  const files = walk(dir);
  const rel = (file) => relative(dir, file).split("\\").join("/");
  const texts = new Map(
    files
      .filter((file) => TEXT_EXTENSIONS.has(extname(file).toLowerCase()))
      .map((file) => [rel(file), readFileSync(file, "utf8")]),
  );
  const code = [...texts].filter(([name]) => /\.(?:m?js|html|css)$/.test(name));

  // 1.22 — index.html at the archive root, file names without spaces or Cyrillic.
  add(
    "index_at_root",
    "1.22",
    existsSync(join(dir, "index.html")) ? "pass" : "error",
    existsSync(join(dir, "index.html")) ? "index.html is at the root" : "no index.html at root",
  );
  const badNames = files.map(rel).filter((name) => /\s/.test(name) || /[^\x20-\x7e]/.test(name));
  add(
    "file_names",
    "1.22",
    badNames.length ? "error" : "pass",
    badNames.length
      ? `bad names: ${badNames.join(", ")}`
      : `${files.length} files, all ASCII, no spaces`,
  );

  // 1.21 — at most 100 MB uncompressed. Oversized single assets are a load-time smell.
  const sizes = files.map((file) => ({ name: rel(file), bytes: statSync(file).size }));
  const totalMb = sizes.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024;
  add(
    "archive_size",
    "1.21",
    totalMb <= MAX_ARCHIVE_MB ? "pass" : "error",
    `${totalMb.toFixed(3)} MB uncompressed (limit ${MAX_ARCHIVE_MB} MB)`,
  );
  const large = sizes.filter((file) => file.bytes > maxAssetMb * 1024 * 1024);
  add(
    "asset_sizes",
    "1.21 / load time",
    large.length ? "warn" : "pass",
    large.length
      ? `over ${maxAssetMb} MB: ${large.map((f) => `${f.name} ${(f.bytes / 1048576).toFixed(1)} MB`).join(", ")}`
      : `no asset over ${maxAssetMb} MB (largest ${sizes.reduce((a, b) => (b.bytes > a.bytes ? b : a), { name: "-", bytes: 0 }).name})`,
  );

  // 1.1 / 1.19.1 — the SDK is loaded from /sdk.js, the path the docs give for archives.
  const sdkRef = code.some(([, text]) => /["'`]\/sdk\.js["'`]/.test(text));
  add(
    "sdk_relative_path",
    "1.1, 1.19.1",
    sdkRef ? "pass" : "error",
    sdkRef ? "references /sdk.js" : "no reference to /sdk.js found",
  );

  // 1.7 — no absolute URLs to Yandex S3.
  const s3 = code.flatMap(([name, text]) =>
    (text.match(/https?:\/\/[a-z0-9.-]*yandex\.net[^\s"'`]*/gi) ?? []).map(
      (url) => `${name}: ${url}`,
    ),
  );
  add(
    "no_absolute_s3",
    "1.7",
    s3.length ? "error" : "pass",
    s3.length ? s3.join("; ") : "no absolute yandex.net URLs",
  );

  // 1.19.2 / 1.19.3 / 1.19.4 / 2.14 — the SDK features the rules require are called.
  // Property names survive minification, so their presence in the bundle is meaningful.
  const bundle = code.map(([, text]) => text).join("\n");
  const sdkUses = [
    ["loading_api_ready", "1.19.2", /LoadingAPI/, "LoadingAPI.ready()"],
    ["gameplay_api", "1.19.3", /GameplayAPI/, "GameplayAPI.start()/stop()"],
    ["pause_events", "1.19.4", /game_api_pause/, "game_api_pause / game_api_resume"],
    ["language_detection", "2.14", /i18n/, "environment.i18n.lang"],
  ];
  for (const [id, requirement, pattern, what] of sdkUses) {
    const present = pattern.test(bundle);
    add(id, requirement, present ? "pass" : "error", `${what} ${present ? "present" : "missing"}`);
  }

  // 1.6.1.8 / 1.6.2.7 — something cancels the context menu.
  const contextMenu = /contextmenu/.test(bundle);
  add(
    "context_menu_blocked",
    "1.6.1.8, 1.6.2.7",
    contextMenu ? "pass" : "warn",
    contextMenu ? "a contextmenu handler is present" : "no contextmenu handler found",
  );

  // index.html — every asset reference relative, or it breaks on the portal's CDN path.
  const html = texts.get("index.html") ?? "";
  const absoluteRefs = unique(
    [...html.matchAll(/\s(?:src|href)=["'](\/[^"'/][^"']*)["']/g)].map((m) => m[1]),
  );
  add(
    "relative_asset_paths",
    "1.22 (archive hosting)",
    absoluteRefs.length ? "error" : "pass",
    absoluteRefs.length
      ? `root-absolute: ${absoluteRefs.join(", ")}`
      : "all index.html references are relative",
  );

  // External requests: scripts, styles and fonts from other hosts are requests the CSP
  // will block unless declared in the Console, and "external links" are 8.4.
  const externalTags = unique(
    [
      ...html.matchAll(
        /<(?:script|link|img|iframe)[^>]+(?:src|href)=["']((?:https?:)?\/\/[^"']+)["']/gi,
      ),
    ].map((m) => m[1]),
  );
  const cssUrls = unique(
    [...texts]
      .filter(([name]) => name.endsWith(".css") || name.endsWith(".html"))
      .flatMap(([, text]) =>
        [...text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi)].map((m) => m[1]),
      ),
  );
  const external = [...externalTags, ...cssUrls];
  add(
    "external_resources",
    "CSP / 8.4",
    external.length ? "error" : "pass",
    external.length ? external.join(", ") : "no external script, style, image, frame or font",
  );

  const literals = unique(
    code.flatMap(([, text]) => urlLiterals(text)).filter((url) => !isNamespace(url)),
  );
  add(
    "url_literals",
    "CSP / 8.4.2",
    literals.length ? "warn" : "pass",
    literals.length
      ? `URL strings in code (not necessarily requests; confirm at runtime): ${literals.join(", ")}`
      : "no URL literals besides XML namespaces",
  );

  const insecure = literals.filter((url) => url.startsWith("http://"));
  add(
    "insecure_urls",
    "https only",
    insecure.length ? "warn" : "pass",
    insecure.length ? insecure.join(", ") : "no http:// URLs besides XML namespaces",
  );

  // 1.15 — a finished game: no debug statements, no dev-server leftovers, no source maps.
  const debuggers = code
    .filter(([, text]) => /(^|[;{}\s])debugger\s*;?/m.test(text))
    .map(([n]) => n);
  add(
    "no_debugger",
    "1.15",
    debuggers.length ? "error" : "pass",
    debuggers.length ? `debugger in ${debuggers.join(", ")}` : "no debugger statements",
  );
  const logs = code.reduce(
    (sum, [, text]) => sum + (text.match(/console\.log\(/g) ?? []).length,
    0,
  );
  add(
    "console_log",
    "1.15 / 6.4",
    logs ? "warn" : "pass",
    logs ? `${logs} console.log call(s) in the bundle` : "no console.log",
  );
  const dev = code.flatMap(([name, text]) =>
    DEV_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([what]) => `${what} in ${name}`),
  );
  add("no_dev_urls", "1.15", dev.length ? "error" : "pass", dev.length ? dev.join("; ") : "none");
  const maps = files.map(rel).filter((name) => name.endsWith(".map"));
  const mapRefs = code.filter(([, text]) => /sourceMappingURL=/.test(text)).map(([n]) => n);
  add(
    "no_source_maps",
    "archive hygiene",
    maps.length || mapRefs.length ? "warn" : "pass",
    maps.length || mapRefs.length ? `maps: ${[...maps, ...mapRefs].join(", ")}` : "none shipped",
  );

  // Unsafe runtime constructs a CSP without 'unsafe-eval' would refuse.
  const evals = code.filter(([, text]) => /\beval\(|new Function\(/.test(text)).map(([n]) => n);
  add(
    "no_eval",
    "CSP",
    evals.length ? "warn" : "pass",
    evals.length ? `eval/new Function in ${evals.join(", ")}` : "none",
  );

  // Secrets never belong in a client bundle.
  const secrets = [...texts].flatMap(([name, text]) =>
    SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
      ([what]) => `${what} in ${name}`,
    ),
  );
  add(
    "no_secrets",
    "security",
    secrets.length ? "error" : "pass",
    secrets.length ? secrets.join("; ") : "none",
  );

  // 2.14 / 8.2.3 — locales shipped, and every locale has every key.
  const localeFiles = [...texts].filter(([name]) => /^locales\/[a-z]{2}\.json$/.test(name));
  const locales = localeFiles.map(([name]) => name.slice(8, 10)).sort();
  const missingLocales = requiredLocales.filter((locale) => !locales.includes(locale));
  add(
    "locales_present",
    // Yandex mandates language detection (2.14), not any particular language. Requiring ru
    // is the Factory profile's policy (locales_required), overridable with --required-locales.
    "Factory profile",
    missingLocales.length ? "error" : "pass",
    `shipped: ${locales.join(", ") || "none"}${missingLocales.length ? `; missing: ${missingLocales.join(", ")}` : ""}`,
  );
  const tables = new Map(localeFiles.map(([name, text]) => [name.slice(8, 10), JSON.parse(text)]));
  const allKeys = unique([...tables.values()].flatMap((table) => Object.keys(table)));
  const gaps = [...tables].flatMap(([locale, table]) =>
    allKeys
      .filter((key) => !(key in table) || String(table[key]).trim() === "")
      .map((key) => `${locale}:${key}`),
  );
  add(
    "locale_parity",
    "8.2.3",
    gaps.length ? "error" : "pass",
    gaps.length ? `missing or empty: ${gaps.join(", ")}` : `${allKeys.length} keys in every locale`,
  );

  // Page metadata the portal and browsers read.
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const hasTitle = /<title>[^<]+<\/title>/i.test(html);
  add(
    "html_metadata",
    "1.6 / 1.8",
    hasViewport && hasTitle ? "pass" : "error",
    `viewport meta ${hasViewport ? "present" : "missing"}, title ${hasTitle ? "present" : "missing"}`,
  );

  return {
    checks,
    facts: {
      size_mb: Number(totalMb.toFixed(3)),
      files: files.length,
      locales,
      platform_sdk: sdkRef ? "yandex" : "none",
      url_literals: literals,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error(
      "usage: yandex-audit.mjs --dir <build dir> [--out <path>] [--max-asset-mb N] [--required-locales ru,en]",
    );
    process.exit(2);
  }
  const dir = resolve(args.dir);
  const { checks, facts } = auditBuild({
    dir,
    maxAssetMb: args["max-asset-mb"] ? Number(args["max-asset-mb"]) : 5,
    requiredLocales: args["required-locales"]
      ? String(args["required-locales"]).split(",")
      : ["ru"],
  });

  for (const check of checks) {
    const mark = { pass: "ok  ", warn: "WARN", error: "FAIL" }[check.status];
    console.log(`${mark}  ${check.id.padEnd(22)} [${check.requirement}] ${check.detail}`);
  }
  const errors = checks.filter((check) => check.status === "error").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  console.log(
    `\n${checks.length - errors - warnings} passed, ${warnings} warning, ${errors} error`,
  );

  const out = resolve(args.out ?? "build/yandex/audit.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ dir: args.dir, checks, facts }, null, 2) + "\n");
  console.log(`wrote ${relative(process.cwd(), out)}`);
  process.exit(errors > 0 ? 1 : 0);
}

if (isEntryPoint(import.meta.url)) main();
