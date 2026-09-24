// release:manifest — an immutable manifest that pins a real commit and the game's version,
// valid against the Factory's release-manifest.schema.json.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM script without type declarations.
import { makeManifest, ManifestRefusal } from "../../scripts/release/make-manifest.mjs";
// @ts-expect-error — plain ESM script without type declarations.
import { packageRelease } from "../../scripts/release/package.mjs";
import { BASIC_DIST, type Fixture, makeFixture } from "./release-fixture.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const ENV = { GITHUB_SHA: SHA };

type Json = Record<string, unknown>;

const fixtures: Fixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.cleanup();
});

/** A fixture already packaged as release r1 (outside git, so the build names no commit). */
function packaged(options: Parameters<typeof makeFixture>[1] = {}): Fixture {
  const f = makeFixture([{ id: "poki", files: BASIC_DIST }], options);
  fixtures.push(f);
  packageRelease({ root: f.root, releaseId: "r1", env: {} });
  return f;
}

const make = (
  f: Fixture,
  args: Json = {},
  env: Json = ENV,
  now = new Date("2026-09-24T10:00:00Z"),
): { manifest: Json; status: string } =>
  makeManifest({ root: f.root, args: { release: "r1", version: "1.2.0", ...args }, env, now });

const manifestText = (f: Fixture): string =>
  readFileSync(join(f.root, "release/r1/manifest.json"), "utf8");

describe("release:manifest", () => {
  it("writes the template marker and only schema fields per package", () => {
    const f = packaged({
      packageJson: { name: "g", version: "3.0.0", wgf: { template: { version: "1.1.0" } } },
    });
    const { manifest, status } = make(f);
    expect(status).toBe("written");
    expect(manifest["commit_sha"]).toBe(SHA);
    expect(manifest["template"]).toEqual({
      repository: "Cuvara/web-game-template",
      version: "1.1.0",
      source: "package.json wgf.template",
    });
    const [pkg] = manifest["packages"] as Json[];
    expect(Object.keys(pkg!).sort()).toEqual(
      ["checksum", "content_digest", "filename", "files", "platform_id", "size_mb"].sort(),
    );
  });

  it("falls back to package.json version for the template version", () => {
    const f = packaged();
    expect(make(f).manifest["template"]).toMatchObject({
      version: "1.1.0",
      source: "package.json",
    });
  });

  it("re-running with the same inputs is a no-op, even at a later time", () => {
    const f = packaged();
    make(f);
    const before = manifestText(f);
    const again = make(f, {}, ENV, new Date("2026-10-01T00:00:00Z"));
    expect(again.status).toBe("unchanged");
    expect(manifestText(f)).toBe(before);
  });

  it("never overwrites an existing manifest with different content", () => {
    const f = packaged();
    make(f);
    const before = manifestText(f);
    expect(() => make(f, { state: "rc" })).toThrow(ManifestRefusal);
    expect(() => make(f, {}, { GITHUB_SHA: "f".repeat(40) })).toThrow(/immutable/);
    expect(manifestText(f)).toBe(before);
  });

  it("requires a real commit sha", () => {
    const f = packaged();
    // The fixture is not a git work tree, so without GITHUB_SHA there is nothing to pin.
    expect(() => make(f, {}, {})).toThrow(/no commit to pin/);
    expect(() => make(f, {}, { GITHUB_SHA: "unknown" })).toThrow(/not a full commit sha/);
    expect(existsSync(join(f.root, "release/r1/manifest.json"))).toBe(false);
  });

  it("requires --version to equal game.version", () => {
    const f = packaged();
    expect(() => make(f, { version: "9.9.9" })).toThrow(/not game\.version 1\.2\.0/);
  });

  it("refuses packages built from another commit than the release commit", () => {
    const f = packaged();
    const path = join(f.root, "release/r1/packages.json");
    const packages = JSON.parse(readFileSync(path, "utf8")) as Json[];
    (packages[0]!["build"] as Json)["commit_sha"] = "e".repeat(40);
    f.write("release/r1/packages.json", JSON.stringify(packages));
    expect(() => make(f)).toThrow(/was built from e{40}/);
  });
});

// --- Factory schema --------------------------------------------------------------------
//
// The schema lives in the sibling web-game-factory checkout, which CI does not have. Only
// this block is skipped without it. The validator below covers the draft 2020-12 keywords
// the release-manifest schema and its shared $defs use; an unsupported keyword fails loudly
// rather than passing silently.

const FACTORY = resolve(import.meta.dirname, "../../../web-game-factory");
const SCHEMA = [
  process.env["WGF_FACTORY_DIR"] && join(process.env["WGF_FACTORY_DIR"], "core/artifacts"),
  join(FACTORY, "core/artifacts"),
]
  .filter((dir): dir is string => Boolean(dir))
  .map((dir) => join(dir, "release-manifest.schema.json"))
  .find((path) => existsSync(path));

