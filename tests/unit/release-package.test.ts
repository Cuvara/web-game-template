// release:package — one deterministic zip per platform build, and the refusals that keep a
// stale, unconfigured or edited build from shipping.

// @ts-expect-error — adm-zip ships no type declarations; the shape used is typed below.
import AdmZipUntyped from "adm-zip";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentDigest,
  distDigest,
  dosTimestamp,
  packageRelease,
  ReleaseRefusal,
  sourceDateEpoch,
  ZIP_EPOCH_MIN,
  // @ts-expect-error — plain ESM script without type declarations.
} from "../../scripts/release/package.mjs";
import { BASIC_DIST, type Fixture, gitInit, makeFixture } from "./release-fixture.js";

interface ZipEntry {
  entryName: string;
  header: { timeval: number; attr: number };
  getData(): Buffer;
}
const AdmZip = AdmZipUntyped as new (path: string) => {
  getEntries(): ZipEntry[];
  readAsText(name: string): string;
};

interface PackageRecord {
  platform_id: string;
  filename: string;
  checksum: string;
  content_digest: string;
  dist_digest: string;
  files: number;
  build: { commit_sha: string | null; profile: string; dir: string };
}

const fixtures: Fixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.cleanup();
});
function fixture(...args: Parameters<typeof makeFixture>): Fixture {
  const f = makeFixture(...args);
  fixtures.push(f);
  return f;
}

const run = (f: Fixture, extra: Record<string, unknown> = {}): PackageRecord[] =>
  packageRelease({ root: f.root, releaseId: "r1", env: {}, ...extra }) as PackageRecord[];

const zipSha = (f: Fixture, id: string): string =>
  createHash("sha256")
    .update(readFileSync(join(f.root, "release/r1", `${id}.zip`)))
    .digest("hex");

const entryNames = (f: Fixture, id: string): string[] =>
  new AdmZip(join(f.root, "release/r1", `${id}.zip`)).getEntries().map((e) => e.entryName);

