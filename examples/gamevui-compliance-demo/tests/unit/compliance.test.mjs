// The compliance machinery itself: the rules that keep the report honest.

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  BASES,
  OFFICIAL_AGE_RATINGS,
  REQUIREMENTS,
  resolveStatus,
} from "../../compliance/requirements.mjs";
import { FORBIDDEN_REFERENCES, audit, rootRelativeUrls } from "../../scripts/audit.mjs";
import { e2eProbes, evaluate, finalStatus, renderReport } from "../../scripts/check-compliance.mjs";
import { buildPackage } from "../../scripts/package-submission.mjs";

const metadata = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../gamevui.submission.json"), "utf8"),
);

const REQUIRED_CATEGORIES = [
  "Technical",
  "Gameplay",
  "UX",
  "Content",
  "Performance",
  "Mobile",
  "Desktop",
  "Ads",
  "Monetization",
  "Metadata",
  "Submission",
  "Copyright",
  "Privacy",
];

const everythingPasses = new Proxy({}, { get: () => ({ ok: true, detail: "" }) });

describe("requirements registry", () => {
  it("has unique ids and a known basis", () => {
    const ids = REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REQUIREMENTS) expect(BASES).toContain(r.basis);
  });

  it("covers every category the report needs", () => {
    const categories = new Set(REQUIREMENTS.map((r) => r.category));
    for (const category of REQUIRED_CATEGORIES) expect(categories).toContain(category);
  });

  it("cites gamevui.vn for every OFFICIAL requirement", () => {
    for (const r of REQUIREMENTS.filter((r) => r.basis === "OFFICIAL")) {
      expect(r.evidence, r.id).toMatch(/https:\/\/gamevui\.vn\/support\//);
    }
  });

  it("uses measure checks only for UNKNOWN requirements", () => {
    for (const r of REQUIREMENTS.filter((r) => r.check.kind === "measure")) {
      expect(r.basis, r.id).toBe("UNKNOWN");
    }
  });

  it("never turns UNKNOWN into PASSED, even when every probe passes", () => {
    for (const r of REQUIREMENTS.filter((r) => r.basis === "UNKNOWN")) {
      expect(resolveStatus(r, everythingPasses), r.id).toBe("UNKNOWN");
    }
  });

  it("reports a missing probe as NOT_RUN, not PASSED", () => {
    const auto = REQUIREMENTS.find((r) => r.check.kind === "auto");
    expect(resolveStatus(auto, {})).toBe("NOT_RUN");
  });

  it("fails when any one probe of a requirement fails", () => {
    const auto = REQUIREMENTS.find((r) => r.check.kind === "auto" && r.check.probes.length > 1);
    const probes = Object.fromEntries(auto.check.probes.map((name, i) => [name, { ok: i !== 0 }]));
    expect(resolveStatus(auto, probes)).toBe("FAILED");
  });

  it("uses GameVui's four official age ratings", () => {
    expect(OFFICIAL_AGE_RATINGS).toEqual(["00+", "12+", "16+", "18+"]);
  });
});

describe("final status", () => {
  const base = { FAILED: 0, NOT_RUN: 0, UNKNOWN: 0, MANUAL_REQUIRED: 0 };
  it("is NOT_READY on any failure or missing run", () => {
    expect(finalStatus({ ...base, FAILED: 1 })).toBe("NOT_READY");
    expect(finalStatus({ ...base, NOT_RUN: 1 })).toBe("NOT_READY");
  });
  it("is INSUFFICIENT_OFFICIAL_DOCUMENTATION while anything is UNKNOWN", () => {
    expect(finalStatus({ ...base, UNKNOWN: 1, MANUAL_REQUIRED: 3 })).toBe(
      "INSUFFICIENT_OFFICIAL_DOCUMENTATION",
    );
  });
  it("is READY_WITH_MANUAL_CHECKS when only manual checks remain", () => {
    expect(finalStatus({ ...base, MANUAL_REQUIRED: 2 })).toBe("READY_WITH_MANUAL_CHECKS");
  });
});

describe("e2e probe aggregation", () => {
  const test = (title, project, status) => ({ title, project, status, annotations: [] });

  it("passes a probe only when it passed somewhere and failed nowhere", () => {
    const { checks } = e2eProbes([
      test("[probe:a] x", "desktop", "passed"),
      test("[probe:a] x", "mobile", "skipped"),
      test("[probe:b] y", "desktop", "passed"),
      test("[probe:b] y", "mobile", "failed"),
      test("[probe:c] z", "desktop", "skipped"),
    ]);
    expect(checks["e2e.a"].ok).toBe(true);
    expect(checks["e2e.b"].ok).toBe(false);
    expect(checks["e2e.c"].ok).toBe(false);
  });

  it("collects measures per project", () => {
    const { measures } = e2eProbes([
      {
        title: "[probe:fps] f",
        project: "desktop",
        status: "passed",
        annotations: [{ type: "measure:fps", description: "58.5" }],
      },
    ]);
    expect(measures["e2e.fps"]).toEqual({ desktop: 58.5 });
  });
});

