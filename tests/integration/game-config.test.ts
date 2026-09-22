// The shipped game.config.yaml has to survive its own validator.
//
// This is an integration test rather than a unit test because it reads the real file. A
// game repository inherits it, and the Factory overwrites it at scaffolding — if the two
// ever disagree about the shape, this fails before a build does.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateGameConfig } from "../../src/core/game-config.js";

const ROOT = resolve(import.meta.dirname, "../..");
const raw = parse(readFileSync(resolve(ROOT, "game.config.yaml"), "utf8")) as unknown;

describe("game.config.yaml", () => {
  it("validates", () => {
    expect(() => validateGameConfig(raw)).not.toThrow();
  });

  it("names an engine the template implements", () => {
    const config = validateGameConfig(raw);
    expect(["pixijs", "threejs"]).toContain(config.engine.type);
  });

  it("declares at least one required platform", () => {
    const config = validateGameConfig(raw);
    expect(config.platforms.some((entry) => entry.role === "required")).toBe(true);
  });

  it("agrees with the build command the Factory expects", () => {
    const config = validateGameConfig(raw);
    expect(config.build.command).toBe("pnpm build");
    expect(config.build.output).toBe("dist");
  });
});

describe("validateGameConfig", () => {
  const valid = {
    game: { id: "g", name: "G", version: "0.1.0" },
    engine: { type: "pixijs" },
    platforms: [{ id: "generic-web", profile: "generic-web@1.0.0", role: "required" }],
    build: { command: "pnpm build", output: "dist" },
    verification: {},
    publishing: { enabled: false },
  };

  it("rejects a bare string platform", () => {
    expect(() => validateGameConfig({ ...valid, platforms: ["yandex"] })).toThrow(/pinned object/);
  });

  it("rejects an unpinned profile", () => {
    const platforms = [{ id: "yandex", profile: "yandex", role: "required" }];
    expect(() => validateGameConfig({ ...valid, platforms })).toThrow(/<platform-id>@<version>/);
  });

  it("rejects a profile that names a different platform than its id", () => {
    const platforms = [{ id: "yandex", profile: "poki@1.0.0", role: "required" }];
    expect(() => validateGameConfig({ ...valid, platforms })).toThrow(/does not match id/);
  });

  it("rejects an unknown engine", () => {
    expect(() => validateGameConfig({ ...valid, engine: { type: "godot" } })).toThrow(
      /engine\.type/,
    );
  });

  it("rejects an empty platform list", () => {
    expect(() => validateGameConfig({ ...valid, platforms: [] })).toThrow(/non-empty/);
  });

  it("rejects a role that is neither required nor optional", () => {
    const platforms = [{ id: "poki", profile: "poki@1.0.0", role: "maybe" }];
    expect(() => validateGameConfig({ ...valid, platforms })).toThrow(/role must be/);
  });
});
