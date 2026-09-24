// `pnpm sdk:check` (scripts/sdk/check-integration.mjs) on fixture repositories.
//
// Each fixture is the template's own wiring files copied into a temp directory, then broken
// in one way. The check must pass the intact copy and name the broken file in every other.

import { spawnSync } from "node:child_process";
import process from "node:process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkIntegration } from "../../../scripts/sdk/check-integration.mjs";

const root = join(import.meta.dirname, "../../..");
const script = join(root, "scripts/sdk/check-integration.mjs");
const WIRING = [
  "src/main.ts",
  "src/platform/gameplay.ts",
  "src/platform/game-integration.ts",
  "src/platform/integration-plan.ts",
  "src/game/index.ts",
];

const fixtures = [];
function fixture(edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "wgf-sdk-check-"));
  fixtures.push(dir);
  for (const file of WIRING) {
    cpSync(join(root, file), join(dir, file), { recursive: true });
  }
  edit({
    read: (file) => readFileSync(join(dir, file), "utf8"),
    write: (file, text) => writeFileSync(join(dir, file), text),
    remove: (file) => rmSync(join(dir, file)),
  });
  return dir;
}

function run(dir) {
  const result = spawnSync(process.execPath, [script, "--root", dir], { encoding: "utf8" });
  return { status: result.status, report: JSON.parse(result.stdout) };
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check-integration", () => {
  it("passes the template's own wiring, exit 0", () => {
    const { status, report } = run(fixture());
    expect(report).toMatchObject({ ok: true, problems: [] });
    expect(status).toBe(0);
  });

  it("the repository itself is wired", () => {
    expect(checkIntegration(root).problems).toEqual([]);
  });

  it("fails with exit 1 and a JSON report when main.ts no longer boots through bootPlatform", () => {
    const dir = fixture(({ read, write }) =>
      write(
        "src/main.ts",
        read("src/main.ts").replace(/bootPlatform\(/g, "createPlatform(") +
          "\n// bootPlatform( in a comment does not count\n",
      ),
    );
    const { status, report } = run(dir);
    expect(status).toBe(1);
    expect(report.ok).toBe(false);
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining(["boot-platform", "boot-order", "no-registry-boot"]),
    );
    expect(report.problems.join("\n")).toContain("src/main.ts");
  });

  it("fails when gameplay is not installed or the game is not created through createGame", () => {
    const dir = fixture(({ read, write }) =>
      write(
        "src/main.ts",
        read("src/main.ts")
          .replace("installGameplay(", "(")
          .replace("await createGame(context)", "await Promise.resolve({})"),
      ),
    );
    const failed = checkIntegration(dir)
      .checks.filter((c) => !c.ok)
      .map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["gameplay-installed", "create-game"]));
  });

  it("fails when the game is created after ready", () => {
    const dir = fixture(({ read, write }) => {
      const main = read("src/main.ts").replace(
        "handle = await createGame(context);",
        "handle = {};",
      );
      write(
        "src/main.ts",
        main.replace(
          "await platform.signalReady();",
          "await platform.signalReady();\n  handle = await createGame(context);",
        ),
      );
    });
    const report = checkIntegration(dir);
    expect(report.checks.find((c) => c.id === "boot-order")?.ok).toBe(false);
  });

  it("fails when integration-plan.ts lacks export const INTEGRATION_PLAN", () => {
    const dir = fixture(({ read, write }) =>
      write(
        "src/platform/integration-plan.ts",
        read("src/platform/integration-plan.ts").replace(
          "export const INTEGRATION_PLAN",
          "const PLAN",
        ),
      ),
    );
    const report = checkIntegration(dir);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toContain("src/platform/integration-plan.ts");
  });

  it("fails when src/game/index.ts does not export createGame", () => {
    const dir = fixture(({ write }) =>
      write("src/game/index.ts", "async function createGame() { return {}; }\n"),
    );
    expect(checkIntegration(dir).problems.join("\n")).toContain("src/game/index.ts");
  });

  it("accepts createGame exported as a const or through an export list", () => {
    for (const source of [
      "export const createGame = async () => ({});\n",
      "async function createGame() { return {}; }\nexport { createGame };\n",
    ]) {
      const dir = fixture(({ write }) => write("src/game/index.ts", source));
      expect(checkIntegration(dir).ok).toBe(true);
    }
  });

  it("fails when src/platform/gameplay.ts is missing", () => {
    const dir = fixture(({ remove }) => remove("src/platform/gameplay.ts"));
    const { status, report } = run(dir);
    expect(status).toBe(1);
    expect(report.problems).toEqual([
      expect.stringContaining("src/platform/gameplay.ts is missing"),
    ]);
  });

  it("fails when src/main.ts is missing", () => {
    const dir = fixture(({ remove }) => remove("src/main.ts"));
    expect(checkIntegration(dir).problems).toEqual([expect.stringContaining("src/main.ts")]);
  });
});
