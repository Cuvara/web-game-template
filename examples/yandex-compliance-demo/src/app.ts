// The demo's flow: menu -> run -> game over -> (ad) -> run, with every interruption the
// portal can throw at it.
//
// This is the file the Yandex requirements are really about, and it contains no Yandex
// code. It talks to the Platform interface; the adapter turns that into SDK calls. What it
// owns is WHEN those calls happen:
//
//   GameplayAPI (1.19.3)  gameplay is "running" exactly when a run is on screen and nothing
//                         pauses it. sync() derives that and tells the platform on change.
//   Sound (1.3, 4.7)      audible only in focus, in the foreground, outside ads, unpaused.
//   Ads (4.4, 4.5)        interstitial only when the player asks for another run — a
//                         non-gameplay action, never before the first run, never mid-run.
//                         Rewarded only from a labelled button, and it grants a bonus
//                         (continue once), never access to the game itself.
//   Saves (1.9)           the record is written the moment a run ends.
//
// DOM, audio and input sit behind small ports so the whole flow runs in the unit tests
// against the real adapter and a fake SDK.

import type { Game, Scene } from "@wgf/game-core";
import type { AdResult, Platform } from "@wgf/platform-sdk";
import { CatchGame, type GameEvent, type GameInput } from "./game/catch-game.js";
import type { Cue } from "./audio.js";
import type { Screen, Translate } from "./ui.js";

export type Phase = "menu" | "playing" | "over" | "ad";

export interface UiPort {
  show(screen: Screen): void;
  setScore(score: number, lives: number): void;
  setBest(best: number): void;
  setSound(enabled: boolean): void;
  setOver(view: { score: number; best: number; newBest: boolean; canRevive: boolean }): void;
  setNote(text: string): void;
  setBusy(busy: boolean): void;
}

export interface SoundPort {
  readonly enabled: boolean;
  unlock(): void;
  setEnabled(enabled: boolean): void;
  setAllowed(allowed: boolean): void;
  setPad(wanted: boolean): void;
  play(cue: Cue): void;
}

export interface InputPort {
  read(): GameInput;
  reset(): void;
}

export interface ViewPort {
  draw(game: CatchGame | null): void;
}

export interface AppOptions {
  readonly game: Game;
  readonly platform: Platform;
  readonly ui: UiPort;
  readonly sound: SoundPort;
  readonly input: InputPort;
  readonly view: ViewPort;
  readonly t: Translate;
  readonly random?: () => number;
}

export const SAVE_BEST = "best";
export const SAVE_SOUND = "sound";

export class App implements Scene {
  readonly id = "catch";

  readonly #o: AppOptions;
  #phase: Phase = "menu";
  #run: CatchGame | null = null;
  #best = 0;
  #newBest = false;
  #manualPause = false;
  #visible = true;
  #focused = true;
  #unsubscribe: Array<() => void> = [];

  constructor(options: AppOptions) {
    this.#o = options;
  }

  get phase(): Phase {
    return this.#phase;
  }
  get best(): number {
    return this.#best;
  }
  get run(): CatchGame | null {
    return this.#run;
  }
  get manuallyPaused(): boolean {
    return this.#manualPause;
  }

