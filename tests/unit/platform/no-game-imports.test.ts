// Fresh games must not depend on the template's scaffold scene.
//
// A game replaces src/game/boot-scene.ts and src/game/index.ts. If any template test, harness
// or template-owned source imported them, deleting BootScene would break the typecheck of
// tests the game inherits and never touches — so the first thing every generated game did
// would be to fail CI. Only game code under src/game/ (index.ts builds it) may name BootScene.

import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (/\.(ts|mts|mjs|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const IMPORTS_BOOT_SCENE =
  /from\s+["'][^"']*game\/boot-scene(\.js)?["']|import\(["'][^"']*boot-scene/;

describe("BootScene is replaceable", () => {
  it("no test file imports src/game/boot-scene", () => {
    const offenders = sources("tests").filter((file) =>
      IMPORTS_BOOT_SCENE.test(readFileSync(join(root, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("nothing in src/ but the game-owned src/game/index.ts imports it", () => {
    const offenders = sources("src")
      .map((file) => file.split(sep).join("/"))
      .filter((file) => file !== "src/game/index.ts" && !file.startsWith("src/game/"))
      .filter((file) => IMPORTS_BOOT_SCENE.test(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("main.ts reaches the game only through createGame", () => {
    const main = readFileSync(join(root, "src/main.ts"), "utf8");
    const gameImports = [...main.matchAll(/from\s+"\.\/game\/([^"]+)"/g)].map((m) => m[1]);
    for (const imported of gameImports) expect(["index.js", "context.js"]).toContain(imported);
  });
});
