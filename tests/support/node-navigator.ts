// The `navigator` global Node 21+ ships, for Node 20.
//
// pixi.js reads `navigator.userAgent` while its modules evaluate (isSafari, via the
// browser adapter), so importing @wgf/pixi-framework under Node 20 — the .nvmrc pin, and
// what CI runs — throws before a test starts. Node 21 added a minimal `navigator` and the
// import works there. This supplies the same four properties when Node has none, and
// leaves a real one alone. It is not a browser: suites that need a DOM still fake it.

if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      hardwareConcurrency: 1,
      language: "en-US",
      platform: process.platform,
      userAgent: `Node.js/${process.versions.node.split(".")[0]}`,
    },
    configurable: true,
    enumerable: true,
    writable: true,
  });
}
