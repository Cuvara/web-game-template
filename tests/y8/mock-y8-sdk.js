// A deterministic stand-in for the Y8 JavaScript SDK (https://cdn.y8.com/minimal-sdk/2-0/y8.min.js).
//
// It implements only the documented surface the adapter uses — y8.sdk(), y8.emitReadyEvent(),
// the `y8sdk.ready` event, init, onAuth, getUser, showAd with every documented callback and
// breakStatus, saveData/loadData/removeData, getPlatformLocale — and records each call. It
// never touches the network and never loads the real script.
//
// One mock, three consumers:
//   - node tests (tests/unit/y8.test.ts, tests/sdk/harness.ts) call createY8Mock directly;
//   - the SDK matrix bundle (tests/sdk/portals.ts) imports it into the browser;
//   - the real-bundle smoke (tests/sdk-browser/) serves `(${createY8Mock})(window, opts)` in
//     place of the CDN script, so the built game's own <script async> tag loads it.
// So it must stay self-contained: no imports, no references outside the function body.
//
// Everything is driven by microtasks except the ready event (options.defer, setTimeout 0 by
// default, as the real script does) and scripts that are deliberately held ("late",
// "stall", "silent") until release() is called — so a test decides exactly when, and
// whether, each callback arrives.
//
// Ad scripts (setAd / options.ad), consumed one per showAd call, the last one repeating:
//   viewed            beforeAd, [beforeReward->showAdFn], adViewed, afterAd, adBreakDone viewed
//   dismissed         beforeAd, [beforeReward->showAdFn], adDismissed, afterAd, adBreakDone dismissed
//   noAdPreloaded | frequencyCapped | notReady | timeout | error | ignored | other
//                     adBreakDone with that status only — no beforeAd/afterAd, as documented
//   reject            showAd's promise rejects (as when ad init failed); no callbacks
//   silent            no callback at all, ever (AdSense blocked); release() does nothing
//   stall             beforeAd, then nothing until release(): afterAd + adBreakDone viewed
//   late              nothing until release(): then the whole "viewed" sequence
//   duplicate         the "viewed" sequence with every callback fired twice
//   viewed-dismissed  adViewed then adDismissed for one reward break (conflicting callbacks)
//
// Storage modes: ok | fail (network-style error object) | rejected (code save_rejected).

/**
 * @param {EventTarget & Record<string, unknown>} target  where `y8` is installed and the
 *   ready event is dispatched — `window` in a browser, an EventTarget in node.
 * @param {object} [options]
 */
