// A stand-in for https://html5.api.gamedistribution.com/main.min.js, served by Playwright in
// place of the real one. Tests never reach GameDistribution: a run must not depend on the
// network, and must not send test traffic (or impressions) to a real Game ID.
//
// Like the real SDK it reads window.GD_OPTIONS when it runs, defines window.gdsdk with
// showAd(type) / preloadAd(type), and reports through GD_OPTIONS.onEvent — the documented
// surface only (packages/platform-sdk/src/adapters/gamedistribution/sdk.ts). It is also a
// referee: every breach of the documented integration lands in window.__gdViolations.
//
// Behaviour per page through window.__gdMock, set before the page loads:
//   boot:  "ready" | "twice" | "error" | "never" | "late"   (late = SDK_READY after lateMs)
//   ad:    "complete" | "no-fill" | "closed-early" | "error" | "too-soon"
//   lateMs, adMs
// window.__gdFire(name) raises any event by name. window.__gdCalls / __gdEvents record what
// the page asked for and what it was told; window.__gdContext what the SDK could see of its
// hosting (the query string and whether it is framed).
(() => {
  const config = Object.assign(
    { boot: "ready", ad: "complete", lateMs: 7000, adMs: 200 },
    window.__gdMock || {},
  );
  const calls = (window.__gdCalls = []);
  const events = (window.__gdEvents = []);
  const violations = (window.__gdViolations = []);
  const options = window.GD_OPTIONS;
  let framed;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  window.__gdContext = { search: location.search, framed };

  // The docs: set GD_OPTIONS, then load the script — once, with id gamedistribution-jssdk.
  if (!options || typeof options.onEvent !== "function") violations.push("no GD_OPTIONS.onEvent");
  if (!options || !/^[0-9a-f]{32}$/i.test(String(options.gameId || ""))) {
    violations.push("GD_OPTIONS.gameId is not a Game ID");
  }
  if (document.querySelectorAll("#gamedistribution-jssdk").length !== 1) {
    violations.push("the SDK script is not loaded exactly once");
  }
  if (window.gdsdk) violations.push("the SDK was loaded twice");

  let ready = false;
  let running = false;
  const emit = (name, message = "") => {
    events.push(name);
    try {
      options?.onEvent?.({ name, message, status: "success" });
    } catch (error) {
      violations.push(`onEvent threw on ${name}: ${error}`);
    }
  };
  window.__gdFire = emit;
  const later = (ms, fn) => setTimeout(fn, ms);

  const boot = () => {
    if (config.boot === "ready" || config.boot === "twice") {
      ready = true;
      emit("SDK_READY");
      if (config.boot === "twice") emit("SDK_READY");
    } else if (config.boot === "error") {
      emit("SDK_ERROR", "mock init error");
    } else if (config.boot === "late") {
      later(config.lateMs, () => {
        ready = true;
        emit("SDK_READY");
      });
    }
  };

  window.gdsdk = {
    preloadAd(type = "rewarded") {
      calls.push(`preloadAd:${type}`);
      return Promise.resolve("gdsdk://preloaded");
    },
    showAd(type = "interstitial") {
      calls.push(`showAd:${type}`);
      if (!ready) violations.push(`showAd(${type}) before SDK_READY`);
      if (running) {
        violations.push(`showAd(${type}) while an ad is running`);
        emit("AD_IS_ALREADY_RUNNING");
        return Promise.resolve();
      }
      running = true;
      const done = () => (running = false);
      return new Promise((resolve, reject) => {
        switch (config.ad) {
          case "complete":
            emit("SDK_GAME_PAUSE");
            later(config.adMs, () => {
              emit("COMPLETE");
              if (type === "rewarded") emit("SDK_REWARDED_WATCH_COMPLETE");
              emit("SDK_GAME_START");
              done();
              resolve({});
            });
            return;
          case "closed-early":
            emit("SDK_GAME_PAUSE");
            later(config.adMs, () => {
              emit("USER_CLOSE");
              emit("SDK_GAME_START");
              done();
              resolve({});
            });
            return;
          case "no-fill":
            emit("AD_ERROR");
            emit("SDK_GAME_START");
            done();
            resolve({});
            return;
          case "error":
            emit("AD_ERROR");
            emit("SDK_GAME_START");
            done();
            reject("mock error");
            return;
          case "too-soon":
            emit("SDK_GAME_START");
            done();
            reject("The advertisement was requested too soon.");
            return;
        }
      });
    },
  };

  // The SDK initialises asynchronously after its script has run.
  later(50, boot);
})();
