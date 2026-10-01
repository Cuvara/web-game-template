#!/usr/bin/env node
// Assemble each golden-run port onto a copy of this repository and prove it still works.
//
// The Factory's golden regression runs create a game repository from a pinned template
// commit and apply examples/<example>/wgf-golden.port.json onto it. If the template moves in
// a way the port no longer fits — a changed GameContext, a renamed seam method, a removed
// file — that used to surface only in the Factory, after the pin moved. This runs the same
// assembly here, in CI, so it fails in the pull request that caused it.
//
// Per port: copy the repository's files (tracked and untracked-but-not-ignored, so local
// edits count) into a temporary directory, apply the overlays and copy mapping, add the
// engine dependencies, install, then run typecheck, lint, test, sdk:check, build,
// build:platforms and the browser suites a game inherits (e2e with the port's own specs,
// the SDK browser smoke, runtime facts). Nothing is written to this repository.
//
//   node scripts/verify/golden-check.mjs [--example <name>] [--skip-e2e] [--keep]
//
// Exit 0 when every port passes, 1 when one fails, 2 on a usage or setup error.

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs, repoRoot } from "../_shared.mjs";

const PORT_FILE = "wgf-golden.port.json";
const STEPS = [
  ["typecheck", ["pnpm", "typecheck"]],
  ["lint", ["pnpm", "lint"]],
  ["test", ["pnpm", "test"]],
  ["sdk:check", ["pnpm", "sdk:check"]],
  ["build", ["pnpm", "build"]],
  ["build:platforms", ["pnpm", "build:platforms"]],
  ["e2e", ["pnpm", "test:e2e"]],
  ["sdk-browser", ["pnpm", "test:sdk:browser"]],
  ["verify", ["pnpm", "test:verify"]],
];
// Steps that drive a browser; --skip-e2e leaves them out.
const BROWSER_STEPS = new Set(["e2e", "sdk-browser", "verify"]);

function fail(message, code = 2) {
  console.error(`golden-check: ${message}`);
  process.exit(code);
}

function ports(root, only) {
  const examples = join(root, "examples");
  if (!existsSync(examples)) return [];
  return readdirSync(examples)
    .filter((name) => existsSync(join(examples, name, PORT_FILE)))
    .filter((name) => !only || name === only)
    .sort()
    .map((name) => ({ name, port: JSON.parse(readFileSync(join(examples, name, PORT_FILE))) }));
}

/** Tracked files plus untracked ones git does not ignore: the working tree a commit would hold. */
function copyRepository(root, target) {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of listed) {
    const from = join(root, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue; // deleted in the working tree
    mkdirSync(dirname(join(target, file)), { recursive: true });
    cpSync(from, join(target, file));
  }
}

function copyOverlay(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "README.md") continue;
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destination, { recursive: true });
      copyOverlay(source, destination);
    } else {
      cpSync(source, destination);
    }
  }
}

function assemble(repo, port) {
  for (const overlay of port.overlays) {
    const from = join(repo, overlay);
    if (!existsSync(from)) throw new Error(`overlay ${overlay} does not exist`);
    copyOverlay(from, repo);
  }
  for (const entry of port.copy) {
    const from = join(repo, "examples", port.example, entry.from);
    if (!existsSync(from)) throw new Error(`examples/${port.example}/${entry.from} does not exist`);
    let text = readFileSync(from, "utf8");
    for (const [before, after] of entry.replace ?? []) {
      if (!text.includes(before)) {
        throw new Error(`${entry.from}: the text to replace is gone: ${before}`);
      }
      text = text.split(before).join(after);
    }
    mkdirSync(dirname(join(repo, entry.to)), { recursive: true });
    writeFileSync(join(repo, entry.to), text);
  }

  // The engine the port is written for. game.config.yaml is edited in place, as the
  // Factory's init does, so its comments survive.
  const configPath = join(repo, "game.config.yaml");
  const config = readFileSync(configPath, "utf8");
  const engineLine = /^(\s+type:\s+)(pixijs|threejs)\s*$/m;
  if (!engineLine.test(config)) throw new Error("game.config.yaml has no engine.type line");
  // And a game id of its own, as init gives every created repository: `example-game` marks
  // the untouched template, whose suites check both engines (testedEngines in _shared.mjs).
  const idLine = /^(\s+id:\s+)example-game\s*$/m;
  if (!idLine.test(config)) throw new Error("game.config.yaml has no game.id example-game line");
  writeFileSync(
    configPath,
    config.replace(engineLine, `$1${port.engine}`).replace(idLine, `$1golden-${port.example}`),
  );

  const example = JSON.parse(readFileSync(join(repo, "examples", port.example, "package.json")));
  const manifestPath = join(repo, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const name of port.engine_dependencies ?? []) {
    const field = ["dependencies", "devDependencies"].find((f) => example[f]?.[name]);
    if (!field) throw new Error(`examples/${port.example}/package.json does not pin ${name}`);
    manifest[field] = { ...manifest[field], [name]: example[field][name] };
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

function run(command, cwd) {
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    // A golden port is judged against the config it ships, never an ambient override.
    env: { ...process.env, WGF_GAME_CONFIG: "", WGF_TARGET_PLATFORM: "" },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    seconds: Math.round((Date.now() - started) / 1000),
    tail: `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-40).join("\n"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const selected = ports(root, args.example);
  if (selected.length === 0) {
    if (args.example) fail(`no examples/${args.example}/${PORT_FILE}`);
    console.log(JSON.stringify({ ok: true, ports: [], note: "no golden ports in examples/" }));
    return;
  }

  const results = [];
  for (const { name, port } of selected) {
    const work = mkdtempSync(join(tmpdir(), `wgf-golden-${name}-`));
    const record = { example: name, engine: port.engine, dir: work, steps: [] };
    results.push(record);
    try {
      copyRepository(root, work);
      assemble(work, port);
      // The engine packages are new to the lockfile; everything else resolves as locked.
      const install = run(["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline"], work);
      record.steps.push({ step: "install", ...install });
      if (!install.ok) throw new Error("install failed");
      for (const [step, command] of STEPS) {
        if (BROWSER_STEPS.has(step) && args["skip-e2e"]) continue;
        const outcome = run(command, work);
        record.steps.push({ step, ...outcome });
        console.error(
          `golden-check ${name}: ${step} ${outcome.ok ? "ok" : "FAILED"} (${outcome.seconds}s)`,
        );
        if (!outcome.ok) break;
      }
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      record.ok = !record.error && record.steps.every((s) => s.ok);
      if (!args.keep) rmSync(work, { recursive: true, force: true });
      // Keep the failing output only; a passing step's log is noise in the report.
      for (const step of record.steps) if (step.ok) delete step.tail;
      record.dir = args.keep ? relative(process.cwd(), work) || work : null;
    }
  }

  const ok = results.every((r) => r.ok);
  console.log(JSON.stringify({ ok, ports: results }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === resolve(import.meta.filename)) main();
