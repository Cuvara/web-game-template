// A stand-in for https://sdk.crazygames.com/crazygames-sdk-v3.js, served by page.route.
//
// Implements only the documented v3 surface the adapter uses, and records every call to
// window.__cgCalls__ so a test can assert on the exact sequence the portal would see. The
// behaviour is chosen per page load by query parameters, so the same built bundle is driven
// through every branch:
//
//   cgEnv=crazygames|local|disabled   SDK.environment (default crazygames)
//   cgAd=finish|unfilled|adblock|basic|cooldown|never|throw
//   cgAdMs=<ms>                       how long a filled ad "plays" (default 600)
//   cgAdDelayMs=<ms>                  auction time before adStarted/adError (default 200)
//   cgAdblock=1                       hasAdblock() resolves true
//   cgMute=1                          settings.muteAudio starts true
//   cgUser=1                          getUser() returns a logged-in user
//   cgData=disabled                   data.setItem throws dataModuleDisabled
//
// The data module persists to localStorage under one key, standing in for the cloud save,
// so a reload proves progress survives.
//
// Why a mock at all: the real SDK on localhost runs in `local` mode with demo overlays and
// cannot produce unfilled, adblock, cooldown or Basic Launch answers on demand. The live
// script is exercised separately by live-sdk.spec.ts.

export const MOCK_SDK_SOURCE = String.raw`
(() => {
  const params = new URLSearchParams(location.search);
  const env = params.get("cgEnv") || "crazygames";
  const adMode = params.get("cgAd") || "finish";
  const adMs = Number(params.get("cgAdMs") || 600);
  const adDelayMs = Number(params.get("cgAdDelayMs") || 200);
  const calls = (window.__cgCalls__ = []);
  const log = (name) => calls.push({ name, t: performance.now() });
  const settingsListeners = [];
  const settings = { disableChat: false, muteAudio: params.get("cgMute") === "1" };
  const STORE = "__cgmock_data__";
  const readStore = () => JSON.parse(localStorage.getItem(STORE) || "{}");
  const writeStore = (value) => localStorage.setItem(STORE, JSON.stringify(value));

  function guard() {
    if (env === "disabled") throw { code: "sdkDisabled", message: "SDK is disabled" };
  }

  const errors = {
    unfilled: "unfilled",
    adblock: "adblock",
    basic: "adsDisabledBasicLaunch",
    cooldown: "adCooldown",
  };

  window.__cgMock__ = {
    setMuteAudio(value) {
      settings.muteAudio = value;
      settingsListeners.forEach((listener) => listener({ ...settings }));
    },
    adPlaying: false,
  };

  window.CrazyGames = {
    SDK: {
      environment: env,
      async init() {
        log("init");
      },
      ad: {
        requestAd(type, callbacks = {}) {
          guard();
          log("requestAd:" + type);
          if (adMode === "throw") throw { code: "other", message: "mock throw" };
          if (adMode === "never") return;
          if (errors[adMode]) {
            setTimeout(() => {
              log("adError:" + errors[adMode]);
              callbacks.adError && callbacks.adError({ code: errors[adMode], message: adMode });
            }, adDelayMs);
            return;
          }
          setTimeout(() => {
            log("adStarted");
            window.__cgMock__.adPlaying = true;
            callbacks.adStarted && callbacks.adStarted();
            setTimeout(() => {
              log("adFinished");
              window.__cgMock__.adPlaying = false;
              callbacks.adFinished && callbacks.adFinished();
            }, adMs);
          }, adDelayMs);
        },
        async hasAdblock() {
          guard();
          return params.get("cgAdblock") === "1";
        },
      },
      game: {
        gameplayStart() { guard(); log("gameplayStart"); },
        gameplayStop() { guard(); log("gameplayStop"); },
        loadingStart() { guard(); log("loadingStart"); },
        loadingStop() { guard(); log("loadingStop"); },
        get settings() { return { ...settings }; },
        addSettingsChangeListener(listener) { settingsListeners.push(listener); },
        removeSettingsChangeListener() {},
        happytime() { log("happytime"); },
      },
      data: {
        getItem(key) { guard(); const v = readStore()[key]; return v === undefined ? null : v; },
        setItem(key, value) {
          guard();
          if (params.get("cgData") === "disabled") {
            throw { code: "dataModuleDisabled", message: "Data module disabled" };
          }
          log("data.setItem:" + key); const s = readStore(); s[key] = String(value); writeStore(s); },
        removeItem(key) { guard(); const s = readStore(); delete s[key]; writeStore(s); },
        clear() { guard(); writeStore({}); },
      },
      user: {
        get isUserAccountAvailable() { return env !== "disabled"; },
        get systemInfo() {
          return {
            countryCode: "US",
            locale: "en-US",
            device: { type: "desktop" },
            os: { name: "Windows", version: "10" },
            browser: { name: "Chrome", version: "120" },
            applicationType: "web",
          };
        },
        async getUser() {
          guard();
          return params.get("cgUser") === "1"
            ? { __dangerousUserId: "mock", username: "Mock.Player", profilePictureUrl: "" }
            : null;
        },
      },
    },
  };
})();
`;
