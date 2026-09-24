// What main.ts hands the game, and what the game hands back.
//
// Template-owned. src/game/index.ts is the one entry a game implements —
// `createGame(context): Promise<GameHandle>` — and everything it needs from the template
// arrives here, already wired: the loop, the renderer, the DOM roots, strings, the platform
// seam. The boot order (platform, loading progress, ready, first-input gameplay) stays in
// main.ts, where no game edit can reorder it; a portal rejection for "gameplayStart at load"
// or "no loading progress" is then impossible to introduce from game code.

import type { Game, Renderer } from "@wgf/game-core";
import type { PlatformCapabilities } from "@wgf/platform-sdk";
import type { GameConfig } from "../core/game-config.js";
import type { I18n } from "../core/i18n.js";
import type { GameplayAudio, PlatformGameplay } from "../platform/gameplay.js";
import type { GameIntegration } from "./integration.js";

/** The platform as the game may see it: facts to adapt to, never methods to call. */
export interface PlatformInfo {
  /** The adapter actually running (a substitute or the SDK-free fallback can differ). */
  readonly id: string;
  /** The platform id the build targets. */
  readonly target: string;
  readonly capabilities: PlatformCapabilities;
  /** The portal's language for this player, or null. i18n already follows it. */
  readonly language: string | null;
}

/** The mute the platform requires: portal setting, an ad, lost focus, a portal overlay. */
export interface AudioGate {
  /** True while the game must be silent. Outranks any in-game sound toggle. */
  readonly muted: boolean;
  /** Called on every change. Returns the unsubscribe. */
  onMutedChange(listener: (muted: boolean) => void): () => void;
}

export interface ViewportSize {
  /** CSS pixels of #game. */
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface GameContext {
  readonly game: Game;
  /** Already initialised on {@link container}, and resized by main.ts. */
  readonly renderer: Renderer;
  /** #game: the element the renderer draws into. */
  readonly container: HTMLElement;
  /**
   * #hud: the probe element. main.ts owns data-ready, data-scene, data-steps, data-engine
   * and data-platform on it; the game may set its text and other data attributes.
   */
  readonly hud: HTMLElement;
  /** #ui: the DOM overlay root for menus and screens. main.ts creates it when absent. */
  readonly ui: HTMLElement;
  readonly i18n: I18n;
  /** The seam every platform call goes through (ads, gameplay start/stop, saves, events). */
  readonly integration: GameIntegration;
  /** The same seam at moment level (gameOver, levelComplete, offerReward …). */
  readonly gameplay: PlatformGameplay;
  readonly platform: PlatformInfo;
  readonly audio: AudioGate;
  readonly config: GameConfig;
  /** The current size of #game. */
  viewport(): ViewportSize;
  /**
   * Called after the renderer has been resized: window resize, visual viewport change
   * (mobile URL bar, pinch zoom) or device pixel ratio change (moving between screens).
   * Returns the unregister.
   */
  onResize(listener: (size: ViewportSize) => void): () => void;
  /**
   * Loading progress of the game's own work (assets) in [0, 1]. main.ts maps it into the
   * portal's loading bar between renderer init and ready.
   */
  reportLoadingProgress(fraction: number): void;
}

export interface GameHandle {
  /**
   * The game's audio. The platform silences it for ad breaks and whenever the portal
   * requires ({@link GameContext.audio}), and gives it back afterwards.
   */
  readonly audio?: GameplayAudio;
  /** Release whatever createGame set up. Called on page hide for good (pagehide). */
  dispose?(): void;
}

export type CreateGame = (context: GameContext) => Promise<GameHandle>;