describe("release:package archives", () => {
  it("zips each platform's own dist, index.html at the root, no *.map or .gitkeep", () => {
    const f = fixture([
      { id: "poki", files: BASIC_DIST },
      { id: "crazygames", files: { ...BASIC_DIST, "assets/main.js": "console.log('cg');" } },
    ]);
    const packages = run(f);
    expect(packages.map((p) => p.platform_id)).toEqual(["poki", "crazygames"]);
    expect(entryNames(f, "poki")).toEqual(["assets/main.js", "index.html"]);
    const cg = new AdmZip(join(f.root, "release/r1/crazygames.zip"));
    expect(cg.readAsText("assets/main.js")).toBe("console.log('cg');");
    // Different dists, different packages.
    expect(zipSha(f, "poki")).not.toBe(zipSha(f, "crazygames"));
    expect(packages[0]!.content_digest).not.toBe(packages[1]!.content_digest);
  });

  it("is byte-for-byte reproducible when only file mtimes change", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    run(f);
    const first = zipSha(f, "poki");
    const firstPackages = readFileSync(join(f.root, "release/r1/packages.json"), "utf8");
    const later = new Date("2031-05-06T07:08:09Z");
    for (const rel of Object.keys(BASIC_DIST)) {
      utimesSync(join(f.root, "build/platforms/poki/dist", rel), later, later);
    }
    run(f);
    expect(zipSha(f, "poki")).toBe(first);
    expect(readFileSync(join(f.root, "release/r1/packages.json"), "utf8")).toBe(firstPackages);
    expect(readFileSync(join(f.root, "release/r1/checksums.txt"), "utf8")).toBe(
      `${first}  poki.zip\n`,
    );
  });

  it("stamps every entry with one fixed time and mode, SOURCE_DATE_EPOCH when set", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    run(f);
    for (const entry of new AdmZip(join(f.root, "release/r1/poki.zip")).getEntries()) {
      expect(entry.header.timeval).toBe(dosTimestamp(ZIP_EPOCH_MIN));
      expect((entry.header.attr >>> 16) & 0o777).toBe(0o644);
    }
    const plain = zipSha(f, "poki");
    run(f, { env: { SOURCE_DATE_EPOCH: "1700000000" } });
    expect(zipSha(f, "poki")).not.toBe(plain);
    run(f, { env: { SOURCE_DATE_EPOCH: "1700000000" } });
    const stamped = zipSha(f, "poki");
    run(f, { env: { SOURCE_DATE_EPOCH: "1700000000" } });
    expect(zipSha(f, "poki")).toBe(stamped);
  });

  it("records content digest, dist digest and build info per package", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    const [record] = run(f);
    const dist = join(f.root, "build/platforms/poki/dist");
    expect(record).toMatchObject({
      filename: "poki.zip",
      files: 2,
      dist_digest: distDigest(f.root, dist),
      build: { commit_sha: null, profile: "poki@1.0.0", dir: "build/platforms/poki/dist" },
    });
    const zip = new AdmZip(join(f.root, "release/r1/poki.zip"));
    expect(record!.content_digest).toBe(
      contentDigest(zip.getEntries().map((e) => ({ name: e.entryName, data: e.getData() }))),
    );
  });

  it("packages only the wrapper page for a self-hosted GameDistribution target", () => {
    const f = fixture([
      {
        id: "gamedistribution",
        files: BASIC_DIST,
        extra: {
          game_id: "0123456789abcdef0123456789abcdef",
          hosting: "self-hosted",
          game_url: "https://games.example.com/g/",
        },
      },
    ]);
    run(f);
    expect(entryNames(f, "gamedistribution")).toEqual(["index.html"]);
    const html = new AdmZip(join(f.root, "release/r1/gamedistribution.zip")).readAsText(
      "index.html",
    );
    expect(html).toContain("https://games.example.com/g/");
  });

  it("packages a single platform with --platform", () => {
    const f = fixture([
      { id: "poki", files: BASIC_DIST },
      { id: "y8", files: BASIC_DIST },
    ]);
    expect(run(f, { platform: "y8" }).map((p) => p.platform_id)).toEqual(["y8"]);
    expect(existsSync(join(f.root, "release/r1/poki.zip"))).toBe(false);
  });
});

describe("dist digest", () => {
  it("matches the Factory's bundle_digest walk: files, then sorted subdirectories", () => {
    const f = fixture([
      { id: "poki", files: { "b.txt": "b", "a/z.txt": "z", "c.txt": "c", "a/b/y.txt": "y" } },
    ]);
    // os.walk order: the directory's own files sorted, then each sorted subdirectory.
    const order = [
      "build/platforms/poki/dist/b.txt",
      "build/platforms/poki/dist/c.txt",
      "build/platforms/poki/dist/a/z.txt",
      "build/platforms/poki/dist/a/b/y.txt",
    ];
    const outer = createHash("sha256");
    for (const rel of order) {
      outer.update(Buffer.from(rel + "\0", "utf8"));
      outer.update(
        createHash("sha256")
          .update(readFileSync(join(f.root, rel)))
          .digest(),
      );
    }
    expect(distDigest(f.root, join(f.root, "build/platforms/poki/dist"))).toBe(
      "sha256:" + outer.digest("hex"),
    );
  });
});

