#!/usr/bin/env node
// Evaluate every requirement in compliance/requirements.mjs against what was measured, and
// write the submission report.
//
// Inputs (all under build/gamevui-demo/ at the repository root):
//   static-audit.json   scripts/audit.mjs
//   package-facts.json  scripts/package-submission.mjs
//   e2e-results.json    playwright test (JSON reporter)
//
// Outputs:
//   build/gamevui-demo/compliance-results.json
//   release/gamevui/submission-report.md
//
// Exit code 1 if any requirement FAILED or an automated one was NOT_RUN. UNKNOWN, MANUAL
// and NOT_APPLICABLE never fail the run and never count as passing — the report says which
// is which, and the final status says what that adds up to.
//
// Usage: node scripts/check-compliance.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REQUIREMENTS, resolveStatus } from "../compliance/requirements.mjs";
import { EXAMPLE_ROOT, OUT_DIR, REPO_ROOT } from "./audit.mjs";

const PROBE_TAG = /\[probe:([a-z0-9_]+)\]/g;

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** Every test in a Playwright JSON report, flattened across nested suites. */
export function flattenReport(report) {
  const out = [];
  const visit = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        out.push({
          title: [...titles, spec.title].filter(Boolean).join(" › "),
          project: test.projectName,
          status: results.at(-1)?.status ?? "not-run",
          annotations: [
            ...(test.annotations ?? []),
            ...results.flatMap((result) => result.annotations ?? []),
          ],
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
  };
  for (const suite of report?.suites ?? []) visit(suite, []);
  return out;
}

/**
 * e2e probes. A probe passes only if at least one test carrying it passed and none failed;
 * skipped tests (a desktop-only check on a phone project) count for neither.
 */
export function e2eProbes(tests) {
  const probes = {};
  const measures = {};
  for (const test of tests) {
    for (const [, name] of test.title.matchAll(PROBE_TAG)) {
      const key = `e2e.${name}`;
      const entry = (probes[key] ??= { passed: [], failed: [] });
      if (test.status === "passed") entry.passed.push(test.project);
      else if (test.status !== "skipped") entry.failed.push(`${test.project} (${test.status})`);
    }
    for (const annotation of test.annotations) {
      if (!annotation.type.startsWith("measure:")) continue;
      const key = `e2e.${annotation.type.slice("measure:".length)}`;
      (measures[key] ??= {})[test.project] = Number(annotation.description);
    }
  }
  const checks = Object.fromEntries(
    Object.entries(probes).map(([key, { passed, failed }]) => [
      key,
      {
        ok: passed.length > 0 && failed.length === 0,
        detail: failed.length
          ? `failed in ${failed.join(", ")}`
          : `passed in ${passed.join(", ") || "no project"}`,
      },
    ]),
  );
  return { checks, measures };
}

export function evaluate({ staticAudit, packageFacts, e2eReport }) {
  const tests = e2eReport ? flattenReport(e2eReport) : [];
  const e2e = e2eProbes(tests);
  const probes = { ...(staticAudit?.checks ?? {}), ...(packageFacts?.checks ?? {}), ...e2e.checks };
  const measures = {
    ...(staticAudit?.measures ?? {}),
    ...(packageFacts?.measures ?? {}),
    ...e2e.measures,
  };

  const results = REQUIREMENTS.map((requirement) => {
    const status = resolveStatus(requirement, probes);
    const names = requirement.check.kind === "auto" ? requirement.check.probes : [];
    const measured = (requirement.check.measures ?? [])
      .filter((name) => measures[name] !== undefined)
      .map((name) => ({ name, value: measures[name] }));
    return {
      id: requirement.id,
      category: requirement.category,
      requirement: requirement.requirement,
      basis: requirement.basis,
      evidence: requirement.evidence,
      status,
      probes: names.map((name) => ({ name, ...(probes[name] ?? { ok: null, detail: "not run" }) })),
      measured,
      instruction: requirement.check.instruction ?? null,
      note: requirement.note ?? null,
    };
  });

  const count = (status) => results.filter((result) => result.status === status).length;
  const summary = {
    total: results.length,
    PASSED: count("PASSED"),
    FAILED: count("FAILED"),
    NOT_RUN: count("NOT_RUN"),
    MANUAL_REQUIRED: count("MANUAL_REQUIRED"),
    NOT_APPLICABLE: count("NOT_APPLICABLE"),
    UNKNOWN: count("UNKNOWN"),
    e2e_tests: {
      total: tests.length,
      passed: tests.filter((test) => test.status === "passed").length,
      failed: tests.filter((test) => !["passed", "skipped"].includes(test.status)).length,
      skipped: tests.filter((test) => test.status === "skipped").length,
    },
  };
  return { summary, finalStatus: finalStatus(summary), results, measures };
}

/**
 * The report's verdict, from the vocabulary in the task:
 *   NOT_READY                          something automated failed or did not run
 *   INSUFFICIENT_OFFICIAL_DOCUMENTATION everything local passed, but the submission format
 *                                      itself is undocumented — which, for GameVui, it is
 *   READY_WITH_MANUAL_CHECKS           local checks pass, documentation suffices, manual left
 *   READY_FOR_PLATFORM_SUBMISSION      nothing left at all
 */
export function finalStatus(summary) {
  if (summary.FAILED > 0 || summary.NOT_RUN > 0) return "NOT_READY";
  if (summary.UNKNOWN > 0) return "INSUFFICIENT_OFFICIAL_DOCUMENTATION";
  if (summary.MANUAL_REQUIRED > 0) return "READY_WITH_MANUAL_CHECKS";
  return "READY_FOR_PLATFORM_SUBMISSION";
}

function formatMeasure(value) {
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "path" in value)
    return `${value.path} (${value.bytes} B)`;
  return Object.entries(value ?? {})
    .map(([project, v]) => `${project}: ${v}`)
    .join(", ");
}

