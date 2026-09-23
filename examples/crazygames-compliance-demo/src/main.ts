// Orb Catcher — the CrazyGames compliance demo.
//
//   Boot -> SDK init -> Loading -> First gameplay -> Gameplay state -> Ad -> Resume -> Save
//
// Everything platform-facing goes through the `Platform` contract from @wgf/platform-sdk;
// nothing here reads `window.CrazyGames`. What each step is answering:
//
//   Land directly in gameplay (Full Launch) ... no menu; the first level starts on load.
//   gameplayStart on the first playable frame . reported once the level is live, which is
//                                              what CrazyGames measures initial download to.
//   gameplayStop on every break ............... level complete; gameplayStart on next level.
//   Midgame only at a natural break ........... requested from "Next level", never mid-level
//                                              and never from a navigation button.
//   Paused and input-blocked through the ad ... Game.pause("ad") + #ad-shield from request
//                                              until adFinished/adError.
//   Muted only while the ad plays ............. ad:start / ad:end, not the request.
//   First midgame after real play ............. no midgame before level 3 is done.
//   Rewarded: optional, occasional, labelled .. offered on at most one break in three,
//                                              whether or not it is taken; same-size
//                                              buttons, a coins alternative, hidden when ads
//                                              cannot play, reward only when confirmed.
//   No chained ads ............................ no midgame on a break that already had a
//                                              rewarded ad.
//   Progress in the Data module ............... saved at every level end.

import { Game } from "@wgf/game-core";
import { createPlatform, type Platform } from "@wgf/platform-sdk";
import { PixiRenderer } from "@wgf/pixi-framework";
import { Audio } from "./audio.js";
import { loadStrings, pickLocale, type Strings } from "./i18n.js";
import { OrbScene } from "./orb-scene.js";
import { loadProgress, saveProgress, type Progress } from "./save.js";
import { levelSpec } from "./simulation.js";
import { installDemoProbe, type DemoPhase } from "./probe.js";
import { keyLabels, type LayoutMapSource } from "./keys.js";

const GAME_ID = "orb-catcher";
/**
 * A rewarded offer on at most one break in three, counted from the last OFFER rather than
 * the last watch, so declining it does not make it reappear at every break.
 */
const REWARDED_EVERY_LEVELS = 3;
/**
 * No midgame before this many levels are done, ever. CrazyGames' pacing guide suggests level
 * 3-4 and the requirement is "a reasonable amount of gameplay" first. This counts levels
 * across sessions: a returning player past level 3 can get a midgame request at the first
 * break of a new session, where the SDK's own start-of-session protection is what applies.
 * https://docs.crazygames.com/resources/midgame-ads-pacing/
 */
const MIDGAME_FROM_LEVEL = 3;
/** How long the level-complete panel ignores input after appearing. */
const PANEL_INPUT_GUARD_MS = 350;
/** The alternative to watching an ad: the same bonus bought with coins. */
const DOUBLE_PRICE_COINS = 15;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found as T;
}

const ui = {
  game: byId("game"),
  hud: byId("hud"),
  hudLevel: byId("hud-level"),
  hudCaught: byId("hud-caught"),
  hudCoins: byId("hud-coins"),
  hint: byId("hint"),
  loading: byId("loading"),
  loadingText: byId("loading-text"),
  loadingFill: byId("loading-fill"),
  complete: byId("complete"),
  completeTitle: byId("complete-title"),
  completeEarned: byId("complete-earned"),
  completeNote: byId("complete-note"),
  next: byId<HTMLButtonElement>("btn-next"),
  doubleAd: byId<HTMLButtonElement>("btn-double-ad"),
  doubleCoins: byId<HTMLButtonElement>("btn-double-coins"),
  adShield: byId("ad-shield"),
};

// Default browser behaviour that reads as a bug inside a portal iframe: page scroll on the
// wheel, arrow/space scrolling, the context menu. From CrazyGames' HTML5 "common fixes".
function suppressBrowserDefaults(): void {
  window.addEventListener("wheel", (event) => event.preventDefault(), { passive: false });
  window.addEventListener("keydown", (event) => {
    const onButton = event.target instanceof HTMLButtonElement;
    // Space still activates a focused button; it only stops scrolling the page.
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
    } else if (event.key === " " && !onButton) {
      event.preventDefault();
    }
  });
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

