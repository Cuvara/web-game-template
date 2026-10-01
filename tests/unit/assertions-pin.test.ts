// Release validation must judge a build by the profile version the game pinned. These tests
// cover the check that the profile on disk IS that profile, and that the evaluator's
// failure modes are reported as findings or usage errors — never as a stack trace.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
// @ts-expect-error — plain ESM script without type declarations.
import { checkProfilePin } from "../../scripts/verify/evaluate-assertions.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(REPO, "scripts/verify/evaluate-assertions.mjs");
const PROFILE_BYTES = readFileSync(resolve(REPO, "config/platforms/generic-web.yaml"));
const PROFILE = parse(PROFILE_BYTES.toString("utf8")) as { id: string; version: string };
const HASH = "sha256:" + createHash("sha256").update(PROFILE_BYTES).digest("hex");

const gameConfig = (profile = "generic-web@1.0.0") => ({
  platforms: [{ id: "generic-web", profile, role: "required" }],
});
const pinned = (content_hash = HASH, version = "1.0.0") => ({
  profiles: [{ id: "generic-web", version, file: "generic-web.yaml", content_hash }],
});

interface PinResult {
  criterion_id: string;
  breached: boolean;
  severity: string;
  note: string;
}

const check = (overrides: Record<string, unknown> = {}): PinResult[] =>
  checkProfilePin({
    platformId: "generic-web",
    profile: PROFILE,
    profileBytes: PROFILE_BYTES,
    gameConfig: gameConfig(),
    pinned: pinned(),
    ...overrides,
  });

describe("checkProfilePin", () => {
  it("accepts the repository's own vendored generic-web profile", () => {
    expect(check()).toEqual([]);
  });

  it("breaches, blocking, when game.config.yaml pins another version", () => {
    const [result, ...rest] = check({ gameConfig: gameConfig("generic-web@2.0.0") });
    expect(rest).toEqual([]);
    expect(result).toMatchObject({
      criterion_id: "profile_pin",
      breached: true,
      severity: "blocking",
      measured: "1.0.0",
    });
    expect(result!.note).toMatch(/pins generic-web@2\.0\.0/);
  });

  it("breaches when the pin names a different profile id", () => {
    expect(check({ gameConfig: gameConfig("poki@1.0.0") })[0]).toMatchObject({
      criterion_id: "profile_pin",
      breached: true,
    });
  });

  it("breaches when the platform is not in game.config.yaml or is unpinned", () => {
    expect(check({ gameConfig: { platforms: [] } })[0]!.note).toMatch(/no entry/);
    expect(check({ gameConfig: gameConfig("generic-web") })[0]!.note).toMatch(/unpinned/);
  });

  it("breaches when the file does not hash to pinned.json's content_hash", () => {
    const edited = Buffer.concat([PROFILE_BYTES, Buffer.from("# local tweak\n")]);
    const [result] = check({ profileBytes: edited });
    expect(result).toMatchObject({
      criterion_id: "profile_content_hash",
      breached: true,
      severity: "blocking",
    });
  });

  it("treats a CRLF checkout of the same bytes as the pinned file", () => {
    const crlf = Buffer.from(PROFILE_BYTES.toString("utf8").replace(/\n/g, "\r\n"));
    expect(check({ profileBytes: crlf })).toEqual([]);
  });

  it("breaches when pinned.json records another version than the file", () => {
    expect(check({ pinned: pinned(HASH, "0.9.0") })[0]).toMatchObject({
      criterion_id: "profile_pin",
      breached: true,
    });
  });

  it("checks only the version when the profile is not vendored in pinned.json", () => {
    expect(check({ pinned: null })).toEqual([]);
    expect(check({ pinned: { profiles: [] } })).toEqual([]);
    expect(check({ pinned: null, gameConfig: gameConfig("generic-web@1.1.0") })).toHaveLength(1);
  });
});

describe("evaluate-assertions CLI", () => {
  it("names the missing profile file and exits 2 instead of throwing ENOENT", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--platform", "no-such-portal"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("config/platforms/no-such-portal.yaml");
    expect(run.stderr).not.toMatch(/ENOENT|\n\s+at /);
  });

  it("exits 2 with usage when --platform is missing", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/usage:/);
  });
});
