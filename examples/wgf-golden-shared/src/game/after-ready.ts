// Run work once the template's main.ts has finished booting.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. createGame runs before main.ts signals ready and installs its probe:
// installProbe() replaces window.__wgf__, and only then is #hud[data-ready] set to "true".
// Whatever must sit beside that probe (the play probe), or must wait until the game is
// interactive (streaming the sound in), is deferred to that attribute. A MutationObserver
// callback is a microtask, so the work has run before any test or page script can observe
// data-ready="true".

/** Calls `run` once #hud[data-ready] is "true" (now, if it already is). Returns the cancel. */
export function afterReady(hud: HTMLElement, run: () => void): () => void {
  if (hud.dataset["ready"] === "true") {
    run();
    return () => undefined;
  }
  const observer = new MutationObserver(() => {
    if (hud.dataset["ready"] !== "true") return;
    observer.disconnect();
    run();
  });
  observer.observe(hud, { attributes: true, attributeFilter: ["data-ready"] });
  return () => observer.disconnect();
}
