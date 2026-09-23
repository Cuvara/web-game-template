// A stand-in for https://game-cdn.poki.com/scripts/v2/poki-sdk.js, served by Playwright in
// place of the real one. Tests never reach Poki's CDN: a run must not depend on the
// network, and must not send test traffic to Poki.
//
// It is also an independent referee. It knows Poki's documented sequencing rules
// (https://developers.poki.com/guide/sdk-overview, /guide/requirements-quality) and records
// every breach in window.__pokiViolations, whatever the adapter believes it is doing.
//
// Behaviour is set per test through window.__pokiMock before the page loads:
//   init:        "resolve" | "reject" | "hang"
//   commercial:  "play" | "none" | "error"
//   rewarded:    "reward" | "no-reward" | "none" | "error"
//   adMs:        how long a playing ad lasts
//   adClick:     when true, a playing ad ends only when its button is clicked — the way a
//                real ad waits for "close" or "continue". The ad is drawn into the game's
//                own document, as Poki's is, so a game that disables the whole page during
//                ads makes it unfinishable and the test times out.

(() => {
  const config = Object.assign(
    { init: "resolve", commercial: "play", rewarded: "reward", adMs: 300, adClick: false },
    window.__pokiMock || {},
  );
  const calls = (window.__pokiCalls = []);
  const violations = (window.__pokiViolations = []);
  const adSnapshots = (window.__pokiAdSnapshots = []);

  let initialized = false;
  let loaded = false;
  let playing = false;
  let adActive = false;
  let last = null;

  const violate = (message) => violations.push(`${message} (after ${last ?? "nothing"})`);
  const record = (name) => {
    calls.push(name);
    if (!initialized && name !== "init") violate(`${name} before init`);
    if (adActive) violate(`${name} during an ad`);
    if (name === last && name !== "commercialBreak" && name !== "rewardedBreak") {
      violate(`${name} fired consecutively`);
    }
    last = name;
  };

  const hud = () => document.getElementById("hud");
  const snapshot = (kind) =>
    adSnapshots.push({
      kind,
      audio: hud()?.dataset.audio ?? null,
      state: hud()?.dataset.state ?? null,
      // The game's own nodes are disabled…
      gameInert: document.getElementById("game")?.inert === true,
      // …and the ad is not.
      adInert: document.getElementById("mock-ad")?.closest("[inert]") != null,
    });

  const runAd = (kind, onStart, outcome) =>
    new Promise((resolve, reject) => {
      adActive = true;
      if (outcome === "error") {
        adActive = false;
        reject(new Error("mock ad error"));
        return;
      }
      if (outcome === "none") {
        adActive = false;
        resolve();
        return;
      }
      if (typeof onStart === "function") onStart();
      // Give the page a frame to apply what onStart asked for, then record what an ad
      // would have been sitting on top of.
      const ad = document.createElement("div");
      ad.id = "mock-ad";
      ad.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#000c";
      const button = document.createElement("button");
      button.id = "mock-ad-close";
      button.textContent = "Close ad";
      ad.appendChild(button);
      document.body.appendChild(ad);
      const finish = () => {
        ad.remove();
        adActive = false;
        resolve();
      };
      setTimeout(() => snapshot(kind), 0);
      if (config.adClick) button.addEventListener("click", finish, { once: true });
      else setTimeout(finish, config.adMs);
    });

  window.PokiSDK = {
    init() {
      record("init");
      initialized = true;
      if (config.init === "reject") return Promise.reject(new Error("mock adblock"));
      if (config.init === "hang") return new Promise(() => {});
      return Promise.resolve();
    },
    gameLoadingFinished() {
      record("gameLoadingFinished");
      if (loaded) violate("gameLoadingFinished twice");
      loaded = true;
    },
    gameplayStart() {
      record("gameplayStart");
      if (!loaded) violate("gameplayStart before gameLoadingFinished");
      if (playing) violate("gameplayStart while already playing");
      playing = true;
    },
    gameplayStop() {
      record("gameplayStop");
      if (!playing) violate("gameplayStop while not playing");
      playing = false;
    },
    commercialBreak(onStart) {
      record("commercialBreak");
      if (playing) violate("commercialBreak during gameplay — gameplayStop must come first");
      return runAd(
        "commercial",
        onStart,
        config.commercial === "play" ? "play" : config.commercial,
      );
    },
    rewardedBreak(onStart) {
      record("rewardedBreak");
      if (playing) violate("rewardedBreak during gameplay — gameplayStop must come first");
      const outcome =
        config.rewarded === "reward" || config.rewarded === "no-reward" ? "play" : config.rewarded;
      return runAd("rewarded", onStart, outcome).then(() => config.rewarded === "reward");
    },
  };
})();
