// Build examples/sdk-matrix once per (engine, platform) into examples/sdk-matrix/dist/<engine>-<platform>/.
//
// Every platform with an adapter, for both engines. The browser suite
// (playwright.sdk.config.ts) then serves examples/sdk-matrix/dist and plays each build
// against its portal's mock SDK. A platform added to the registry is added here, and to
// the matrix config, or the suite does not cover it.

import { build } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const ENGINES = ["pixijs", "threejs"];
export const PLATFORMS = ["generic-web", "yandex", "poki", "gamevui"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configFile = resolve(ROOT, "examples/sdk-matrix/vite.config.ts");

const only = process.argv.slice(2);
for (const engine of ENGINES) {
  for (const platform of PLATFORMS) {
    const name = `${engine}-${platform}`;
    if (only.length > 0 && !only.includes(name)) continue;
    process.env["SDK_MATRIX_ENGINE"] = engine;
    process.env["WGF_PLATFORM"] = platform;
    console.log(`sdk-matrix: building ${name}`);
    await build({ configFile, logLevel: "warn" });
  }
}
