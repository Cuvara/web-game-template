import { describe, expect, it } from "vitest";
import {
  POKI_SDK_URL,
  auditBundle,
  auditSize,
  auditSource,
} from "../../scripts/verify/poki-audit.mjs";

// A minimal bundle that passes: the SDK loader, the four required calls, nothing else.
const CLEAN_JS = `const u="${POKI_SDK_URL}";s.gameLoadingFinished();s.gameplayStart();s.gameplayStop();s.commercialBreak(()=>{});`;
const CLEAN_HTML = `<!doctype html><html><head><script type="module" src="./assets/index.js"></script></head><body></body></html>`;

function bundle(extra = []) {
  return [
    { path: "dist/index.html", text: CLEAN_HTML },
    { path: "dist/assets/index.js", text: CLEAN_JS },
    ...extra,
  ];
}

const errors = (result) => result.findings.filter((f) => f.severity === "error");
const rules = (result) => errors(result).map((f) => f.rule);

describe("auditBundle", () => {
  it("passes a clean build", () => {
    const result = auditBundle(bundle());
    expect(errors(result)).toEqual([]);
    expect(result.sdkEvents).toEqual([
      "commercialBreak",
      "gameLoadingFinished",
      "gameplayStart",
      "gameplayStop",
    ]);
  });

  it("fails when the Poki SDK is not loaded", () => {
    const result = auditBundle([{ path: "dist/assets/index.js", text: "gameLoadingFinished" }]);
    expect(errors(result).some((f) => f.message.includes("not referenced"))).toBe(true);
  });

  it("fails on any external URL it has no reason for", () => {
    const result = auditBundle(
      bundle([{ path: "dist/assets/x.js", text: `fetch("https://api.example.com/score")` }]),
    );
    expect(rules(result)).toContain("external-request");
  });

  it("fails on a Poki URL that is not the documented loader", () => {
    const result = auditBundle(
      bundle([{ path: "dist/assets/x.js", text: `"https://game-cdn.poki.com/other.js"` }]),
    );
    expect(rules(result)).toContain("external-request");
  });

  it("accepts documented inert strings as info, not errors", () => {
    const result = auditBundle(
      bundle([{ path: "dist/assets/x.js", text: `console.info("http://www.pixijs.com/")` }]),
    );
    expect(errors(result)).toEqual([]);
    expect(result.findings.some((f) => f.rule === "inert-url")).toBe(true);
  });

  it("fails on external scripts, fonts and images in HTML and CSS", () => {
    const result = auditBundle(
      bundle([
        { path: "dist/a.html", text: `<script src="https://cdn.jsdelivr.net/npm/x.js"></script>` },
        {
          path: "dist/b.css",
          text: `@import url("https://fonts.googleapis.com/css?family=Inter");`,
        },
        { path: "dist/c.html", text: `<img src="//images.example.com/a.png">` },
      ]),
    );
    expect(rules(result)).toEqual(
      expect.arrayContaining(["external-asset", "external-font", "external-request"]),
    );
  });

  it("allows Poki's documented SDK tag, and no other external script", () => {
    const tag = auditBundle(
      bundle([{ path: "dist/sdk.html", text: `<script src="${POKI_SDK_URL}"></script>` }]),
    );
    expect(errors(tag)).toEqual([]);
    const other = auditBundle(
      bundle([
        { path: "dist/sdk.html", text: `<script src="https://game-cdn.poki.com/x.js"></script>` },
      ]),
    );
    expect(rules(other)).toContain("external-asset");
  });

  it("fails on outgoing links", () => {
    const result = auditBundle(
      bundle([{ path: "dist/credits.html", text: `<a href="https://studio.example">Studio</a>` }]),
    );
    expect(rules(result)).toContain("outgoing-link");
    const js = auditBundle(bundle([{ path: "dist/assets/x.js", text: `window.open(u)` }]));
    expect(rules(js)).toContain("outgoing-link");
  });

  it("fails on third-party ads, analytics and other portals", () => {
    const result = auditBundle(
      bundle([
        { path: "dist/assets/ads.js", text: `(adsbygoogle=window.adsbygoogle||[]).push({})` },
        { path: "dist/assets/ga.js", text: `gtag("config","G-1")` },
        { path: "dist/assets/p.js", text: `CrazyGames.SDK.init()` },
      ]),
    );
    expect(rules(result)).toEqual(
      expect.arrayContaining(["third-party-ads", "analytics", "branding"]),
    );
  });

  it("fails on debug leftovers and source maps", () => {
    const result = auditBundle(
      bundle([
        {
          path: "dist/assets/d.js",
          text: `function f(){debugger;PokiSDK.setDebug(true);return "http://localhost:5173"}`,
        },
        { path: "dist/assets/index.js.map", text: "{}" },
      ]),
    );
    expect(rules(result).filter((r) => r === "debug-code").length).toBe(3);
    expect(rules(result)).toContain("clean-build");
  });

  it("does not mistake an identifier containing 'debugger' for the statement", () => {
    const result = auditBundle(
      bundle([{ path: "dist/assets/d.js", text: `const isdebugger=1;x.debugger=2;` }]),
    );
    expect(rules(result)).not.toContain("debug-code");
  });

  it("fails on sockets and beacons", () => {
    const result = auditBundle(
      bundle([{ path: "dist/assets/n.js", text: `new WebSocket(u);navigator.sendBeacon(u)` }]),
    );
    expect(rules(result).filter((r) => r === "network-api").length).toBe(2);
  });

  it("fails on a bundled copy of the SDK core", () => {
    const result = auditBundle(
      bundle([
        {
          path: "dist/assets/s.js",
          text: `"poki-sdk-core-039db50ea427405706a1ba7d521081cbc0fda4cb.js"`,
        },
      ]),
    );
    expect(rules(result)).toContain("sdk");
  });
});