class Demo {
  readonly #platform: Platform;
  readonly #game = new Game();
  readonly #audio = new Audio();
  readonly #renderer = new PixiRenderer();
  #strings!: Strings;
  #progress!: Progress;
  #scene: OrbScene | null = null;
  #phase: DemoPhase = "loading";
  #earned = 0;
  #rewardedThisBreak = false;
  #offerThisBreak = false;
  /**
   * The SDK has no documented way to ask whether ads are on; the only signal is the answer
   * to a request (`adsDisabledBasicLaunch` in Basic Launch). So no rewarded offer appears in
   * a session until one midgame request has been answered — otherwise a Basic Launch build
   * would show a rewarded button with no effect, a named rejection cause.
   */
  #adAnswered = false;
  #lastSaveOk: boolean | null = null;

  constructor(platform: Platform) {
    this.#platform = platform;
  }

  async boot(): Promise<void> {
    const platform = this.#platform;
    this.#setLoading(0.05);

    // SDK init — the adapter awaits CrazyGames.SDK.init() and reports loadingStart.
    await platform.initialize();
    this.#setLoading(0.3);

    this.#strings = await loadStrings(pickLocale(platform.environment.locale, navigator.languages));
    document.documentElement.lang = this.#strings.locale;
    ui.loadingText.textContent = this.#strings.t("loading");
    this.#setLoading(0.5);

    await this.#renderer.init({
      container: ui.game,
      width: ui.game.clientWidth || window.innerWidth,
      height: ui.game.clientHeight || window.innerHeight,
      background: 0x14121f,
    });
    window.addEventListener("resize", () =>
      this.#renderer.resize(ui.game.clientWidth, ui.game.clientHeight),
    );
    this.#setLoading(0.8);

    this.#progress = await loadProgress(platform.storage);
    this.#setLoading(1);

    this.#bindPlatform();
    this.#bindButtons();

    await platform.signalReady(); // loadingStop
    ui.loading.hidden = true;

    installDemoProbe({
      game: this.#game,
      platform,
      audio: this.#audio,
      phase: () => this.#phase,
      progress: () => this.#progress,
      scene: () => this.#scene,
      lastSaveOk: () => this.#lastSaveOk,
    });

    this.#game.start();
    await this.#startLevel();
  }

  #bindPlatform(): void {
    const platform = this.#platform;
    if (platform.settings.muteAudio) this.#audio.mute("platform");
    platform.events.on("settings:change", ({ muteAudio }) => {
      if (muteAudio) this.#audio.mute("platform");
      else this.#audio.unmute("platform");
    });
    // Mute on the ad actually starting. And hold the game for ANY ad that starts — including
    // one that starts after the adapter gave up waiting and the next level already began:
    // "Video ads can not interrupt gameplay" means an ad on screen always means a paused game.
    platform.events.on("ad:start", () => {
      this.#audio.mute("ad");
      this.#game.pause("ad");
      ui.adShield.hidden = false;
      if (this.#phase === "playing") platform.gameplayStop();
    });
    platform.events.on("ad:end", () => {
      this.#audio.unmute("ad");
      if (this.#phase === "ad") return; // #adBreak releases its own hold
      ui.adShield.hidden = true;
      this.#game.resume("ad");
      if (this.#phase === "playing" && !this.#game.paused) platform.gameplayStart();
    });

    // The game pauses on a hidden tab. Whether the portal is told is the adapter's call —
    // CrazyGames detects focus loss itself and asks not to be.
    document.addEventListener("visibilitychange", () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) this.#game.pause("hidden");
      else this.#game.resume("hidden");
      if (!platform.capabilities.gameplayStopOnHidden || this.#phase !== "playing") return;
      if (hidden) platform.gameplayStop();
      else if (!this.#game.paused) platform.gameplayStart();
    });
  }

  #bindButtons(): void {
    ui.next.addEventListener("click", () => void this.#onNext());
    ui.doubleAd.addEventListener("click", () => void this.#onDoubleWithAd());
    ui.doubleCoins.addEventListener("click", () => void this.#onDoubleWithCoins());
  }

  async #startLevel(): Promise<void> {
    const spec = levelSpec(this.#progress.level);
    const showHint = this.#progress.level === 1 && this.#progress.coins === 0;
    this.#scene = new OrbScene({
      renderer: this.#renderer,
      spec,
      showHint,
      onCatch: (caught, goal) => {
        ui.hudCaught.textContent = this.#strings.t("hud.caught", { caught, goal });
        this.#audio.blip(660 + caught * 30);
      },
      onComplete: () => void this.#onLevelComplete(),
      onHintDone: () => {
        ui.hint.hidden = true;
      },
    });
    await this.#game.changeScene(this.#scene);

    ui.hudLevel.textContent = this.#strings.t("hud.level", { level: spec.level });
    ui.hudCaught.textContent = this.#strings.t("hud.caught", { caught: 0, goal: spec.goal });
    this.#renderCoins();
    if (showHint) {
      byId("hint-goal").textContent = this.#strings.t("hint.goal");
      byId("hint-pointer").textContent = this.#strings.t("hint.controls.pointer");
      byId("hint-keys").textContent = this.#strings.t("hint.controls.keys", {
        keys: await keyLabels(navigator as LayoutMapSource),
      });
      ui.hint.hidden = false;
    }

    ui.complete.hidden = true;
    this.#setPhase("playing");
    // The level is live and responding to input: this is the first playable state.
    this.#platform.gameplayStart();
  }

  async #onLevelComplete(): Promise<void> {
    // A break: stop gameplay before any menu appears, so an ad requested from it is at a
    // natural break by construction.
    this.#platform.gameplayStop();
    this.#setPhase("level-complete");
    this.#audio.blip(990, 0.25);

    const spec = levelSpec(this.#progress.level);
    this.#earned = spec.goal;
    this.#rewardedThisBreak = false;
    const since = this.#progress.levelsSinceOffer + 1;
    // Decided once per break. Showing the offer resets the count, taken or not.
    this.#offerThisBreak = this.#adAnswered && since >= REWARDED_EVERY_LEVELS;
    this.#progress = {
      ...this.#progress,
      level: this.#progress.level + 1,
      coins: this.#progress.coins + this.#earned,
      levelsSinceOffer: this.#offerThisBreak ? 0 : since,
    };
    await this.#save();

    ui.completeTitle.textContent = this.#strings.t("complete.title", { level: spec.level });
    ui.completeEarned.textContent = this.#strings.t("complete.earned", { coins: this.#earned });
    ui.completeNote.textContent = this.#lastSaveOk ? "" : this.#strings.t("complete.save.failed");
    ui.next.textContent = `▶ ${this.#strings.t("complete.next")}`;
    this.#renderCoins();
    this.#renderOffers();
    // A tap or click already on its way when the panel appears must not land on a button —
    // least of all "Watch ad": an ad the player did not choose is a deceptive trigger. The
    // guard is shorter than a deliberate reaction and invisible, not a delay to confuse.
    ui.complete.inert = true;
    ui.complete.hidden = false;
    setTimeout(() => {
      ui.complete.inert = false;
    }, PANEL_INPUT_GUARD_MS);
  }

  #renderOffers(): void {
    const offered = this.#offerThisBreak && !this.#rewardedThisBreak;
    const availability = this.#platform.adAvailability("rewarded");

    // No rewarded button that cannot work — Basic Launch, a disabled SDK. With an ad blocker
    // the offer is replaced by a notice rather than hidden without explanation.
    ui.doubleAd.hidden = !offered || availability !== "available";
    ui.doubleAd.textContent = `🎬 ${this.#strings.t("complete.double.ad")}`;
    if (offered && availability === "adblock") {
      ui.completeNote.textContent = this.#strings.t("complete.ad.adblock");
    }

    ui.doubleCoins.hidden = this.#rewardedThisBreak;
    ui.doubleCoins.disabled = this.#progress.coins < DOUBLE_PRICE_COINS + this.#earned;
    ui.doubleCoins.textContent = `🪙 ${this.#strings.t("complete.double.coins", {
      price: DOUBLE_PRICE_COINS,
    })}`;
  }

  async #onDoubleWithAd(): Promise<void> {
    if (this.#phase !== "level-complete") return;
    const result = await this.#adBreak(() => this.#platform.showRewarded());
    if (result.rewarded) {
      this.#rewardedThisBreak = true;
      this.#progress = { ...this.#progress, coins: this.#progress.coins + this.#earned };
      await this.#save();
      ui.completeNote.textContent = this.#afterSave("complete.doubled");
      this.#audio.blip(1320, 0.3);
    } else {
      ui.completeNote.textContent = this.#strings.t(
        result.reason === "adblock" ? "complete.ad.adblock" : "complete.ad.unavailable",
      );
    }
    this.#renderCoins();
    this.#renderOffers();
  }

  async #onDoubleWithCoins(): Promise<void> {
    if (this.#phase !== "level-complete") return;
    if (this.#progress.coins < DOUBLE_PRICE_COINS + this.#earned) return;
    this.#rewardedThisBreak = true;
    this.#progress = {
      ...this.#progress,
      coins: this.#progress.coins - DOUBLE_PRICE_COINS + this.#earned,
    };
    await this.#save();
    ui.completeNote.textContent = this.#afterSave("complete.doubled");
    this.#renderCoins();
    this.#renderOffers();
  }

  async #onNext(): Promise<void> {
    if (this.#phase !== "level-complete") return;
    // One ad per break: after a rewarded ad, straight on. And none until real play is done.
    const completed = this.#progress.level - 1;
    if (!this.#rewardedThisBreak && completed >= MIDGAME_FROM_LEVEL) {
      await this.#adBreak(() => this.#platform.showInterstitial());
      // Any answer — shown, unfilled, cooldown, disabled — tells adAvailability what it
      // needs. A local too-soon only happens after an ad already played this session.
      this.#adAnswered = true;
    }
    await this.#startLevel();
  }

  /**
   * Hold the game still from the moment an ad is requested until the platform answers:
   * paused loop, a shield over every input, gameplay not reported. Audio is handled
   * separately, by ad:start/ad:end, because an unfilled request should not blip the sound.
   */
  async #adBreak<T>(request: () => Promise<T>): Promise<T> {
    const previous = this.#phase;
    this.#setPhase("ad");
    this.#game.pause("ad");
    ui.adShield.hidden = false;
    ui.next.disabled = true;
    ui.doubleAd.disabled = true;
    try {
      return await request();
    } finally {
      ui.adShield.hidden = true;
      ui.next.disabled = false;
      ui.doubleAd.disabled = false;
      this.#game.resume("ad");
      this.#setPhase(previous);
    }
  }

  async #save(): Promise<void> {
    this.#lastSaveOk = await saveProgress(this.#platform.storage, this.#progress);
  }

  /** A confirmation that never hides a failed save behind it. */
  #afterSave(key: string): string {
    const message = this.#strings.t(key);
    return this.#lastSaveOk ? message : `${message} ${this.#strings.t("complete.save.failed")}`;
  }

  #renderCoins(): void {
    ui.hudCoins.textContent = this.#strings.t("hud.coins", { coins: this.#progress.coins });
  }

  #setLoading(fraction: number): void {
    this.#platform.reportLoadingProgress(fraction);
    ui.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  #setPhase(phase: DemoPhase): void {
    this.#phase = phase;
    ui.hud.dataset["phase"] = phase;
  }
}

async function main(): Promise<void> {
  suppressBrowserDefaults();
  const platform = createPlatform("crazygames", { namespace: GAME_ID });
  await new Demo(platform).boot();
}

void main().catch((error: unknown) => {
  // A boot failure must be visible; a black screen is the worst possible review outcome.
  ui.loading.hidden = false;
  ui.loadingText.textContent = `Something went wrong: ${
    error instanceof Error ? error.message : String(error)
  }`;
  ui.hud.dataset["phase"] = "failed";
  console.error(error);
});