const cell = (text) =>
  String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

export function renderReport(evaluation, metadata, manifest) {
  const { summary, results } = evaluation;
  const lines = [];
  const push = (...rows) => lines.push(...rows);

  push(
    `# GameVui submission report — ${metadata.title.vi} (${metadata.title.en}) ${metadata.version}`,
    "",
    "Generated by `examples/gamevui-compliance-demo/scripts/check-compliance.mjs`. Deterministic: no",
    "timestamps; the same inputs give the same file.",
    "",
    "**This package has not been submitted to, reviewed by or approved by GameVui.** Nothing in",
    "this repository sends anything to GameVui.",
    "",
    `## Final status: \`${evaluation.finalStatus}\``,
    "",
    "| PASSED | FAILED | NOT_RUN | MANUAL_REQUIRED | NOT_APPLICABLE | UNKNOWN |",
    "| ------ | ------ | ------- | --------------- | -------------- | ------- |",
    `| ${summary.PASSED} | ${summary.FAILED} | ${summary.NOT_RUN} | ${summary.MANUAL_REQUIRED} | ${summary.NOT_APPLICABLE} | ${summary.UNKNOWN} |`,
    "",
    `End-to-end tests: ${summary.e2e_tests.passed} passed, ${summary.e2e_tests.failed} failed, ${summary.e2e_tests.skipped} skipped (of ${summary.e2e_tests.total}).`,
    "",
    "`UNKNOWN` means GameVui publishes nothing on the point. It is never counted as passing,",
    "whatever the demo measured. `PASSED` on an `INFERRED` requirement means the demo matches",
    "behaviour observed on gamevui.vn, not that it meets a published GameVui rule.",
    "",
    "## Package",
    "",
  );
  if (manifest) {
    push(
      `- \`${manifest.zip.file}\` — ${manifest.zip.bytes} bytes, sha256 \`${manifest.zip.sha256}\``,
      `- ${manifest.zip.entries.length} entries, \`index.html\` at the archive root`,
      "- `manifest/manifest.json`, `manifest/checksums.txt`",
      "- No `screenshots/` or `metadata/` folder: GameVui documents neither as required.",
    );
  } else {
    push("- Not built. Run `pnpm package:gamevui`.");
  }
  push("", "## Requirements", "");
  push(
    "| ID | Category | Requirement | Basis | Status | Evidence / result |",
    "| -- | -- | -- | -- | -- | -- |",
  );
  for (const r of results) {
    const detail = [
      ...r.probes.map((p) => `${p.name}: ${p.detail}`),
      ...r.measured.map((m) => `${m.name} = ${formatMeasure(m.value)}`),
      r.instruction ? `Manual: ${r.instruction}` : "",
      r.note ?? "",
    ]
      .filter(Boolean)
      .join("; ");
    push(
      `| ${r.id} | ${r.category} | ${cell(r.requirement)} | ${r.basis} | **${r.status}** | ${cell(detail)} |`,
    );
  }

  push(
    "",
    "## Manual checks before sending",
    "",
    ...results
      .filter((r) => r.status === "MANUAL_REQUIRED")
      .map((r) => `- [ ] **${r.id}** — ${r.instruction}`),
    "",
    "## Cover email draft",
    "",
    "GameVui publishes no submission form fields. This is what a GameVui game page shows",
    "(observed), written out so the operator has it. Email it to `dichvu@meta.vn` with the zip",
    "attached or linked — the contact form at https://gamevui.vn/support/contact has no file",
    "upload.",
    "",
    "```text",
    `Tiêu đề: Đề xuất game HTML5 — ${metadata.title.vi} (${metadata.title.en})`,
    "",
    `Tên game: ${metadata.title.vi} (${metadata.title.en})`,
    `Phiên bản: ${metadata.version}`,
    `Mô tả: ${metadata.description.vi}`,
    `Cách chơi — máy tính: ${metadata.controls.desktop.vi}`,
    `Cách chơi — điện thoại: ${metadata.controls.mobile.vi}`,
    `Hướng màn hình: ${metadata.orientation.join(", ")}`,
    `Độ tuổi đề xuất: ${metadata.proposed_age_rating}`,
    `Tệp: ${manifest ? manifest.zip.file.replace(/^build\//, "") : "(chưa đóng gói)"} — trang chính index.html ở gốc tệp nén`,
    manifest ? `SHA-256: ${manifest.zip.sha256}` : "",
    "Nội dung: không bạo lực, không cờ bạc, không nội dung người lớn, không rượu bia/ma túy,",
    "không bản đồ, không vật phẩm ảo, không mua trong game, không quảng cáo, không thu thập",
    "dữ liệu cá nhân, không gửi yêu cầu mạng ra ngoài gói.",
    `Nhà phát triển: ${metadata.developer.name ?? "<ĐIỀN TÊN>"} — ${metadata.developer.email ?? "<ĐIỀN EMAIL>"}`,
    "",
    "Xin cho biết:",
    "1. Định dạng và dung lượng tối đa khi gửi game (tệp đính kèm hay đường dẫn tải về)?",
    "2. Yêu cầu kỹ thuật (trình duyệt, kích thước, hướng màn hình, tên tệp chính)?",
    "3. GameVui có chèn score.min.js / quảng cáo / menu vào bản build không (thay thẻ",
    "   viewport, toàn màn hình khi chạm lần đầu, quảng cáo mở đầu)?",
    "4. Nhà phát triển bên ngoài có được dùng GV.saveScore / GVAdBreak không, với điều kiện gì?",
    "5. Thông tin cần cho hồ sơ thông báo phát hành G2–G4, và ai xếp loại độ tuổi?",
    "6. Điều khoản cấp phép và chia sẻ doanh thu (nếu có)?",
    "",
    "---",
    "",
    `Game: ${metadata.title.en} — ${metadata.description.en}`,
    `Controls: computer — ${metadata.controls.desktop.en}; phone — ${metadata.controls.mobile.en}`,
    "Questions: (1) accepted format and size — attachment or download link; (2) technical",
    "requirements; (3) will GameVui add score.min.js, ads or its menu to the build (viewport",
    "override, fullscreen on first tap, preroll ad); (4) may third-party games use",
    "GV.saveScore / GVAdBreak, and on what terms; (5) what the G2–G4 release notification",
    "needs from us, and who assigns the age rating; (6) licence and revenue terms, if any.",
    "```",
    "",
  );
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}