describe("auditSource", () => {
  it("allows storage only inside the platform storage backend", () => {
    const findings = auditSource([
      { path: "packages/platform-sdk/src/storage.ts", text: "globalThis.localStorage.getItem(k)" },
      {
        path: "examples/poki-compliance-demo/src/save.ts",
        text: "// not localStorage\nawait storage.get(k)",
      },
      {
        path: "src/game/bad.ts",
        text: "const v = localStorage.getItem('x'); document.cookie = 'a=b';",
      },
    ]);
    expect(findings.map((f) => `${f.file}:${f.line}`)).toEqual([
      "src/game/bad.ts:1",
      "src/game/bad.ts:1",
    ]);
  });

  it("allows PokiSDK only inside the Poki adapter", () => {
    const findings = auditSource([
      { path: "packages/platform-sdk/src/adapters/poki.ts", text: "window.PokiSDK" },
      { path: "src/game/scene.ts", text: "window.PokiSDK.gameplayStart()" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("architecture");
  });
});

describe("auditSize", () => {
  const MB = 1024 * 1024;
  const html = {
    path: "dist/index.html",
    text: `<script type="module" src="./assets/index.js"></script><link rel="modulepreload" href="./assets/vendor.js">`,
    size: 1000,
  };

  it("counts html and all code as initial, other assets only as total", () => {
    const result = auditSize([
      html,
      { path: "dist/assets/index.js", size: 1 * MB },
      { path: "dist/assets/WebGLRenderer.js", size: 1 * MB },
      { path: "dist/assets/music.ogg", size: 2 * MB },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.initialFiles).toEqual([
      "dist/assets/WebGLRenderer.js",
      "dist/assets/index.js",
      "dist/index.html",
    ]);
    expect(result.initialMb).toBeCloseTo(2, 2);
    expect(result.totalMb).toBeCloseTo(4, 2);
  });

  it("counts a dynamically imported chunk as initial", () => {
    const result = auditSize([html, { path: "dist/assets/lazy-engine.js", size: 6 * MB }]);
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringContaining("initial download"),
    ]);
  });

  it("measures bytes, not characters", () => {
    const result = auditSize([{ path: "dist/index.html", text: "é".repeat(3 * MB) }]);
    expect(result.totalMb).toBeCloseTo(6, 2);
  });

  it("fails an initial download over Poki's 5 MB", () => {
    const result = auditSize([html, { path: "dist/assets/index.js", size: 6 * MB }]);
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringContaining("initial download"),
    ]);
  });

  it("fails a total over Poki's 8 MB", () => {
    const result = auditSize([html, { path: "dist/assets/levels.bin", size: 9 * MB }]);
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringContaining("total download"),
    ]);
  });
});