function fixtureDist() {
  const dir = mkdtempSync(join(tmpdir(), "gv-dist-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "locales"));
  writeFileSync(join(dir, "index.html"), '<script type="module" src="./assets/index.js"></script>');
  writeFileSync(join(dir, "assets/index.js"), "console.log(1)");
  for (const locale of ["vi", "en"]) {
    writeFileSync(
      join(dir, `locales/${locale}.json`),
      JSON.stringify({ "controls.desktop": "d", "controls.mobile": "m" }),
    );
  }
  return dir;
}

describe("static audit", () => {
  it("flags root-relative and absolute URLs", () => {
    expect(rootRelativeUrls('<script src="/assets/a.js"></script><link href="./b.css">')).toEqual([
      "/assets/a.js",
    ]);
    expect(rootRelativeUrls('<script src="https://cdn.example/x.js"></script>')).toEqual([
      "https://cdn.example/x.js",
    ]);
  });

  it("passes a clean build", () => {
    const { checks } = audit({ distDir: fixtureDist(), metadata });
    for (const [name, check] of Object.entries(checks)) expect(check.ok, name).toBe(true);
  });

  it("catches an undocumented GameVui global in the bundle", () => {
    const dist = fixtureDist();
    writeFileSync(
      join(dist, "assets/index.js"),
      "window.GameVuiTool&&window.GameVuiTool.sendScore(1)",
    );
    expect(audit({ distDir: dist, metadata }).checks["static.no_portal_globals"].ok).toBe(false);
    expect(FORBIDDEN_REFERENCES).toContain("GVAdBreak");
  });

  it("catches a binary asset", () => {
    const dist = fixtureDist();
    writeFileSync(join(dist, "assets/sprite.png"), Buffer.from([0x89, 0x50]));
    expect(audit({ distDir: dist, metadata }).checks["static.asset_inventory"].ok).toBe(false);
  });

  it("rejects an age rating GameVui does not use", () => {
    const { checks } = audit({
      distDir: fixtureDist(),
      metadata: { ...metadata, proposed_age_rating: "PEGI 3" },
    });
    expect(checks["static.age_rating_valid"].ok).toBe(false);
  });
});

describe("submission package", () => {
  it("is byte-identical across runs and has index.html at the root", () => {
    const dist = fixtureDist();
    const outA = mkdtempSync(join(tmpdir(), "gv-out-"));
    const outB = mkdtempSync(join(tmpdir(), "gv-out-"));
    const a = buildPackage({ distDir: dist, outDir: outA, metadata });
    const b = buildPackage({ distDir: dist, outDir: outB, metadata });

    const zipA = readFileSync(join(outA, a.manifest.zip.file));
    const zipB = readFileSync(join(outB, b.manifest.zip.file));
    expect(zipA.equals(zipB)).toBe(true);
    expect(readFileSync(join(outA, "manifest/manifest.json"), "utf8")).toBe(
      readFileSync(join(outB, "manifest/manifest.json"), "utf8"),
    );
    expect(a.checks["package.index_at_root"].ok).toBe(true);
    expect(a.checks["package.deterministic_layout"].ok).toBe(true);
    expect(a.checks["package.entry_modes"].ok).toBe(true);
    // Info-ZIP applies the high word as Unix permissions on extraction.
    for (const entry of new AdmZip(zipA).getEntries()) {
      expect((entry.attr >>> 16).toString(8), entry.entryName).toBe("100644");
    }

    const names = new AdmZip(zipA).getEntries().map((entry) => entry.entryName);
    expect(names).toContain("index.html");
    expect(names.some((name) => name.startsWith("dist/"))).toBe(false);
  });

  it("does not package screenshots or metadata folders GameVui never asked for", () => {
    const out = mkdtempSync(join(tmpdir(), "gv-out-"));
    buildPackage({ distDir: fixtureDist(), outDir: out, metadata });
    const top = new Set(readdirSync(out));
    expect(top).toEqual(new Set(["build", "manifest"]));
  });
});

describe("submission report", () => {
  it("never claims approval and is deterministic", () => {
    const evaluation = evaluate({ staticAudit: null, packageFacts: null, e2eReport: null });
    const first = renderReport(evaluation, metadata, null);
    const second = renderReport(evaluation, metadata, null);
    expect(first).toBe(second);
    expect(first).toContain("has not been submitted to, reviewed by or approved by GameVui");
    expect(first).not.toMatch(/GameVui[- ]approved/i);
    expect(evaluation.finalStatus).toBe("NOT_READY");
  });
});