describe("release:package refusals", () => {
  const refused = (f: Fixture, pattern: RegExp, extra: Record<string, unknown> = {}): void => {
    let error: unknown;
    try {
      run(f, extra);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReleaseRefusal);
    expect((error as Error).message).toMatch(pattern);
    // Nothing is written on refusal.
    expect(existsSync(join(f.root, "release/r1/packages.json"))).toBe(false);
  };

  it("refuses without build/platforms/index.json", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    rmSync(join(f.root, "build/platforms/index.json"));
    refused(f, /index\.json is missing.*build:platforms/);
  });

  it("refuses a platform that was not built, or whose dist is gone", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    f.write(
      "build/platforms/index.json",
      JSON.stringify({ schema: "wgf-platform-builds/1", platforms: [] }),
    );
    refused(f, /poki was not built/);

    const g = fixture([{ id: "poki", files: BASIC_DIST }]);
    rmSync(join(g.root, "build/platforms/poki/dist"), { recursive: true });
    refused(g, /build\/platforms\/poki\/dist is missing/);
  });

  it("refuses a build whose portal id was not configured", () => {
    const f = fixture([{ id: "y8", files: BASIC_DIST, portalConfigured: false }]);
    f.record();
    refused(f, /portal_configured=false/);
  });

  it("refuses a dist edited after it was built", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    f.write("build/platforms/poki/dist/assets/main.js", "console.log('patched');");
    refused(f, /changed after it was built/);
  });

  it("refuses a build that names a commit outside a git work tree", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    f.record("a".repeat(40));
    refused(f, /not a git work tree/);
  });

  it("refuses a build of another commit than HEAD, and accepts one of HEAD", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    const head = gitInit(f.root);
    f.record("b".repeat(40));
    refused(f, /stale/);
    f.record(null);
    refused(f, /stale — built from no commit/);
    f.record(head);
    expect(run(f)[0]!.build.commit_sha).toBe(head);
  });

  it("refuses a dist without index.html at its root", () => {
    const f = fixture([{ id: "poki", files: { "game/index.html": "<!doctype html>" } }]);
    f.record();
    refused(f, /no index\.html at its root/);
  });

  it("applies the Yandex archive rules: ASCII names without spaces", () => {
    const f = fixture([{ id: "yandex", files: { ...BASIC_DIST, "assets/my sprite.png": "x" } }]);
    f.record();
    refused(f, /no spaces or non-ASCII.*1\.22/);
  });

  it("honours max_bundle_mb from the vendored platform profile", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    f.write("config/platforms/poki.yaml", "requirements:\n  max_bundle_mb: 0.0000001\n");
    refused(f, /profile caps it/);
    f.write("config/platforms/poki.yaml", "requirements:\n  max_bundle_mb: 150\n");
    expect(run(f)).toHaveLength(1);
  });

  it("does not replace the packages of a release that already has a manifest", () => {
    const f = fixture([{ id: "poki", files: BASIC_DIST }]);
    run(f);
    f.write("release/r1/manifest.json", "{}");
    // Same build: reproduced, allowed.
    expect(run(f)).toHaveLength(1);
    f.write("build/platforms/poki/dist/assets/main.js", "console.log('v2');");
    f.record();
    expect(() => run(f)).toThrow(/immutable/);
  });

  it("rejects a malformed SOURCE_DATE_EPOCH and clamps one before 1980", () => {
    expect(() => sourceDateEpoch({ SOURCE_DATE_EPOCH: "soon" })).toThrow(/whole seconds/);
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: "0" })).toBe(ZIP_EPOCH_MIN);
    expect(sourceDateEpoch({})).toBe(Date.UTC(1980, 0, 1) / 1000);
  });

  // The CLI packages its own repository, where build/platforms is absent in a fresh checkout.
  // A developer's local build/platforms would make this package for real, so it is skipped then.
  const repo = resolve(import.meta.dirname, "../..");
  it.skipIf(existsSync(join(repo, "build/platforms/index.json")))(
    "exits 1 with the reason when run as a script (skipped: local build/platforms exists)",
    () => {
      const f = fixture([{ id: "poki", files: BASIC_DIST }]);
      const result = spawnSync(
        process.execPath,
        [join(repo, "scripts/release/package.mjs"), "--release", "r999"],
        {
          encoding: "utf8",
          env: { ...process.env, WGF_GAME_CONFIG: join(f.root, "game.config.yaml") },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/release:package refused: .*index\.json is missing/);
    },
  );
});
