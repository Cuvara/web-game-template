#!/usr/bin/env node
// Audit a built web game against CrazyGames' technical requirements.
//
// Statuses, and what each one is allowed to mean:
//
//   PASS                     measured, and within the official limit
//   FAIL                     measured, and outside it — or something that is never allowed
//   WARN                     measured, not a rule violation by itself; a person should look
//   APPROXIMATION            the portal measures this itself and cannot be reproduced here
//                            exactly (initial download). Never reported as PASS.
//   MANUAL_REVIEW_REQUIRED   not decidable from files at all
//   NOT_APPLICABLE           the directory is not a game build
//
// Every limit comes from config/platforms/crazygames-limits.json, which ties it to the
// official page and the date it was read. Nothing here is a hard-coded number.
//
// Usage:
//   node scripts/crazygames-audit.mjs [--dir <build dir>]... [--runtime <json>] [--out <dir>]
//
// With no --dir, audits dist/ and build/ at the repository root — whichever contain an
// index.html. Exit code 1 when any check FAILs.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";
import { isEntryPoint, parseArgs, repoRoot } from "./_shared.mjs";

export const STATUS = /** @type {const} */ ({
  PASS: "PASS",
  FAIL: "FAIL",
  WARN: "WARN",
  APPROXIMATION: "APPROXIMATION",
  MANUAL: "MANUAL_REVIEW_REQUIRED",
  NA: "NOT_APPLICABLE",
});

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".txt",
  ".xml",
  ".svg",
  ".map",
  ".webmanifest",
]);

// Hosts a bundle may name without a request ever being made: XML namespaces and the like.
const NAMESPACE_HOSTS = new Set(["www.w3.org", "w3.org", "www.khronos.org", "ns.adobe.com"]);

// Other portals' SDKs and third-party ad networks. "Only Ads requested through the
// CrazyGames SDK are allowed." — https://docs.crazygames.com/requirements/ads/
const FORBIDDEN_DEPENDENCIES = [
  { id: "poki-sdk", pattern: /game-cdn\.poki\.com|poki-sdk|PokiSDK/ },
  { id: "yandex-games-sdk", pattern: /yandex\.ru\/games\/sdk|YaGames\b/ },
  { id: "gamedistribution", pattern: /gamedistribution\.com|gdsdk/i },
  { id: "gamemonetize", pattern: /gamemonetize\.com/i },
  { id: "gamepix", pattern: /gamepix\.com/i },
  {
    id: "google-ads",
    pattern: /googlesyndication\.com|adsbygoogle|imasdk\.googleapis\.com|doubleclick\.net/,
  },
  { id: "adinplay", pattern: /adinplay\.com/i },
  { id: "applovin", pattern: /applovin\.com/i },
  { id: "unity-ads", pattern: /unityads\.unity3d\.com/i },
];

// Not forbidden, but "In case your game collects additional personal data beyond the events
// in our SDK, the game should add a Terms & Conditions and/or Privacy Policy notice".
const TRACKING_DEPENDENCIES = [
  { id: "google-analytics", pattern: /google-analytics\.com|googletagmanager\.com|\bgtag\(/ },
  { id: "facebook-pixel", pattern: /connect\.facebook\.net|fbq\(/ },
  { id: "hotjar", pattern: /hotjar\.com/ },
  { id: "sentry", pattern: /sentry\.io|ingest\.sentry/ },
];

// App store links are never allowed in-game.
// https://docs.crazygames.com/requirements/gameplay/#basic-gameplay-requirements
const APP_STORE = /\b(?:apps\.apple\.com|itunes\.apple\.com|play\.google\.com\/store)\b/;

const SECRET_PATTERNS = [
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    id: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/,
  },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "openai-or-anthropic-key", pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/ },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "stripe-secret", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
];

export function loadLimits(root = repoRoot()) {
  return JSON.parse(readFileSync(resolve(root, "config/platforms/crazygames-limits.json"), "utf8"));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const mb = (bytes) => Number((bytes / 1_000_000).toFixed(3));

function check(id, requirement, status, detail, extra = {}) {
  return { id, requirement, status, detail, ...extra };
}

/** Local, bundle-relative references in index.html: scripts, stylesheets, preloads, images. */
function htmlReferences(html) {
  const refs = [];
  const tag = /<(script|link|img|source|audio|video)\b([^>]*)>/gi;
  for (const match of html.matchAll(tag)) {
    const attrs = match[2];
    const url = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!url) continue;
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
    refs.push({ tag: match[1].toLowerCase(), url, rel: rel.toLowerCase(), isModule });
  }
  return refs;
}

