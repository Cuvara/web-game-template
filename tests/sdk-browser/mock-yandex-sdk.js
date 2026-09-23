// A stand-in for Yandex Games' /sdk.js, served by Playwright in its place. Tests never reach
// Yandex: a run must not depend on the network or send test traffic to the portal.
//
// It implements the documented surface the adapter uses (packages/platform-sdk/src/adapters/
// yandex-sdk.ts lists the doc page for each member) and records every call in
// window.__yaCalls. window.__yaFire(event) raises a portal event such as game_api_pause.
// Behaviour per test through window.__yaMock before the page loads:
//   init: "resolve" | "reject"
(() => {
  const config = Object.assign({ init: "resolve" }, window.__yaMock || {});
  const calls = (window.__yaCalls = []);
  const listeners = new Map();
  const data = {};
  const sdk = {
    environment: { app: { id: "smoke" }, i18n: { lang: "ru" } },
    features: {
      LoadingAPI: { ready: () => calls.push("LoadingAPI.ready") },
      GameplayAPI: {
        start: () => calls.push("GameplayAPI.start"),
        stop: () => calls.push("GameplayAPI.stop"),
      },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => {
        calls.push("adv.showFullscreenAdv");
        callbacks.onOpen?.();
        callbacks.onClose?.(true);
      },
      showRewardedVideo: ({ callbacks }) => {
        calls.push("adv.showRewardedVideo");
        callbacks.onOpen?.();
        callbacks.onRewarded?.();
        callbacks.onClose?.(true);
      },
    },
    EVENTS: {
      ACCOUNT_SELECTION_DIALOG_OPENED: "ACCOUNT_SELECTION_DIALOG_OPENED",
      ACCOUNT_SELECTION_DIALOG_CLOSED: "ACCOUNT_SELECTION_DIALOG_CLOSED",
    },
    getPlayer: async () => ({
      isAuthorized: () => false,
      getData: async () => ({ ...data }),
      setData: async (next) => {
        calls.push("player.setData");
        Object.assign(data, next);
      },
    }),
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    off: (event, listener) => listeners.get(event)?.delete(listener),
  };
  window.__yaFire = (event) => listeners.get(event)?.forEach((listener) => listener());
  window.YaGames = {
    init: () => {
      calls.push("YaGames.init");
      return config.init === "reject" ? Promise.reject(new Error("mock")) : Promise.resolve(sdk);
    },
  };
})();
