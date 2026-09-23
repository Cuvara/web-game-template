// A stand-in for Yandex's /sdk.js, served by the e2e suite in place of the real script.
//
// Test-only: it is fulfilled through page.route() and never enters the build. It
// implements the documented surface the adapter uses — nothing else — and behaves the way
// the docs say the real one does:
//   - YaGames.init() resolves to an sdk object          (sdk/sdk-about)
//   - environment.i18n.lang                              (sdk/sdk-environment)
//   - features.LoadingAPI / GameplayAPI                  (sdk/sdk-game-events)
//   - on/off('game_api_pause' | 'game_api_resume')       (sdk/sdk-events), fired around every
//     fullscreen and rewarded ad, and optionally around a launch ad with no callbacks
//   - adv.showFullscreenAdv / showRewardedVideo callbacks (sdk/sdk-adv)
//   - getPlayer() -> isAuthorized, getData, setData     (sdk/sdk-player)
//
// Behaviour is set by the test through window.__ysdkMockConfig before the page loads.
// Every call is appended to window.__ysdk.calls so the test can assert order and count.
// Player data lives in localStorage under a separate key, so a reload behaves like the
// cloud: the game's own mirror can be cleared to prove the value came from the player.

(function () {
  const config = Object.assign(
    {
      lang: "en",
      launchAdMs: 0,
      fullscreen: "show", // show | unshown | error | never
      rewarded: "complete", // complete | skip | error
      adMs: 300,
      playerError: false,
    },
    window.__ysdkMockConfig || {},
  );
  const DATA_KEY = "__ysdk_mock_player_data__";
  // `gameplay` is the portal's own view of GameplayAPI — what the debug panel's gamepad
  // indicator shows. The portal stops it on game_api_pause and starts it again on
  // game_api_resume, unless the game had stopped it before the pause (sdk-events).
  const state = {
    calls: [],
    listeners: { game_api_pause: [], game_api_resume: [] },
    gameplay: false,
    autoRestart: false,
  };
  window.__ysdk = state;

  const record = (name, extra) =>
    state.calls.push(Object.assign({ name, t: performance.now() }, extra || {}));
  const fire = (event) => {
    record(event);
    if (event === "game_api_pause") {
      state.autoRestart = state.gameplay;
      state.gameplay = false;
    }
    for (const listener of state.listeners[event].slice()) listener();
    if (event === "game_api_resume" && state.autoRestart) {
      state.autoRestart = false;
      state.gameplay = true;
      record("GameplayAPI.start(auto)");
    }
  };
  state.fire = fire;
  const later = (ms, fn) => setTimeout(fn, ms);

  function runAd(kind, mode, callbacks) {
    if (mode === "never") return;
    if (mode === "error") {
      later(20, () => {
        if (callbacks.onError) callbacks.onError(new Error("mock ad error"));
        if (kind === "fullscreen" && callbacks.onClose) callbacks.onClose(false);
      });
      return;
    }
    if (mode === "unshown") {
      later(20, () => {
        if (callbacks.onClose) callbacks.onClose(false);
      });
      return;
    }
    later(20, () => {
      fire("game_api_pause");
      if (callbacks.onOpen) callbacks.onOpen();
      record(`${kind}:open`);
      later(config.adMs, () => {
        if (kind === "rewarded" && mode === "complete") {
          record("rewarded:granted");
          if (callbacks.onRewarded) callbacks.onRewarded();
        }
        if (callbacks.onClose) callbacks.onClose(true);
        record(`${kind}:close`);
        fire("game_api_resume");
      });
    });
  }

  const sdk = {
    environment: { app: { id: "mock" }, i18n: { lang: config.lang } },
    features: {
      LoadingAPI: {
        ready() {
          const menu = document.querySelector('section[data-screen="menu"]');
          record("LoadingAPI.ready", {
            menuVisible: !!menu && !menu.hidden,
            bootGone: !document.getElementById("boot"),
          });
        },
      },
      GameplayAPI: {
        start: () => {
          state.gameplay = true;
          record("GameplayAPI.start");
        },
        stop: () => {
          // Deliberately does not cancel a pending auto-restart: the docs only promise that
          // a stop() made BEFORE the pause prevents it, so a stop() made in reaction to the
          // pause is modelled as not preventing it. The adapter has to cope.
          state.gameplay = false;
          record("GameplayAPI.stop");
        },
      },
    },
    adv: {
      showFullscreenAdv({ callbacks }) {
        record("showFullscreenAdv");
        runAd("fullscreen", config.fullscreen, callbacks || {});
      },
      showRewardedVideo({ callbacks }) {
        record("showRewardedVideo");
        runAd("rewarded", config.rewarded, callbacks || {});
      },
    },
    async getPlayer() {
      record("getPlayer");
      if (config.playerError) throw new Error("mock getPlayer failure");
      return {
        isAuthorized: () => false,
        async getData() {
          record("getData");
          return JSON.parse(localStorage.getItem(DATA_KEY) || "{}");
        },
        async setData(data, flush) {
          record("setData", { data, flush });
          localStorage.setItem(DATA_KEY, JSON.stringify(data));
        },
      };
    },
    on(event, listener) {
      record(`on:${event}`);
      state.listeners[event].push(listener);
      return () => sdk.off(event, listener);
    },
    off(event, listener) {
      state.listeners[event] = state.listeners[event].filter((l) => l !== listener);
    },
  };

  window.YaGames = {
    async init() {
      record("YaGames.init");
      if (config.launchAdMs > 0) {
        // The portal's own launch ad: no callbacks, only the pause/resume pair.
        setTimeout(() => fire("game_api_pause"), 0);
        setTimeout(() => fire("game_api_resume"), config.launchAdMs);
      }
      return sdk;
    },
  };
})();