const isRemote = (url) => /^(?:https?:)?\/\//i.test(url);
const isAbsoluteLocal = (url) => url.startsWith("/") && !url.startsWith("//");

/**
 * The files a browser must fetch before any game code can run — index.html, what it links
 * directly, and the static `import` graph of its module scripts. Dynamic `import()` is left
 * out. A lower bound on the true initial download: the game may fetch more before its first
 * gameplayStart, which only a runtime measurement sees.
 */
export function staticInitialFiles(dir, html) {
  const files = new Set(["index.html"]);
  const queue = [];
  for (const ref of htmlReferences(html)) {
    if (isRemote(ref.url) || ref.url.startsWith("data:")) continue;
    const local = posix.normalize(ref.url.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0]);
    if (!existsSync(join(dir, local))) continue;
    if (ref.tag === "link" && !/stylesheet|modulepreload|preload/.test(ref.rel)) continue;
    files.add(local);
    if (local.endsWith(".js") || local.endsWith(".mjs")) queue.push(local);
  }
  const staticImport = /(?:^|[;\s}])import\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']/g;
  const reexport = /(?:^|[;\s}])export\s*(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
  while (queue.length > 0) {
    const current = queue.shift();
    const source = readFileSync(join(dir, current), "utf8");
    for (const match of [...source.matchAll(staticImport), ...source.matchAll(reexport)]) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(current), spec));
      if (files.has(target) || !existsSync(join(dir, target))) continue;
      files.add(target);
      queue.push(target);
    }
  }
  return [...files].sort();
}