function main() {
  const staticAudit = readJson(resolve(OUT_DIR, "static-audit.json"));
  const packageFacts = readJson(resolve(OUT_DIR, "package-facts.json"));
  const e2eReport = readJson(resolve(OUT_DIR, "e2e-results.json"));
  const manifest = readJson(resolve(REPO_ROOT, "release/gamevui/manifest/manifest.json"));
  const metadata = JSON.parse(
    readFileSync(resolve(EXAMPLE_ROOT, "gamevui.submission.json"), "utf8"),
  );

  for (const [name, value] of Object.entries({ staticAudit, packageFacts, e2eReport })) {
    if (!value) console.warn(`missing ${name} — its checks will report NOT_RUN`);
  }

  const evaluation = evaluate({ staticAudit, packageFacts, e2eReport });
  const resultsPath = resolve(OUT_DIR, "compliance-results.json");
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify(evaluation, null, 2) + "\n");

  const reportPath = resolve(REPO_ROOT, "release/gamevui/submission-report.md");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderReport(evaluation, metadata, manifest));

  for (const r of evaluation.results)
    console.log(`${r.status.padEnd(15)} ${r.id.padEnd(10)} ${r.basis.padEnd(8)} ${r.requirement}`);
  console.log(`\n${JSON.stringify(evaluation.summary)}`);
  console.log(`final status: ${evaluation.finalStatus}`);
  console.log(`wrote ${relative(REPO_ROOT, resultsPath)}, ${relative(REPO_ROOT, reportPath)}`);
  if (evaluation.summary.FAILED > 0 || evaluation.summary.NOT_RUN > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