export function createY8Mock(target, options) {
  const opts = options || {};
  const defer = opts.defer || ((fn) => setTimeout(fn, 0));
  const calls = [];
  const data = new Map();
  let adQueue = [].concat(opts.ad || "viewed");
  let storageMode = opts.storage || "ok";
  let user = opts.user === undefined ? null : opts.user;
  let authCallback = null;
  let pendingAuth = null;
  let initialized = false;
  const held = [];

  const record = (name) => calls.push(name);
  const microtask = (fn) => Promise.resolve().then(fn);
  const nextAd = () => (adQueue.length > 1 ? adQueue.shift() : adQueue[0]);

  const dispatchReady = () => {
    record("event:y8sdk.ready");
    const Ctor = typeof Event === "function" ? Event : null;
    target.dispatchEvent(Ctor ? new Ctor("y8sdk.ready") : { type: "y8sdk.ready" });
  };

  const reportAuth = (value, error) => {
    if (authCallback) authCallback(value, error);
    else pendingAuth = { value, error };
  };

  const needsToken = () => {
    if (!user) throw "The token can't be null.";
  };
  const storageFailure = () =>
    storageMode === "rejected"
      ? { code: "save_rejected", message: "save rejected by the server (mock)" }
      : { message: "network error (mock)" };

  const runAd = (options, script) => {
    const reward = options.type === "reward";
    const fire = (name, arg) => {
      const fn = options[name];
      record("cb:" + name);
      if (typeof fn === "function") fn(arg);
    };
    const done = (status) =>
      fire("adBreakDone", {
        breakType: options.type,
        breakName: options.name,
        breakFormat: reward ? "reward" : "interstitial",
        breakStatus: status,
      });
    const play = (ending, times) => {
      const n = times || 1;
      const rest = () => {
        for (let i = 0; i < n; i += 1) fire("beforeAd");
        if (reward && ending === "viewed-dismissed") {
          fire("adViewed");
          fire("adDismissed");
        } else if (reward) {
          for (let i = 0; i < n; i += 1) fire(ending === "dismissed" ? "adDismissed" : "adViewed");
        }
        for (let i = 0; i < n; i += 1) fire("afterAd");
        const status = ending === "dismissed" ? "dismissed" : "viewed";
        for (let i = 0; i < n; i += 1) done(status);
      };
      if (reward && typeof options.beforeReward === "function") {
        let shown = false;
        record("cb:beforeReward");
        options.beforeReward(() => {
          record("showAdFn");
          if (shown) return;
          shown = true;
          rest();
        });
      } else {
        rest();
      }
    };

    switch (script) {
      case "viewed":
      case "dismissed":
      case "viewed-dismissed":
        return microtask(() => play(script));
      case "duplicate":
        return microtask(() => play("viewed", 2));
      case "late":
        held.push(() => play("viewed"));
        return undefined;
      case "stall":
        microtask(() => fire("beforeAd"));
        held.push(() => {
          if (reward) fire("adViewed");
          fire("afterAd");
          done("viewed");
        });
        return undefined;
      case "silent":
        return undefined;
      default:
        // A documented non-display status: no beforeAd/afterAd.
        return microtask(() => done(script));
    }
  };

  const sdk = {
    init(appConfig, adConfig) {
      record("init");
      sdk.lastInit = { appConfig, adConfig };
      if (opts.init === "throws") throw "init failed (mock)";
      if (opts.init === "rejects") return Promise.reject({ message: "init failed (mock)" });
      initialized = true;
      microtask(() => {
        if (opts.authError) reportAuth(null, { code: "auth_error", message: "sign-in failed" });
        else if (opts.auth !== "never") reportAuth(user, null);
      });
      return Promise.resolve();
    },
    onAuth(callback) {
      record("onAuth");
      authCallback = callback;
      if (pendingAuth) {
        const pending = pendingAuth;
        pendingAuth = null;
        callback(pending.value, pending.error);
      }
    },
    getUser() {
      record("getUser");
      return user;
    },
    showAd(options) {
      const o = options || {};
      record("showAd:" + (o.type || "start"));
      if (!initialized || !sdk.lastInit.adConfig) {
        return Promise.reject("Ads not initialized. Pass adConfig to init() to enable ads.");
      }
      const script = nextAd();
      if (script === "reject") return Promise.reject({ message: "ad script failed (mock)" });
      runAd(o, script);
      return Promise.resolve();
    },
    saveData(o) {
      record("saveData");
      try {
        needsToken();
      } catch (error) {
        return Promise.reject(error);
      }
      if (storageMode !== "ok") return Promise.reject(storageFailure());
      data.set(o.key, o.value);
      return Promise.resolve();
    },
    loadData(o) {
      record("loadData");
      try {
        needsToken();
      } catch (error) {
        return Promise.reject(error);
      }
      if (storageMode !== "ok") return Promise.reject(storageFailure());
      return Promise.resolve(data.has(o.key) ? data.get(o.key) : null);
    },
    removeData(o) {
      record("removeData");
      try {
        needsToken();
      } catch (error) {
        return Promise.reject(error);
      }
      if (storageMode !== "ok") return Promise.reject(storageFailure());
      data.delete(o.key);
      return Promise.resolve();
    },
    getPlatformLocale() {
      record("getPlatformLocale");
      return Promise.resolve(opts.locale || "en");
    },
  };

  const global = {
    sdk: () => sdk,
    emitReadyEvent: () => {
      record("emitReadyEvent");
      if (opts.ready !== "never") defer(dispatchReady);
    },
  };

  const install = () => {
    target.y8 = global;
    // The real script announces itself once, on a timer, when it runs.
    if (opts.ready !== "never") defer(dispatchReady);
    if (opts.ready === "twice") defer(dispatchReady);
  };
  if (opts.install !== false) install();

  return {
    global,
    sdk,
    calls,
    data,
    install,
    setAd: (script) => {
      adQueue = [].concat(script);
    },
    setStorage: (mode) => {
      storageMode = mode;
    },
    /** Sign a player in or out; reported through onAuth, as the SDK does. */
    setUser: (next) => {
      user = next;
      reportAuth(next, null);
    },
    /** Fire every held callback sequence (late / stall), in order. */
    release: () => {
      for (const fn of held.splice(0)) fn();
    },
  };
}
