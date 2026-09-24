// The CrazyGames SDK URL is written down in three places that cannot import one another:
// the adapter, the shared Vite plugin (runs before packages are built) and the audit's limits
// file (plain JSON). They must agree, or the build loads one script and the audit checks
// for another.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRAZYGAMES_SDK_URL } from "@wgf/platform-sdk";
import { describe, expect, it } from "vitest";

// Repo root: this suite lives in examples/crazygames-compliance-demo/tests/integration and
// compares the demo with files the template owns.
const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

describe("CrazyGames SDK URL", () => {
  it("is the same in the adapter, the Vite plugin, the limits file and the demo", () => {
    expect(read("scripts/build/game-config-plugin.ts")).toContain(`"${CRAZYGAMES_SDK_URL}"`);
    const limits = JSON.parse(read("config/platforms/crazygames-limits.json")) as {
      sdk: { url: string };
    };
    expect(limits.sdk.url).toBe(CRAZYGAMES_SDK_URL);
    expect(read("examples/crazygames-compliance-demo/index.html")).toContain(
      `<script src="${CRAZYGAMES_SDK_URL}"></script>`,
    );
  });

  it("is the v3 script the official docs name", () => {
    expect(CRAZYGAMES_SDK_URL).toBe("https://sdk.crazygames.com/crazygames-sdk-v3.js");
  });
});

describe("relative paths", () => {
  it("both vite configs build with base './'", () => {
    expect(read("vite.config.ts")).toMatch(/base:\s*"\.\/"/);
    expect(read("examples/crazygames-compliance-demo/vite.config.ts")).toMatch(/base:\s*"\.\/"/);
  });
});
