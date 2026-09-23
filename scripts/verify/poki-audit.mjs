#!/usr/bin/env node
// Static compliance audit of a production build bound for Poki.
//
// Reads the built files — what Poki would receive — and the game's source, and reports
// anything Poki's published requirements rule out:
//
//   https://developers.poki.com/guide/requirements-quality
//   https://developers.poki.com/guide/external-resources-policy
//   https://developers.poki.com/guide/sdk-html5
//
// It is a static check and says so. It can prove a URL is present in the bundle; it cannot
// prove one is never requested. The runtime half is tests/poki/poki.spec.ts, which fails on
// any request leaving the page's origin. The two together are the evidence; neither alone.
//
// Every URL that may appear is listed below with the reason it is harmless. A URL that is
// not listed fails the audit — adding one is a reviewed change to this file, never a flag.
//
// Usage:
//   node scripts/verify/poki-audit.mjs --dist <dir> [--src <dir,dir>] [--out <file>]
//
// Exit status 1 when any finding has severity "error".

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { isEntryPoint, parseArgs, repoRoot } from "../_shared.mjs";

/** The one runtime request a Poki build may make: Poki's own documented SDK loader. */
export const POKI_SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

/**
 * URLs that occur in the bundle as inert strings — never requested. Each needs a reason a
 * reviewer can check.
 */
export const INERT_URLS = [
  {
    pattern: /^http:\/\/www\.pixijs\.com\/?$/,
    reason:
      "PixiJS's console banner, printed only when Application.init is given `hello: true`, " +
      "which @wgf/pixi-framework never passes. Not a request, not rendered.",
  },
  {
    pattern:
      /^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1998\/Math\/MathML|XML\/1998\/namespace)$/,
    reason: "XML namespace identifiers. Browsers never fetch them.",
  },
];

/** Ad networks other than Poki's. "Poki's SDK handles ads, so no other ad systems are allowed." */
const THIRD_PARTY_ADS = [
  "googlesyndication",
  "doubleclick",
  "adsbygoogle",
  "imasdk",
  "googletagservices",
  "applovin",
  "unityads",
  "ironsrc",
  "adinplay",
  "gamedistribution",
  "gamemonetize",
  "adsterra",
  "propellerads",
  "vungle",
  "chartboost",
];

/** Analytics Poki does not provide. Google Analytics "cannot be approved". */
const ANALYTICS = [
  "google-analytics",
  "googletagmanager",
  "gtag(",
  "mixpanel",
  "amplitude.com",
  "segment.io",
  "hotjar",
  "fbq(",
  "connect.facebook.net",
  "gameanalytics",
  "bytebrew",
  "sentry.io",
];

/**
 * Other portals and stores. Poki requires web exclusivity and removal of unrelated
 * branding; another portal's name or SDK in a Poki build is both.
 */
const OTHER_PORTALS = [
  "crazygames",
  "yandex",
  "gamevui",
  "gamedistribution",
  "gamemonetize",
  "kongregate",
  "armorgames",
  "armor games",
  "coolmathgames",
  "miniclip",
  "newgrounds",
  "itch.io",
  "y8.com",
  "gamepix",
  "addictinggames",
  "play.google.com",
  "apps.apple.com",
];

/** APIs a build must not use for traffic of its own. Present in the bundle = investigate. */
const NETWORK_APIS = [
  {
    token: "new WebSocket",
    severity: "error",
    note: "no multiplayer server is approved for this game",
  },
  {
    token: "new EventSource",
    severity: "error",
    note: "server-sent events need an approved external host",
  },
  { token: "sendBeacon", severity: "error", note: "beacons are analytics traffic" },
  { token: "RTCPeerConnection", severity: "error", note: "peer connections are external traffic" },
  {
    token: "XMLHttpRequest",
    severity: "warning",
    note: "same-origin loading only; the runtime suite checks origins",
  },
  {
    token: "fetch(",
    severity: "info",
    note: "same-origin asset loading; the runtime suite checks origins",
  },
];

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".txt",
  ".xml",
  ".webmanifest",
]);
// https://developers.poki.com/guide/web-engine: "For a good web game the initial download
// should not exceed 5MB and 8MB in total." The Factory's Poki profile says 150 MB; Poki's
// own figure is the one enforced here.
const MAX_INITIAL_MB = 5;
const MAX_TOTAL_MB = 8;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    // pnpm links dependencies in as symlinks; they are neither the build nor our source.
    if (entry.isSymbolicLink() || entry.name === "node_modules") return [];
    return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
  });
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function excerpt(text, index, length) {
  return text
    .slice(Math.max(0, index - 40), index + length + 40)
    .replace(/\s+/g, " ")
    .trim();
}

function allIndexes(haystack, needle) {
  const found = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return found;
}

