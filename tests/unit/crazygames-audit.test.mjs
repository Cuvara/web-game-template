import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  STATUS,
  auditDirectory,
  loadLimits,
  staticInitialFiles,
} from "../../scripts/crazygames-audit.mjs";

const limits = loadLimits();
const SDK = limits.sdk.url;
let dirs = [];

function build(files) {
  const dir = mkdtempSync(join(tmpdir(), "cg-audit-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const html = (body = "", head = `<script src="${SDK}"></script>`) =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width">${head}` +
  `<style>body{-webkit-user-select:none;user-select:none}</style>` +
  `<script type="module" src="./assets/index.js"></script></head><body>${body}</body></html>`;

const status = (audit, id) => audit.results.find((r) => r.id === id)?.status;

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("crazygames audit", () => {
  it("passes a clean build and never calls initial download a PASS", () => {
    const dir = build({
      "index.html": html(),
      "assets/index.js": 'import"./dep.js";',
      "assets/dep.js": "x",
    });
    const audit = auditDirectory(dir, { limits });
    expect(status(audit, "sdk_version")).toBe(STATUS.PASS);
    expect(status(audit, "total_size")).toBe(STATUS.PASS);
    expect(status(audit, "file_count")).toBe(STATUS.PASS);
    expect(status(audit, "relative_paths")).toBe(STATUS.PASS);
    expect(status(audit, "initial_download_static")).toBe(STATUS.APPROXIMATION);
    expect(status(audit, "initial_download_runtime")).toBe(STATUS.MANUAL);
    expect(status(audit, "qa_tool")).toBe(STATUS.MANUAL);
    expect(audit.results.some((r) => r.status === STATUS.FAIL)).toBe(false);
  });

  it("follows static imports but not dynamic ones", () => {
    const dir = build({
      "index.html": html(),
      "assets/index.js": 'import{a}from"./a.js";import("./lazy.js")',
      "assets/a.js": 'export*from"./b.js"',
      "assets/b.js": "",
      "assets/lazy.js": "",
    });
    expect(staticInitialFiles(dir, html())).toEqual([
      "assets/a.js",
      "assets/b.js",
      "assets/index.js",
      "index.html",
    ]);
  });

  it("fails absolute paths, which do not load on CrazyGames", () => {
    const page = html().replace("./assets/index.js", "/assets/index.js");
    const dir = build({ "index.html": page, "assets/index.js": "" });
    expect(status(auditDirectory(dir, { limits }), "relative_paths")).toBe(STATUS.FAIL);
  });

  it("fails the outdated v2 SDK", () => {
    const dir = build({
      "index.html": html(
        "",
        '<script src="https://sdk.crazygames.com/crazygames-sdk-v2.js"></script>',
      ),
      "assets/index.js": "",
    });
    expect(status(auditDirectory(dir, { limits }), "sdk_version")).toBe(STATUS.FAIL);
  });

  it("fails foreign scripts, other portals' SDKs, app store links, secrets and debugger", () => {
    const dir = build({
      "index.html": html(
        "",
        `<script src="${SDK}"></script><script src="https://cdn.example.com/x.js"></script>`,
      ),
      "assets/index.js":
        'fetch("https://game-cdn.poki.com/sdk.js");location="https://play.google.com/store/apps/x";' +
        'const k="AKIAABCDEFGHIJKLMNOP";debugger;',
    });
    const audit = auditDirectory(dir, { limits });
    for (const id of [
      "external_scripts",
      "unexpected_dependencies",
      "cross_promotion_app_store",
      "secrets",
      "debug_code",
    ]) {
      expect(status(audit, id), id).toBe(STATUS.FAIL);
    }
  });

  it("applies the 50 MB total limit when the SDK is not integrated", () => {
    const dir = build({ "index.html": html("", ""), "assets/index.js": "" });
    const audit = auditDirectory(dir, { limits });
    expect(status(audit, "sdk_version")).toBe(STATUS.WARN);
    expect(audit.results.find((r) => r.id === "total_size").limit).toBe(
      limits.limits.total_size_without_sdk_bytes.value,
    );
  });

  it("fails the file count above the official limit", () => {
    const files = { "index.html": html(), "assets/index.js": "" };
    for (let i = 0; i < limits.limits.file_count.value; i++) files[`a/${i}.txt`] = "";
    expect(status(auditDirectory(build(files), { limits }), "file_count")).toBe(STATUS.FAIL);
  });

  it("flags fullscreen calls and outbound links for a person to review", () => {
    const dir = build({
      "index.html": html(),
      "assets/index.js": 'el.requestFullscreen();window.open("https://example.com")',
    });
    const audit = auditDirectory(dir, { limits });
    expect(status(audit, "fullscreen_api")).toBe(STATUS.MANUAL);
    expect(status(audit, "external_links")).toBe(STATUS.MANUAL);
    expect(status(audit, "external_urls")).toBe(STATUS.WARN);
  });

  it("uses a runtime measurement as an APPROXIMATION, and FAILs one over the limit", () => {
    const dir = build({ "index.html": html(), "assets/index.js": "" });
    const hash = createHash("sha256")
      .update(readFileSync(join(dir, "index.html")))
      .digest("hex");
    const ok = auditDirectory(dir, {
      limits,
      runtime: {
        initial_download_bytes: 1_000,
        index_html_sha256: hash,
        gameplay_start_ms: 100,
        method: "t",
        external_requests: [SDK],
      },
    });
    expect(status(ok, "initial_download_runtime")).toBe(STATUS.APPROXIMATION);
    expect(status(ok, "network_requests")).toBe(STATUS.PASS);
    const over = auditDirectory(dir, {
      limits,
      runtime: {
        initial_download_bytes: 60_000_000,
        index_html_sha256: hash,
        gameplay_start_ms: 100,
        method: "t",
        external_requests: ["https://evil.example/x"],
      },
    });
    expect(status(over, "initial_download_runtime")).toBe(STATUS.FAIL);
    expect(status(over, "network_requests")).toBe(STATUS.FAIL);
  });

  it("refuses a runtime measurement taken on a different build", () => {
    const dir = build({ "index.html": html(), "assets/index.js": "" });
    const audit = auditDirectory(dir, {
      limits,
      runtime: {
        initial_download_bytes: 1_000,
        index_html_sha256: "0".repeat(64),
        gameplay_start_ms: 1,
        method: "t",
      },
    });
    expect(status(audit, "initial_download_runtime")).toBe(STATUS.MANUAL);
    expect(status(audit, "network_requests")).toBe(STATUS.MANUAL);
  });

  it("treats a runtime measurement without a build hash as stale", () => {
    const dir = build({ "index.html": html(), "assets/index.js": "" });
    const audit = auditDirectory(dir, {
      limits,
      runtime: {
        initial_download_bytes: 1_000,
        gameplay_start_ms: 1,
        method: "t",
        external_requests: [],
      },
    });
    expect(status(audit, "initial_download_runtime")).toBe(STATUS.MANUAL);
  });

  it("reports a directory without index.html as not a build", () => {
    const audit = auditDirectory(build({ "facts.json": "{}" }), { limits });
    expect(audit.results).toEqual([expect.objectContaining({ status: STATUS.NA })]);
  });

  it("ties every limit to an official source and a retrieval date", () => {
    for (const [id, limit] of Object.entries(limits.limits)) {
      expect(limit.source, id).toMatch(/^https:\/\/docs\.crazygames\.com\//);
      expect(limit.retrieved, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["BASIC_LAUNCH", "FULL_LAUNCH"], id).toContain(limit.stage);
    }
  });
});