function hostsIn(text) {
  const hosts = new Map();
  for (const match of text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/[^\s"'`)<>\\]*)?/gi)) {
    const host = match[1].toLowerCase();
    if (!hosts.has(host)) hosts.set(host, match[0]);
  }
  return hosts;
}

function isCrazyGamesHost(host) {
  return (
    host === "crazygames.com" ||
    host.endsWith(".crazygames.com") ||
    /^(?:www\.)?crazygames\.[a-z.]+$/.test(host)
  );
}

export function auditDirectory(dir, { limits, runtime: givenRuntime = null, label = dir } = {}) {
  let runtime = givenRuntime;
  const results = [];
  const indexPath = join(dir, "index.html");
  if (!existsSync(dir) || !existsSync(indexPath)) {
    return {
      dir: label,
      results: [
        check(
          "build_present",
          "A game build with index.html at its root",
          STATUS.NA,
          `${label} has no index.html — not a game build`,
        ),
      ],
    };
  }

  const L = limits.limits;
  const files = walk(dir).map((full) => ({
    path: relative(dir, full).split("\\").join("/"),
    full,
    bytes: statSync(full).size,
  }));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const html = readFileSync(indexPath, "utf8");
  const refs = htmlReferences(html);
  const sdkRef = refs.find((ref) => ref.tag === "script" && ref.url === limits.sdk.url);
  const outdatedSdk = refs.find((ref) => limits.sdk.outdated_urls.includes(ref.url));

  // ---- SDK --------------------------------------------------------------------------------
  if (outdatedSdk) {
    results.push(
      check(
        "sdk_version",
        "Current HTML5 SDK (v3)",
        STATUS.FAIL,
        `index.html loads ${outdatedSdk.url}; current is ${limits.sdk.url}`,
        { source: limits.sdk.source },
      ),
    );
  } else if (sdkRef) {
    const headIndex = html.indexOf("</head>");
    const sdkIndex = html.indexOf(limits.sdk.url);
    const inHead = headIndex === -1 || sdkIndex < headIndex;
    results.push(
      check(
        "sdk_version",
        "Current HTML5 SDK (v3), loaded in <head> before game code",
        inHead ? STATUS.PASS : STATUS.WARN,
        `${limits.sdk.url}${inHead ? " in <head>" : " outside <head>"} (observed ${limits.sdk.observed_version} on ${limits.sdk.retrieved})`,
        { source: limits.sdk.source },
      ),
    );
  } else {
    results.push(
      check(
        "sdk_version",
        "SDK integrated (mandatory for Full Launch; optional for Basic)",
        STATUS.WARN,
        "index.html does not load the CrazyGames SDK: acceptable for BASIC_LAUNCH only, and the total-size limit drops to 50 MB",
        { source: limits.sdk.source },
      ),
    );
  }

  // ---- Size and count ---------------------------------------------------------------------
  const totalLimit = sdkRef ? L.total_size_bytes : L.total_size_without_sdk_bytes;
  results.push(
    check(
      "total_size",
      totalLimit.text,
      totalBytes <= totalLimit.value ? STATUS.PASS : STATUS.FAIL,
      `${mb(totalBytes)} MB of ${mb(totalLimit.value)} MB`,
      { value: totalBytes, limit: totalLimit.value, source: totalLimit.source },
    ),
  );
  results.push(
    check(
      "file_count",
      L.file_count.text,
      files.length <= L.file_count.value ? STATUS.PASS : STATUS.FAIL,
      `${files.length} files of ${L.file_count.value}`,
      { value: files.length, limit: L.file_count.value, source: L.file_count.source },
    ),
  );

  // ---- Initial download -------------------------------------------------------------------
  const initial = staticInitialFiles(dir, html);
  const initialBytes = initial.reduce(
    (sum, path) => sum + (files.find((f) => f.path === path)?.bytes ?? 0),
    0,
  );
  const initialLimit = L.initial_download_bytes;
  const mobileLimit = L.initial_download_mobile_homepage_bytes;
  results.push(
    check(
      "initial_download_static",
      initialLimit.text,
      initialBytes > initialLimit.value ? STATUS.FAIL : STATUS.APPROXIMATION,
      `${mb(initialBytes)} MB across ${initial.length} files linked or statically imported from index.html — a lower bound; ` +
        `the portal measures to the first gameplayStart. Limits: ${mb(initialLimit.value)} MB, ${mb(mobileLimit.value)} MB for the mobile homepage` +
        (initialBytes > mobileLimit.value ? " — ALREADY OVER the mobile homepage limit" : ""),
      {
        value: initialBytes,
        limit: initialLimit.value,
        files: initial,
        source: initialLimit.source,
      },
    ),
  );
  const indexHash = createHash("sha256").update(readFileSync(indexPath)).digest("hex");
  // A measurement without the hash cannot be tied to this build, so it is treated as stale.
  if (runtime && runtime.index_html_sha256 !== indexHash) {
    results.push(
      check(
        "initial_download_runtime",
        initialLimit.text,
        STATUS.MANUAL,
        (runtime.index_html_sha256
          ? "The runtime measurement was taken on a different build (index.html changed since). "
          : "The runtime measurement has no build hash, so it cannot be tied to this build. ") +
          "Re-run `pnpm test:crazygames` against this build.",
        { source: initialLimit.source },
      ),
    );
    runtime = null;
  } else if (runtime) {
    const measured = runtime.initial_download_bytes;
    results.push(
      check(
        "initial_download_runtime",
        initialLimit.text,
        measured > initialLimit.value ? STATUS.FAIL : STATUS.APPROXIMATION,
        `${mb(measured)} MB loaded before the first gameplayStart (${runtime.gameplay_start_ms} ms) — ${runtime.method}`,
        {
          value: measured,
          limit: initialLimit.value,
          mobile_limit: mobileLimit.value,
          source: initialLimit.source,
        },
      ),
    );
  } else {
    results.push(
      check(
        "initial_download_runtime",
        initialLimit.text,
        STATUS.MANUAL,
        "No runtime measurement supplied (--runtime). Run `pnpm test:crazygames` to produce build/crazygames-runtime.json, and confirm the figure in the CrazyGames QA tool.",
        { source: initialLimit.source },
      ),
    );
  }

  // ---- Paths and external references ------------------------------------------------------
  const absolute = refs.filter((ref) => isAbsoluteLocal(ref.url)).map((ref) => ref.url);
  results.push(
    check(
      "relative_paths",
      L.relative_paths_only.text,
      absolute.length ? STATUS.FAIL : STATUS.PASS,
      absolute.length
        ? `absolute paths in index.html: ${absolute.join(", ")}`
        : "every local reference in index.html is relative",
      { source: L.relative_paths_only.source },
    ),
  );

  const externalScripts = refs.filter(
    (ref) => ref.tag === "script" && isRemote(ref.url) && ref.url !== limits.sdk.url,
  );
  results.push(
    check(
      "external_scripts",
      "Only the CrazyGames SDK is loaded from outside the bundle",
      externalScripts.length ? STATUS.FAIL : STATUS.PASS,
      externalScripts.length
        ? externalScripts.map((r) => r.url).join(", ")
        : sdkRef
          ? "only the CrazyGames SDK"
          : "none",
    ),
  );

  const externalAssets = refs.filter((ref) => ref.tag !== "script" && isRemote(ref.url));
  const cssRemote = [];
  const textFiles = files.filter((file) => TEXT_EXTENSIONS.has(extname(file.path).toLowerCase()));
  const texts = textFiles.map((file) => ({ ...file, text: readFileSync(file.full, "utf8") }));
  for (const file of texts.filter((f) => f.path.endsWith(".css"))) {
    for (const match of file.text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi))
      cssRemote.push(`${file.path}: ${match[1]}`);
  }
  const remoteAssets = [...externalAssets.map((r) => r.url), ...cssRemote];
  results.push(
    check(
      "external_assets",
      "Assets are bundled; externally loaded files are judged on time to gameplay (≤ 20 s)",
      remoteAssets.length ? STATUS.WARN : STATUS.PASS,
      remoteAssets.length
        ? remoteAssets.join(", ")
        : "no remote stylesheets, fonts, images or media referenced",
      { source: L.time_to_gameplay_external_s.source },
    ),
  );

  // URL literals anywhere in shipped text. A literal is not a request — libraries carry
  // documentation links in error messages — so unknown hosts are WARN, and the browser
  // suite's network test is what proves nothing is fetched.
  const hosts = new Map();
  for (const file of texts) {
    for (const [host, sample] of hostsIn(file.text)) {
      if (!hosts.has(host)) hosts.set(host, { files: new Set(), sample });
      hosts.get(host).files.add(file.path);
    }
  }
  const unknownHosts = [...hosts.entries()].filter(
    ([host]) => !isCrazyGamesHost(host) && !NAMESPACE_HOSTS.has(host),
  );
  results.push(
    check(
      "external_urls",
      "No requests to third-party hosts",
      unknownHosts.length ? STATUS.WARN : STATUS.PASS,
      unknownHosts.length
        ? `URL literals for ${unknownHosts.length} non-CrazyGames host(s): ` +
            unknownHosts
              .map(([host, info]) => `${host} (${[...info.files].slice(0, 2).join(", ")})`)
              .join("; ") +
            ". Literals are not requests; see network_requests."
        : "no URL literals outside CrazyGames and XML namespaces",
      {
        hosts: Object.fromEntries(
          unknownHosts.map(([host, info]) => [
            host,
            { files: [...info.files], sample: info.sample },
          ]),
        ),
      },
    ),
  );

  if (runtime && Array.isArray(runtime.external_requests)) {
    const foreign = runtime.external_requests.filter(
      (url) => !isCrazyGamesHost(new URL(url).hostname),
    );
    results.push(
      check(
        "network_requests",
        "No requests to third-party hosts",
        foreign.length ? STATUS.FAIL : STATUS.PASS,
        foreign.length
          ? foreign.join(", ")
          : `observed requests leave the origin only for CrazyGames (${runtime.external_requests.length} external)`,
      ),
    );
  } else {
    results.push(
      check(
        "network_requests",
        "No requests to third-party hosts",
        STATUS.MANUAL,
        "No runtime request log supplied; run the browser suite (tests/crazygames/flow.spec.ts asserts this)",
      ),
    );
  }

  // ---- Dependencies, content, debug, secrets ----------------------------------------------
  const all = texts.map((f) => ({ path: f.path, text: f.text }));
  const found = (patterns) =>
    patterns.flatMap(({ id, pattern }) => {
      const hits = all.filter((f) => pattern.test(f.text)).map((f) => f.path);
      return hits.length ? [`${id} (${hits.slice(0, 3).join(", ")})`] : [];
    });

  const forbidden = found(FORBIDDEN_DEPENDENCIES);
  results.push(
    check(
      "unexpected_dependencies",
      "Only ads through the CrazyGames SDK; no other portal SDKs",
      forbidden.length ? STATUS.FAIL : STATUS.PASS,
      forbidden.length ? forbidden.join("; ") : "no other portal SDK or ad network found",
      { source: "https://docs.crazygames.com/requirements/ads/" },
    ),
  );

  const tracking = found(TRACKING_DEPENDENCIES);
  results.push(
    check(
      "tracking",
      "Extra personal data needs a Terms/Privacy notice",
      tracking.length ? STATUS.WARN : STATUS.PASS,
      tracking.length
        ? `${tracking.join("; ")} — add a privacy notice if personal data is collected`
        : "no third-party analytics or tracking found",
      { source: "https://docs.crazygames.com/requirements/technical/#user-consent" },
    ),
  );

  const appStore = all.filter((f) => APP_STORE.test(f.text)).map((f) => f.path);
  results.push(
    check(
      "cross_promotion_app_store",
      "App Store links are never allowed in-game",
      appStore.length ? STATUS.FAIL : STATUS.PASS,
      appStore.length ? appStore.join(", ") : "no app store links",
      { source: "https://docs.crazygames.com/requirements/gameplay/#basic-gameplay-requirements" },
    ),
  );

  const outbound = all
    .filter((f) =>
      /<a\s[^>]*href\s*=\s*["']https?:|window\.open\(|target\s*=\s*["']_blank/.test(f.text),
    )
    .map((f) => f.path);
  results.push(
    check(
      "external_links",
      "No cross-promotion; community/store links only as documented exceptions",
      outbound.length ? STATUS.MANUAL : STATUS.PASS,
      outbound.length
        ? `outbound link code in ${outbound.join(", ")} — confirm each target is an allowed exception`
        : "no outbound links or window.open",
      { source: "https://docs.crazygames.com/requirements/gameplay/#basic-gameplay-requirements" },
    ),
  );

  const fullscreen = all
    .filter((f) =>
      /\b(?:webkit|moz|ms)?[rR]equestFullscreen\s*\(|\brequestFullScreen\s*\(/.test(f.text),
    )
    .map((f) => f.path);
  results.push(
    check(
      "fullscreen_api",
      "No custom fullscreen buttons — CrazyGames provides fullscreen",
      fullscreen.length ? STATUS.MANUAL : STATUS.PASS,
      fullscreen.length
        ? `requestFullscreen called in ${fullscreen.join(", ")} — confirm no in-game fullscreen button`
        : "no Fullscreen API calls in the bundle",
      { source: "https://docs.crazygames.com/requirements/gameplay/#basic-gameplay-requirements" },
    ),
  );

  const debuggers = all.filter((f) => /(?:^|[;{}\s])debugger\s*;/.test(f.text)).map((f) => f.path);
  const maps = files.filter((f) => f.path.endsWith(".map")).map((f) => f.path);
  const mapRefs = all.filter((f) => /\/[/*]# sourceMappingURL=/.test(f.text)).map((f) => f.path);
  const consoleLogs = all.reduce((n, f) => n + (f.text.match(/\bconsole\.log\(/g)?.length ?? 0), 0);
  results.push(
    check(
      "debug_code",
      "No debug code in the production build",
      debuggers.length ? STATUS.FAIL : maps.length || mapRefs.length ? STATUS.WARN : STATUS.PASS,
      [
        debuggers.length
          ? `debugger statements in ${debuggers.join(", ")}`
          : "no debugger statements",
        maps.length ? `${maps.length} source map file(s) shipped` : "no source maps shipped",
        mapRefs.length ? `sourceMappingURL in ${mapRefs.length} file(s)` : null,
        `${consoleLogs} console.log call site(s)${consoleLogs ? " (library code included; review)" : ""}`,
      ]
        .filter(Boolean)
        .join("; "),
      { console_log_sites: consoleLogs },
    ),
  );

  const secrets = found(SECRET_PATTERNS);
  const envFiles = files
    .filter((f) => /(^|\/)\.env(\.|$)|\.pem$|\.key$|id_rsa/.test(f.path))
    .map((f) => f.path);
  results.push(
    check(
      "secrets",
      "No credentials in the shipped bundle",
      secrets.length || envFiles.length ? STATUS.FAIL : STATUS.PASS,
      secrets.length || envFiles.length
        ? [...secrets, ...envFiles].join("; ")
        : "no known credential patterns or key files",
    ),
  );

  // ---- Mobile basics visible in the files --------------------------------------------------
  const userSelectNone =
    /user-select\s*:\s*none/.test(html) && /-webkit-user-select\s*:\s*none/.test(html);
  results.push(
    check(
      "mobile_user_select",
      "body has user-select: none (tablet magnifier / context menu)",
      userSelectNone ? STATUS.PASS : STATUS.WARN,
      userSelectNone
        ? "set in index.html"
        : "user-select: none not found in index.html — check the stylesheet",
      { source: "https://docs.crazygames.com/requirements/technical/#mobile-game-requirements" },
    ),
  );
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  results.push(
    check(
      "mobile_viewport",
      "Responsive viewport meta",
      viewport ? STATUS.PASS : STATUS.WARN,
      viewport ? "viewport meta present" : "no viewport meta tag",
    ),
  );

  // ---- What files cannot tell -------------------------------------------------------------
  results.push(
    check(
      "qa_tool",
      "CrazyGames QA/preview tool run on the uploaded build",
      STATUS.MANUAL,
      "Requires a Developer Portal account and an upload: https://developer.crazygames.com/ — no public API",
      { source: "https://docs.crazygames.com/requirements/intro/#quality-assurance-tool" },
    ),
  );

  return { dir: label, total_bytes: totalBytes, file_count: files.length, results };
}

export function summarize(audits) {
  const counts = {};
  for (const audit of audits)
    for (const result of audit.results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return counts;
}

function toMarkdown(report) {
  const lines = [
    "# CrazyGames build audit",
    "",
    `Generated ${report.generated_at} from limits retrieved ${report.limits_retrieved}.`,
    "",
    "APPROXIMATION and MANUAL_REVIEW_REQUIRED are not passes. See scripts/crazygames-audit.mjs.",
  ];
  for (const audit of report.audits) {
    lines.push("", `## ${audit.dir}`, "", "| Check | Status | Detail |", "| --- | --- | --- |");
    for (const r of audit.results)
      lines.push(`| ${r.id} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const limits = loadLimits(root);

  const rawDirs = process.argv
    .slice(2)
    .flatMap((token, i, all) => (token === "--dir" && all[i + 1] ? [all[i + 1]] : []));
  const dirs = rawDirs.length > 0 ? rawDirs : ["dist", "build"];

  const runtimePath =
    typeof args.runtime === "string"
      ? resolve(root, args.runtime)
      : resolve(root, "build/crazygames-runtime.json");
  const runtime = existsSync(runtimePath) ? JSON.parse(readFileSync(runtimePath, "utf8")) : null;

  // A runtime measurement belongs to the build it was taken from, and is only applied there.
  const norm = (dir) => relative(root, resolve(root, dir)).split("\\").join("/");
  const audits = dirs.map((dir) =>
    auditDirectory(resolve(root, dir), {
      limits,
      runtime: runtime && norm(runtime.build_dir ?? "") === norm(dir) ? runtime : null,
      label: dir,
    }),
  );
  const report = {
    generated_at: new Date().toISOString(),
    limits_retrieved: limits.retrieved,
    runtime: runtime ? relative(root, runtimePath) : null,
    summary: summarize(audits),
    audits,
  };

  const outDir = resolve(root, typeof args.out === "string" ? args.out : "build");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "crazygames-audit.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outDir, "crazygames-audit.md"), toMarkdown(report));

  for (const audit of audits) {
    console.log(`\n${audit.dir}`);
    for (const r of audit.results)
      console.log(`  ${r.status.padEnd(22)} ${r.id.padEnd(26)} ${r.detail}`);
  }
  console.log(`\nsummary: ${JSON.stringify(report.summary)}`);
  console.log(
    `written: ${relative(root, join(outDir, "crazygames-audit.json"))}, ${relative(root, join(outDir, "crazygames-audit.md"))}`,
  );

  const failed = audits.some((audit) => audit.results.some((r) => r.status === STATUS.FAIL));
  const applicable = audits.some((audit) => audit.results.some((r) => r.status !== STATUS.NA));
  if (!applicable) {
    console.error("no game build found in any audited directory");
    process.exitCode = 1;
  }
  if (failed) process.exitCode = 1;
}

if (isEntryPoint(import.meta.url)) main();