/**
 * Audit one set of built files. Pure: takes `{ path, text }[]` so tests need no disk.
 * Binary files are passed with `text: null` and only counted for size.
 */
export function auditBundle(files) {
  const findings = [];
  const add = (severity, rule, file, message, index, text) =>
    findings.push({
      severity,
      rule,
      file,
      ...(index !== undefined && text
        ? { line: lineOf(text, index), excerpt: excerpt(text, index, 20) }
        : {}),
      message,
    });

  let sdkLoaderSeen = false;
  const sdkEvents = new Set();
  const urls = [];

  for (const { path, text } of files) {
    if (path.endsWith(".map")) {
      add(
        "error",
        "clean-build",
        path,
        "source map shipped — Poki asks for a clean build without development artifacts",
      );
      continue;
    }
    if (/(^|\/)\.env/.test(path) || /\.(spec|test)\.[cm]?[jt]s$/.test(path)) {
      add("error", "clean-build", path, "environment or test file shipped in the build");
      continue;
    }
    if (text === null) continue;
    const lower = text.toLowerCase();

    // --- URLs ---------------------------------------------------------------------------
    for (const match of text.matchAll(
      /(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d+)?(?:\/[^\s"'`)<>\\]*)?/gi,
    )) {
      let url = match[0];
      // Protocol-relative matches inside JS are mostly comments or regexes; only count them
      // where an HTML or CSS attribute would load them.
      if (url.startsWith("//")) {
        const before = text.slice(Math.max(0, match.index - 6), match.index);
        if (!/(src=|href=|url\()["']?$/.test(before)) continue;
        url = "https:" + url;
      }
      url = url.replace(/[.,;]+$/, "");
      urls.push({ url, file: path });

      if (url === POKI_SDK_URL) {
        sdkLoaderSeen = true;
        continue;
      }
      const inert = INERT_URLS.find((entry) => entry.pattern.test(url));
      if (inert) {
        add("info", "inert-url", path, `${url} — ${inert.reason}`, match.index, text);
        continue;
      }
      if (/^https?:\/\/[a-z0-9.-]*poki\.(com|dev|io)\//i.test(url)) {
        add(
          "error",
          "external-request",
          path,
          `Poki URL other than the documented SDK loader: ${url}`,
          match.index,
          text,
        );
        continue;
      }
      add(
        "error",
        "external-request",
        path,
        `external URL ${url} — Poki blocks external requests; bundle it`,
        match.index,
        text,
      );
    }

    for (const match of text.matchAll(
      /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/gi,
    )) {
      add("error", "debug-code", path, `development URL ${match[0]}`, match.index, text);
    }

    // --- HTML: external tags and outgoing links ------------------------------------------
    if (/\.html?$/.test(path)) {
      for (const match of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/gi)) {
        if (!match[1].startsWith("#")) {
          add(
            "error",
            "outgoing-link",
            path,
            `link to ${match[1]} — Poki: remove outgoing links`,
            match.index,
            text,
          );
        }
      }
      for (const match of text.matchAll(
        /<(script|link|img|iframe|audio|video|source)\b[^>]*\b(?:src|href)\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]*)/gi,
      )) {
        // Poki's HTML5 guide puts exactly this tag in <head>.
        if (match[1].toLowerCase() === "script" && match[2] === POKI_SDK_URL) continue;
        add(
          "error",
          "external-asset",
          path,
          `<${match[1]}> loads from another origin`,
          match.index,
          text,
        );
      }
      for (const match of text.matchAll(/<iframe\b/gi)) {
        add("error", "external-asset", path, "iframe in the game page", match.index, text);
      }
    }

    // --- CSS: external fonts and imports -------------------------------------------------
    for (const match of text.matchAll(/@import\s+(?:url\()?["']?(?:https?:)?\/\//gi)) {
      add("error", "external-asset", path, "CSS @import from another origin", match.index, text);
    }
    for (const token of [
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "use.typekit.net",
      "fonts.bunny.net",
    ]) {
      for (const index of allIndexes(lower, token)) {
        add(
          "error",
          "external-font",
          path,
          `web font service ${token} — bundle fonts into the build`,
          index,
          text,
        );
      }
    }

    // --- Ads, analytics, other portals ---------------------------------------------------
    for (const token of THIRD_PARTY_ADS) {
      for (const index of allIndexes(lower, token)) {
        add(
          "error",
          "third-party-ads",
          path,
          `${token} — only Poki's SDK may serve ads`,
          index,
          text,
        );
      }
    }
    for (const token of ANALYTICS) {
      for (const index of allIndexes(lower, token)) {
        add(
          "error",
          "analytics",
          path,
          `${token} — third-party analytics needs Poki's approval (GA cannot be approved)`,
          index,
          text,
        );
      }
    }
    for (const token of OTHER_PORTALS) {
      for (const index of allIndexes(lower, token)) {
        add(
          "error",
          "branding",
          path,
          `"${token}" — another portal or store in a Poki build`,
          index,
          text,
        );
      }
    }
    for (const index of allIndexes(text, "window.open(")) {
      add(
        "error",
        "outgoing-link",
        path,
        "window.open — use PokiSDK.openExternalLink for any external link",
        index,
        text,
      );
    }

    // --- Network APIs --------------------------------------------------------------------
    if (/\.[cm]?js$/.test(path)) {
      for (const { token, severity, note } of NETWORK_APIS) {
        const hits = allIndexes(text, token);
        if (hits.length > 0)
          add(severity, "network-api", path, `${token} ×${hits.length} — ${note}`, hits[0], text);
      }

      // --- Debug code ----------------------------------------------------------------------
      for (const index of allIndexes(text, "debugger")) {
        if (
          /\bdebugger\s*;?/.test(text.slice(index, index + 10)) &&
          !/[\w$."'`]/.test(text[index - 1] ?? "")
        ) {
          add("error", "debug-code", path, "debugger statement", index, text);
        }
      }
      for (const match of text.matchAll(/setDebug\(\s*(!0|true|1)\s*\)/g)) {
        add("error", "debug-code", path, "PokiSDK.setDebug(true) left on", match.index, text);
      }
      const logs = ["console.log", "console.info", "console.debug", "console.warn"]
        .map((call) => allIndexes(text, call).length)
        .reduce((a, b) => a + b, 0);
      if (logs > 0)
        add(
          "warning",
          "debug-code",
          path,
          `console.log/info/debug/warn ×${logs} — confirm none runs in normal play`,
        );
      const evals =
        allIndexes(text, "new Function").length + (text.match(/\beval\(/g) ?? []).length;
      if (evals > 0) {
        add(
          "warning",
          "csp",
          path,
          `dynamic code (new Function/eval) ×${evals} — breaks under a CSP without 'unsafe-eval'`,
        );
      }

      // --- SDK usage -----------------------------------------------------------------------
      for (const event of [
        "gameLoadingFinished",
        "gameplayStart",
        "gameplayStop",
        "commercialBreak",
        "rewardedBreak",
      ]) {
        if (text.includes(event)) sdkEvents.add(event);
      }
      if (/poki-sdk-core|poki-sdk-[a-z]+-[0-9a-f]{20,}/.test(text)) {
        add(
          "error",
          "sdk",
          path,
          "a copy of Poki's SDK core is bundled — load the documented loader instead",
        );
      }
    }
  }

  if (!sdkLoaderSeen) {
    add("error", "sdk", "(bundle)", `Poki SDK loader ${POKI_SDK_URL} is not referenced`);
  }
  for (const event of ["gameLoadingFinished", "gameplayStart", "gameplayStop", "commercialBreak"]) {
    if (!sdkEvents.has(event))
      add("error", "sdk", "(bundle)", `SDK call ${event} not found in the bundle`);
  }

  return { findings, urls, sdkEvents: [...sdkEvents].sort() };
}

const mb = (bytes) => Number((bytes / 1024 / 1024).toFixed(3));

/**
 * Size against Poki's figures, measured in bytes.
 *
 * "Initial" is deliberately conservative: index.html, everything it references, and every
 * code file (JS, CSS, wasm) in the build. Engines load code at boot through dynamic
 * import() — PixiJS picks its renderer that way — which the HTML never mentions, so
 * counting only what index.html references under-reports. Only other assets (images,
 * audio, data) count solely towards the total; a title that streams those later can argue
 * the difference, a code chunk cannot.
 */
export function auditSize(files) {
  const findings = [];
  const html = files.find((file) => /(^|\/)index\.html$/.test(file.path));
  const initial = new Set(html ? [html.path] : []);
  if (html?.text) {
    const base = html.path.slice(0, html.path.lastIndexOf("/") + 1);
    for (const match of html.text.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
      const ref = match[1];
      if (/^(?:[a-z]+:)?\/\//i.test(ref)) continue;
      const path = base + ref.replace(/^\.?\//, "");
      if (files.some((file) => file.path === path)) initial.add(path);
    }
  }
  for (const file of files) if (/\.(m?js|css|wasm)$/i.test(file.path)) initial.add(file.path);

  const bytesOf = (file) =>
    file.size ?? (file.text === null ? 0 : Buffer.byteLength(file.text, "utf8"));
  const sum = (list) => list.reduce((total, file) => total + bytesOf(file), 0);
  const initialMb = mb(sum(files.filter((file) => initial.has(file.path))));
  const totalMb = mb(sum(files));
  if (initialMb > MAX_INITIAL_MB) {
    findings.push({
      severity: "error",
      rule: "size",
      file: "(bundle)",
      message: `initial download ${initialMb} MB exceeds Poki's ${MAX_INITIAL_MB} MB`,
    });
  }
  if (totalMb > MAX_TOTAL_MB) {
    findings.push({
      severity: "error",
      rule: "size",
      file: "(bundle)",
      message: `total download ${totalMb} MB exceeds Poki's ${MAX_TOTAL_MB} MB`,
    });
  }
  return { findings, initialMb, totalMb, initialFiles: [...initial].sort() };
}

/**
 * Source rule: game code reaches storage only through @wgf/platform-sdk. Poki: "wrap
 * localStorage operations in a try/catch". The platform backend is the one place that
 * does, so any other direct use is a finding — try/catch or not, because it is the next
 * edit that forgets it.
 */
export function auditSource(files) {
  const findings = [];
  const ALLOWED = /packages\/platform-sdk\/src\/storage\.ts$/;
  for (const { path, text } of files) {
    if (ALLOWED.test(path.replace(/\\/g, "/"))) continue;
    // Comments do not touch storage.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/.*$/gm, (m) => " ".repeat(m.length));
    for (const match of code.matchAll(
      /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/g,
    )) {
      findings.push({
        severity: "error",
        rule: "unsafe-storage",
        file: path,
        line: lineOf(code, match.index),
        excerpt: excerpt(text, match.index, match[0].length),
        message: `${match[1]} used directly — go through Platform.storage, which survives private browsing`,
      });
    }
    if (/packages\/platform-sdk\/src\/adapters\/poki\.ts$/.test(path.replace(/\\/g, "/"))) continue;
    for (const match of code.matchAll(/\bPokiSDK\b/g)) {
      findings.push({
        severity: "error",
        rule: "architecture",
        file: path,
        line: lineOf(code, match.index),
        message: "PokiSDK referenced outside the Poki adapter — game code talks to Platform only",
      });
    }
  }
  return findings;
}

function readFiles(root, dir, { allText = false } = {}) {
  return walk(dir).map((full) => {
    const path = relative(root, full).replace(/\\/g, "/");
    const size = statSync(full).size;
    const text =
      allText || TEXT_EXTENSIONS.has(extname(full).toLowerCase())
        ? readFileSync(full, "utf8")
        : null;
    return { path, text, size };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  if (!args.dist || args.dist === true) {
    console.error("usage: poki-audit.mjs --dist <dir> [--src <dir,dir>] [--out <file>]");
    process.exit(2);
  }
  const dist = resolve(root, args.dist);
  if (!existsSync(dist)) {
    console.error(`no build at ${args.dist} — build it first`);
    process.exit(2);
  }

  const bundleFiles = readFiles(root, dist);
  const bundle = auditBundle(bundleFiles);

  const srcDirs =
    typeof args.src === "string"
      ? args.src.split(",")
      : ["examples/poki-compliance-demo/src", "packages", "src"];
  const sourceFiles = srcDirs
    .flatMap((dir) => readFiles(root, resolve(root, dir), { allText: true }))
    .filter(
      (file) =>
        /\.(ts|tsx|js|mjs)$/.test(file.path) &&
        !file.path.includes("/dist/") &&
        !file.path.includes("node_modules/"),
    );
  const source = auditSource(sourceFiles);

  const size = auditSize(bundleFiles);
  const sizeMb = size.totalMb;
  const findings = [...bundle.findings, ...source, ...size.findings];

  const count = (severity) => findings.filter((f) => f.severity === severity).length;
  const report = {
    tool: "scripts/verify/poki-audit.mjs",
    dist: relative(root, dist).replace(/\\/g, "/"),
    generated_at: new Date().toISOString(),
    size_mb: sizeMb,
    initial_mb: size.initialMb,
    initial_files: size.initialFiles,
    limits_mb: { initial: MAX_INITIAL_MB, total: MAX_TOTAL_MB },
    files: bundleFiles.length,
    sdk_events_referenced: bundle.sdkEvents,
    urls: bundle.urls,
    summary: { error: count("error"), warning: count("warning"), info: count("info") },
    status: count("error") === 0 ? "pass" : "fail",
    findings,
  };

  const out = resolve(root, typeof args.out === "string" ? args.out : "build/poki-audit.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

  for (const finding of findings) {
    const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.log(
      `${finding.severity.padEnd(7)} ${finding.rule.padEnd(17)} ${where}  ${finding.message}`,
    );
  }
  console.log(
    `\n${report.status.toUpperCase()} — ${report.summary.error} error(s), ${report.summary.warning} warning(s), ` +
      `${report.summary.info} info · ${sizeMb} MB in ${bundleFiles.length} files · report: ${relative(root, out)}`,
  );
  process.exit(report.status === "pass" ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) main();
