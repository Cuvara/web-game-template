// Small helpers shared by the scripts under scripts/.
//
// Kept dependency-free on purpose: these run in CI before anything is guaranteed to be
// installed beyond the workspace's own devDependencies.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runInThisContext } from "node:vm";
import { parse } from "yaml";

/** The template/game repository root. */
export function repoRoot() {
  return resolve(import.meta.dirname, "..");
}

/**
 * Parse `--key value` and `--flag` into an object. Deliberately tiny — these scripts have a
 * handful of options each and a CLI framework would be more code than the scripts.
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/** True when the module at `metaUrl` is the entry point, not an import. Windows-safe. */
export function isEntryPoint(metaUrl) {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(entry).href;
}

const rulesCache = new Map();

/**
 * src/core/game-config.ts — the validator, the portal id overrides and the target platform
 * rule the Vite plugin applies — loaded into plain Node. That file has no imports, so
 * TypeScript's own transpiler turns it into a module evaluated here; the scripts and the build
 * then share one copy of the rules rather than two that could drift. TypeScript is a
 * devDependency already, and is only loaded when a script asks for the config.
 */
export function gameConfigRules() {
  // The rules are the tooling's own, not data of the tree being read: a fixture root (tests
  // run the release scripts against temporary layouts) has no src/, and a game repository's
  // src/core is template-owned anyway. So the file comes from the repository these scripts
  // live in, whatever `root` the caller is looking at.
  const own = repoRoot();
  if (rulesCache.has(own)) return rulesCache.get(own);
  const ts = createRequire(import.meta.url)("typescript");
  const path = resolve(own, "src/core/game-config.ts");
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path,
  });
  const module = { exports: {} };
  runInThisContext(`(function (exports, module) {${outputText}\n})`, { filename: path })(
    module.exports,
    module,
  );
  rulesCache.set(own, module.exports);
  return module.exports;
}

/** The config file a run reads: WGF_GAME_CONFIG when set (as vite.config.ts), else the root's. */
export function gameConfigPath(root = repoRoot(), env = process.env) {
  return resolve(root, env["WGF_GAME_CONFIG"] || "game.config.yaml");
}

/**
 * game.config.yaml — or, when WGF_GAME_CONFIG is set, the config it names, the same override
 * vite.config.ts honours — validated by the rules the build applies, with the portal id
 * overrides (WGF_Y8_APP_ID, WGF_Y8_GAME_ID, WGF_GAMEMONETIZE_GAME_ID) applied. A build made
 * against another config (one per platform in the SDK smoke and the GameDistribution release
 * check) is then packaged and measured against that same config rather than the scaffold's.
 * Throws with the validator's message on a config the build would refuse.
 */
export function readGameConfig(root = repoRoot(), env = process.env) {
  const rules = gameConfigRules();
  const raw = parse(readFileSync(gameConfigPath(root, env), "utf8"));
  return rules.validateGameConfig(rules.applyPortalIdOverrides(raw, env));
}

/**
 * The platforms[] entry a build targets: WGF_TARGET_PLATFORM (which must name an entry),
 * else the first required entry, else the first. Same rule as the Vite plugin.
 */
export function targetPlatform(gameConfig, env = process.env) {
  return gameConfigRules().resolveTargetPlatform(gameConfig, env);
}

/**
 * What a build of `platformId` would be: `{ config, target, portalConfigured }`, or the error
 * the Vite plugin would fail the build with (a missing portal id, unless
 * WGF_ALLOW_UNCONFIGURED_PORTAL=1).
 */
export function resolvePlatformBuild(root, platformId, env = process.env) {
  const raw = parse(readFileSync(gameConfigPath(root, env), "utf8"));
  return gameConfigRules().resolveBuild(raw, { ...env, WGF_TARGET_PLATFORM: platformId });
}

/**
 * The digest of a build directory, byte-for-byte the Factory's `bundle_digest`
 * (web-game-factory scripts/wgf_release/step.py): walk `relDir` top-down as os.walk does —
 * a directory's files in sorted order, then its sub-directories in sorted order, skipping
 * node_modules — and for each file feed `path relative to ROOT, forward slashes, UTF-8`,
 * a NUL byte and the file's raw SHA-256 into one outer SHA-256. The path is relative to the
 * repository root, not to the directory, so the same bytes under another directory digest
 * differently. `"sha256:<hex>"`, or null for a directory with no files (or none at all).
 */
export function distDigest(root, relDir) {
  const base = resolve(root, relDir);
  if (!existsSync(base)) return null;
  const outer = createHash("sha256");
  let count = 0;
  // Python sorts str by code point; JavaScript's default sort compares UTF-16 code units.
  // The two differ only above U+FFFF, so compare code points explicitly.
  const byCodePoint = (a, b) => {
    const left = [...a].map((c) => c.codePointAt(0));
    const right = [...b].map((c) => c.codePointAt(0));
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return left.length - right.length;
  };
  const walk = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    // os.walk puts a symlink to a directory among the directories and, not following links,
    // never descends into it; any other non-directory is a file, read through its link.
    const linksToDir = (entry) =>
      entry.isSymbolicLink() &&
      statSync(join(directory, entry.name), { throwIfNoEntry: false })?.isDirectory();
    const files = entries
      .filter((entry) => !entry.isDirectory() && !linksToDir(entry))
      .map((entry) => entry.name);
    const dirs = entries
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => entry.name);
    for (const name of files.sort(byCodePoint)) {
      const full = join(directory, name);
      const rel = relative(root, full).split(sep).join("/");
      const digest = createHash("sha256").update(readFileSync(full)).digest();
      outer.update(Buffer.concat([Buffer.from(rel, "utf8"), Buffer.from([0]), digest]));
      count++;
    }
    for (const name of dirs.sort(byCodePoint)) walk(join(directory, name));
  };
  walk(base);
  return count > 0 ? "sha256:" + outer.digest("hex") : null;
}

/**
 * Serialise with object keys sorted, so a digest does not depend on property order.
 * Arrays keep their order — in an artifact, list order is meaning, not formatting.
 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The provenance content hash of an artifact.
 *
 * Computed over the artifact with its own hash slot blanked, because a value cannot contain
 * a digest of itself. Every gate pins its subject by this hash, so two runs over identical
 * content must produce the same string — hence the stable key order.
 */
export function contentHash(artifact) {
  const copy = JSON.parse(JSON.stringify(artifact));
  copy.provenance.content_hash = "";
  return "sha256:" + createHash("sha256").update(stableStringify(copy)).digest("hex");
}

/** The pinned profile version for a platform, read from game.config.yaml's pin. */
export function pinnedProfileVersion(gameConfig, platformId) {
  const entry = gameConfig.platforms.find((candidate) => candidate.id === platformId);
  if (!entry) throw new Error(`game.config.yaml does not target platform "${platformId}"`);
  const version = String(entry.profile).split("@")[1];
  if (!version) throw new Error(`platform "${platformId}" has an unpinned profile`);
  return version;
}
