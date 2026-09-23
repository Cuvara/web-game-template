// Build for the Neon Drift Arena example.
//
// @wgf/* resolve to package sources (as in the vitest workspace and the other examples), so
// the demo always builds against the code as written rather than a stale dist/. The Three.js
// framework is aliased alongside game-core and platform-sdk because this is its first real
// consumer.
//
// base: "./" keeps every asset reference relative, so the built archive works from any path
// on a portal CDN — the same requirement the other example builds honour.

import { resolve } from "node:path";
import { defineConfig } from "vite";

const ROOT = import.meta.dirname;
const REPO = resolve(ROOT, "../..");

const packageAlias = (name: string): { find: string; replacement: string } => ({
  find: `@wgf/${name}`,
  replacement: resolve(REPO, `packages/${name}/src/index.ts`),
});

export default defineConfig({
  root: ROOT,
  base: "./",
  resolve: {
    alias: [
      packageAlias("game-core"),
      packageAlias("platform-sdk"),
      packageAlias("three-framework"),
    ],
  },
  build: {
    outDir: resolve(ROOT, "dist"),
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
  },
  server: { port: 5175, strictPort: true },
  preview: { port: 4175, strictPort: true },
});
