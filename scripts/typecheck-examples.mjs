// Type-checks every example against its own tsconfig.json.
//
// The root tsconfig covers the template only, so a game created by the Factory — a checkout
// with no examples/ at all — type-checks without them. Examples are checked here instead,
// one `tsc -b --force` per examples/<name>/tsconfig.json. No examples/, or none with a
// tsconfig.json, is not an error: there is simply nothing to check.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const examplesDir = join(root, "examples");

const projects = existsSync(examplesDir)
  ? readdirSync(examplesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join("examples", entry.name))
      .filter((dir) => existsSync(join(root, dir, "tsconfig.json")))
      .sort()
  : [];

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const failed = [];
for (const project of projects) {
  console.log(`tsc -b ${project} --force`);
  const result = spawnSync(process.execPath, [tsc, "-b", project, "--force"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) failed.push(project);
}

if (failed.length > 0) {
  console.error(`typecheck failed: ${failed.join(", ")}`);
  process.exit(1);
}
