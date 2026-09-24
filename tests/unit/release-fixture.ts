// A throwaway repository laid out the way `pnpm build:platforms` leaves one, for the release
// scripts' tests: game.config.yaml, package.json, build/platforms/index.json and, per
// platform, build/platforms/<id>/{build.json,dist/}. Created under the OS temp directory so
// it is outside any git work tree unless a test makes it one.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error — plain ESM script without type declarations.
import { distDigest } from "../../scripts/release/package.mjs";

export interface FixturePlatform {
  id: string;
  files: Record<string, string>;
  portalConfigured?: boolean;
  extra?: Record<string, unknown>;
}

export interface Fixture {
  root: string;
  write(rel: string, content: string): void;
  /** (Re)write build.json + index.json for every platform, as the build would. */
  record(commitSha?: string | null): void;
  cleanup(): void;
}

export function makeFixture(
  platforms: FixturePlatform[],
  options: { version?: string; packageJson?: Record<string, unknown> } = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "wgf-release-"));
  const write = (rel: string, content: string): void => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };

  const version = options.version ?? "1.2.0";
  const entries = platforms
    .map((p) => {
      const extra = Object.entries(p.extra ?? {})
        .map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`)
        .join("");
      return `  - { id: ${p.id}, profile: ${p.id}@1.0.0, role: required${extra} }`;
    })
    .join("\n");
  write(
    "game.config.yaml",
    `game:\n  id: fixture-game\n  name: Fixture\n  version: ${version}\n` +
      `engine:\n  type: pixijs\nplatforms:\n${entries}\n` +
      `monetization:\n  ad_kinds: []\n  iap: false\n`,
  );
  write(
    "package.json",
    JSON.stringify(options.packageJson ?? { name: "fixture", version: "1.1.0" }, null, 2),
  );
  for (const p of platforms) {
    for (const [rel, content] of Object.entries(p.files)) {
      write(`build/platforms/${p.id}/dist/${rel}`, content);
    }
  }

  const record = (commitSha: string | null = null): void => {
    const index = platforms.map((p) => {
      const dir = `build/platforms/${p.id}/dist`;
      const digest = distDigest(root, join(root, dir)) as string;
      const portal = p.portalConfigured ?? true;
      write(
        `build/platforms/${p.id}/build.json`,
        JSON.stringify({
          schema: "wgf-platform-build/1",
          platform: p.id,
          profile: `${p.id}@1.0.0`,
          role: "required",
          engine: "pixijs",
          game_id: "fixture-game",
          game_version: version,
          commit_sha: commitSha,
          dist_digest: digest,
          portal_configured: portal,
        }),
      );
      return {
        id: p.id,
        profile: `${p.id}@1.0.0`,
        role: "required",
        dir,
        dist_digest: digest,
        portal_configured: portal,
      };
    });
    write(
      "build/platforms/index.json",
      JSON.stringify({
        schema: "wgf-platform-builds/1",
        game_id: "fixture-game",
        game_version: version,
        engine: "pixijs",
        commit_sha: commitSha,
        platforms: index,
      }),
    );
  };
  record();

  return { root, write, record, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Make the fixture a git work tree with one commit; returns HEAD. */
export function gitInit(root: string): string {
  const git = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return git("rev-parse", "HEAD");
}

export const BASIC_DIST = {
  "index.html": "<!doctype html><title>g</title><script src=assets/main.js></script>",
  "assets/main.js": "console.log('game');",
  "assets/main.js.map": '{"version":3}',
  ".gitkeep": "",
};
