// Vitest projects.
//
// Unit and integration are separate projects rather than separate folders under one run so
// CI can require them independently — `ci_green` in the Factory's title machine names lint,
// typecheck, unit and integration as distinct things.
//
// The @wgf/* aliases point at package sources, not their dist. Tests should fail on the
// code as written, not on a stale build.

import { resolve } from "node:path";
import { defineWorkspace } from "vitest/config";

const packageAlias = (name: string): { find: string; replacement: string } => ({
  find: `@wgf/${name}`,
  replacement: resolve(import.meta.dirname, `packages/${name}/src/index.ts`),
});

const alias = [
  packageAlias("game-core"),
  packageAlias("platform-sdk"),
  packageAlias("analytics-sdk"),
];

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: "unit",
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    resolve: { alias },
    test: {
      name: "integration",
      include: ["tests/integration/**/*.test.ts"],
      environment: "node",
    },
  },
]);