  /** Read saves and subscribe to the portal. Part of loading: runs before Game Ready. */
  async load(): Promise<void> {
    const { platform } = this.#o;
    await this.#readSaves();

    this.#unsubscribe.push(
      platform.on("foreground:lost", () => this.#portalForeground(false)),
      platform.on("foreground:gained", () => this.#portalForeground(true)),
      // A rewarded video that opened after the game had given up on it was watched to the
      // end: the reward is still owed if the run it was for is still waiting (4.5).
      platform.on("ad:late-reward", () => this.#lateReward()),
      // The player picked another progress track in the portal's account dialog. The docs
      // say to go back to the menu and re-read the player's data.
      platform.on("storage:changed", () => void this.#savesReplaced()),
    );
    // The launch ad may already be up: the portal shows one at start with no callback.
    if (!platform.foreground) this.#o.game.pause("platform");

    this.#sync();
  }

  async #readSaves(): Promise<void> {
    const { platform, ui, sound } = this.#o;
    const best = Number(await platform.storage.get(SAVE_BEST));
    this.#best = Number.isFinite(best) && best > 0 ? Math.floor(best) : 0;
    sound.setEnabled((await platform.storage.get(SAVE_SOUND)) !== "off");
    ui.setBest(this.#best);
    ui.setSound(sound.enabled);
  }

  async #savesReplaced(): Promise<void> {
    if (this.#phase === "ad") return;
    await this.#readSaves();
    if (this.#phase !== "menu") await this.menu();
  }

  #lateReward(): void {
    if (this.#phase !== "over" || !this.#run?.revive()) return;
    this.#o.input.reset();
    this.#phase = "playing";
    this.#o.ui.setNote("");
    this.#sync();
  }

  dispose(): void {
    for (const off of this.#unsubscribe.splice(0)) off();
  }

  // --- Scene --------------------------------------------------------------------------

  update(stepMs: number): void {
    if (this.#phase !== "playing" || !this.#run) return;
    const events = this.#run.update(stepMs, this.#o.input.read());
    this.#o.ui.setScore(this.#run.score, this.#run.lives);
    for (const event of events) this.#onGameEvent(event);
  }

  render(): void {
    this.#o.view.draw(this.#phase === "menu" ? null : this.#run);
  }

  // --- Player actions -----------------------------------------------------------------

  play(): void {
    this.#o.sound.unlock();
    if (this.#phase !== "menu") return;
    this.#startRun();
  }

  /** Pause button or P. Toggles while a run is on screen. */
  togglePause(): void {
    if (this.#phase !== "playing") return;
    if (this.#manualPause) this.resume();
    else this.#pauseRun();
  }

  resume(): void {
    this.#o.sound.unlock();
    if (!this.#manualPause) return;
    this.#manualPause = false;
    this.#o.game.resume("manual");
    this.#sync();
  }

  async menu(): Promise<void> {
    if (this.#phase === "ad") return;
    const run = this.#run;
    if (run && this.#phase === "playing") await this.#recordBest(run.score);
    if (this.#manualPause) {
      this.#manualPause = false;
      this.#o.game.resume("manual");
    }
    this.#phase = "menu";
    this.#run = null;
    this.#o.ui.setBest(this.#best);
    this.#sync();
  }

  /** Another run. The player asked for it, so this is the logical break an ad may use. */
  async again(): Promise<AdResult | null> {
    if (this.#phase !== "over") return null;
    this.#o.sound.unlock();
    const result = await this.#withAd(() => this.#o.platform.showInterstitial());
    this.#startRun();
    return result;
  }

  /** Continue this run with one life, for a rewarded ad. Once per run. */
  async revive(): Promise<boolean> {
    if (this.#phase !== "over" || !this.#run?.canRevive) return false;
    this.#o.sound.unlock();
    const result = await this.#withAd(() => this.#o.platform.showRewarded());
    if (result.rewarded && this.#run.revive()) {
      this.#o.input.reset();
      this.#phase = "playing";
      this.#sync();
      return true;
    }
    this.#phase = "over";
    this.#showOver();
    this.#o.ui.setNote(this.#o.t(result.shown ? "over.noReward" : "over.adUnavailable"));
    this.#sync();
    return false;
  }

  async toggleSound(): Promise<void> {
    const enabled = !this.#o.sound.enabled;
    this.#o.sound.unlock();
    this.#o.sound.setEnabled(enabled);
    this.#o.ui.setSound(enabled);
    this.#sync();
    await this.#o.platform.storage.set(SAVE_SOUND, enabled ? "on" : "off");
  }

  // --- Focus signals --------------------------------------------------------------------

  visibility(visible: boolean): void {
    if (visible === this.#visible) return;
    this.#visible = visible;
    if (visible) {
      this.#o.game.resume("hidden");
    } else {
      this.#o.game.pause("hidden");
      // Coming back to a run in full flight costs lives. Hold it until the player says go.
      this.#pauseRun();
    }
    this.#sync();
  }

  focus(focused: boolean): void {
    if (focused === this.#focused) return;
    this.#focused = focused;
    if (!focused) this.#pauseRun();
    this.#sync();
  }

  // --- Internals ------------------------------------------------------------------------

  #portalForeground(foreground: boolean): void {
    if (foreground) {
      this.#o.game.resume("platform");
    } else {
      this.#o.game.pause("platform");
      // Our own ad already holds the "ad" reason; anything else (a purchase window, a tab
      // switch reported by the portal) interrupts a run and waits for the player.
      if (this.#phase !== "ad") this.#pauseRun();
    }
    this.#sync();
  }

  #pauseRun(): void {
    if (this.#phase !== "playing" || this.#manualPause) return;
    this.#manualPause = true;
    this.#o.game.pause("manual");
    this.#sync();
  }

  #startRun(): void {
    this.#run = new CatchGame(this.#o.random ? { random: this.#o.random } : {});
    this.#newBest = false;
    this.#o.input.reset();
    this.#phase = "playing";
    this.#o.ui.setScore(this.#run.score, this.#run.lives);
    this.#sync();
  }

  #onGameEvent(event: GameEvent): void {
    this.#o.sound.play(event);
    if (event === "over") void this.#endRun();
  }

  async #endRun(): Promise<void> {
    const run = this.#run;
    if (!run) return;
    this.#phase = "over";
    this.#newBest = run.score > this.#best;
    this.#showOver();
    this.#sync();
    await this.#recordBest(run.score);
  }

  #showOver(): void {
    const run = this.#run;
    if (!run) return;
    this.#o.ui.setOver({
      score: run.score,
      best: Math.max(this.#best, run.score),
      newBest: this.#newBest,
      canRevive: run.canRevive,
    });
  }

  /** Requirement 1.9: saved straight after the action, not at some later checkpoint. */
  async #recordBest(score: number): Promise<void> {
    if (score <= this.#best) return;
    this.#best = score;
    await this.#o.platform.storage.set(SAVE_BEST, String(score));
  }

  async #withAd<T extends AdResult>(show: () => Promise<T>): Promise<T> {
    const { game, ui } = this.#o;
    this.#phase = "ad";
    ui.setBusy(true);
    game.pause("ad");
    this.#sync();
    try {
      return await show();
    } finally {
      game.resume("ad");
      ui.setBusy(false);
      this.#sync();
    }
  }

  /** Derive everything the outside world sees from the current state. */
  #sync(): void {
    const { game, platform, ui, sound } = this.#o;
    const running = this.#phase === "playing" && !game.paused;

    if (running) platform.gameplayStart();
    else platform.gameplayStop();

    sound.setPad(this.#phase === "playing");
    sound.setAllowed(
      !game.paused && this.#visible && this.#focused && platform.foreground && this.#phase !== "ad",
    );

    let screen: Screen;
    if (this.#phase === "playing") screen = this.#manualPause ? "paused" : "playing";
    else if (this.#phase === "ad") screen = "over";
    else screen = this.#phase;
    ui.show(screen);
  }
}