const KNOWN = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "x-wgf",
  "type",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "minimum",
  "pattern",
  "enum",
  "const",
  "default",
  "format",
]);

function validate(schemaPath: string, value: unknown): string[] {
  const errors: string[] = [];
  const load = (path: string): Json => JSON.parse(readFileSync(path, "utf8")) as Json;
  const resolveRef = (ref: string, base: string): { schema: Json; base: string } => {
    const [file, pointer = ""] = ref.split("#");
    const path = file ? resolve(dirname(base), file) : base;
    let node: unknown = load(path);
    for (const part of pointer.split("/").filter(Boolean)) node = (node as Json)[part];
    return { schema: node as Json, base: path };
  };
  const typeOf = (v: unknown): string =>
    v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  const check = (schema: Json, v: unknown, at: string, base: string): void => {
    for (const key of Object.keys(schema)) {
      if (!KNOWN.has(key)) errors.push(`${at}: validator does not support "${key}"`);
    }
    if (typeof schema["$ref"] === "string") {
      const target = resolveRef(schema["$ref"], base);
      check(target.schema, v, at, target.base);
    }
    if (schema["type"] !== undefined) {
      const types = ([] as string[]).concat(schema["type"] as string | string[]);
      const actual = typeOf(v);
      const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"));
      if (!ok) errors.push(`${at}: expected ${types.join("|")}, got ${actual}`);
    }
    if (schema["enum"] && !(schema["enum"] as unknown[]).includes(v)) {
      errors.push(`${at}: ${JSON.stringify(v)} not in enum`);
    }
    if ("const" in schema && schema["const"] !== v) errors.push(`${at}: not the const`);
    if (typeof schema["pattern"] === "string" && typeof v === "string") {
      if (!new RegExp(schema["pattern"], "u").test(v)) errors.push(`${at}: fails pattern`);
    }
    if (typeof schema["minimum"] === "number" && typeof v === "number" && v < schema["minimum"]) {
      errors.push(`${at}: below minimum`);
    }
    if (Array.isArray(v)) {
      if (typeof schema["minItems"] === "number" && v.length < schema["minItems"]) {
        errors.push(`${at}: fewer than ${schema["minItems"]} items`);
      }
      if (schema["items"])
        v.forEach((item, i) => check(schema["items"] as Json, item, `${at}[${i}]`, base));
    }
    if (typeOf(v) === "object") {
      const obj = v as Json;
      const props = (schema["properties"] ?? {}) as Json;
      for (const key of (schema["required"] ?? []) as string[]) {
        if (!(key in obj)) errors.push(`${at}: missing ${key}`);
      }
      for (const [key, child] of Object.entries(obj)) {
        if (key in props) check(props[key] as Json, child, `${at}.${key}`, base);
        else if (schema["additionalProperties"] === false) errors.push(`${at}: extra "${key}"`);
        else if (typeof schema["additionalProperties"] === "object") {
          check(schema["additionalProperties"] as Json, child, `${at}.${key}`, base);
        }
      }
    }
  };
  check(load(schemaPath), value, "$", schemaPath);
  return errors;
}

describe("release:manifest against the Factory schema", () => {
  it.skipIf(!SCHEMA)(
    "validates against web-game-factory/core/artifacts/release-manifest.schema.json " +
      "(skipped: sibling web-game-factory checkout not found; set WGF_FACTORY_DIR)",
    () => {
      const f = packaged({
        packageJson: { name: "g", version: "1.1.0", wgf: { template: { version: "1.1.0" } } },
      });
      const draft = make(f).manifest;
      expect(validate(SCHEMA!, draft)).toEqual([]);

      // An rc manifest (frozen) of a second release validates too.
      packageRelease({ root: f.root, releaseId: "r2", env: {} });
      const rc = makeManifest({
        root: f.root,
        args: { release: "r2", version: "1.2.0", state: "rc" },
        env: {
          ...ENV,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "o/r",
          GITHUB_RUN_ID: "7",
        },
        now: new Date("2026-09-24T10:00:00Z"),
      }) as { manifest: Json };
      expect(rc.manifest["frozen_at"]).toBe("2026-09-24T10:00:00.000Z");
      expect(validate(SCHEMA!, rc.manifest)).toEqual([]);
    },
  );

  it.skipIf(!SCHEMA)(
    "the validator itself rejects what the schema forbids (skipped: no schema)",
    () => {
      expect(validate(SCHEMA!, { template: { contract: "2" } })).toContain(
        '$.template: extra "contract"',
      );
    },
  );
});
