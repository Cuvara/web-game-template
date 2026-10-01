// distDigest must be byte-for-byte the Factory's bundle_digest
// (web-game-factory scripts/wgf_release/step.py): the Factory recomputes it from a checkout
// and refuses a release whose bytes differ from the ones verified.
//
// The expected values were computed by running that Python function over this exact fixture:
//   python3 -c 'import os; ...; print(bundle_digest("<root>", "out/dist"))'
// The fixture is built so a plausible-but-wrong walk fails: a file sorted after a
// sub-directory (os.walk yields a directory's files before descending), upper case before
// lower case (code-point order), a non-ASCII name, and a node_modules that must be skipped.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { beforeAll, describe, expect, it } from "vitest";
import { distDigest } from "../../scripts/_shared.mjs";

let root;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "wgf-digest-"));
  const dist = join(root, "out", "dist");
  mkdirSync(join(dist, "a", "c"), { recursive: true });
  mkdirSync(join(dist, "node_modules"), { recursive: true });
  mkdirSync(join(root, "empty"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html></html>\n");
  writeFileSync(join(dist, "z.txt"), "z");
  writeFileSync(join(dist, "B.txt"), "upper");
  writeFileSync(join(dist, "a", "b.js"), "b");
  writeFileSync(join(dist, "a", "c", "d.bin"), Buffer.from([0, 1, 2, 255]));
  writeFileSync(join(dist, "node_modules", "x.js"), "skip");
  writeFileSync(join(dist, "é.txt"), "accent");
});

describe("distDigest", () => {
  it("equals the Factory's bundle_digest for the same directory", () => {
    expect(distDigest(root, "out/dist")).toBe(
      "sha256:990ab3397d7e1bdc808edef50fd4454459a89c12c2454537f13d4b19e18bd3b7",
    );
  });

  it("hashes paths relative to the root it is given, not to the directory", () => {
    expect(distDigest(join(root, "out"), "dist")).toBe(
      "sha256:2e31d92eda543797adc8bf5f029ff9be2896380e0e85112442159ac3ef9fdfab",
    );
  });

  it("is null for an empty or missing directory, as bundle_digest returns None", () => {
    expect(distDigest(root, "empty")).toBeNull();
    expect(distDigest(root, "missing")).toBeNull();
  });
});
