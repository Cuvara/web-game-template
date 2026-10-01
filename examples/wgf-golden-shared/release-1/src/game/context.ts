// What the release-1 boot bridge hands the game, and what the game hands back.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. TEMPORARY: see ../../README.md. A game created from a contract-1 template
// release (v1.2.0) has no src/game/context.ts; the replay writes this one beside the bridge
// main.ts, and both go away when the Factory pins a contract-2 release.
//
// The shape is the template's GameContext (src/game/context.ts on main), narrowed to what a
// contract-1 repository can provide before the Factory's `sdk` step runs: `integration` is
// the develop step's seam (src/game/integration.ts) and `gameplay` exposes only the running
// platform's gameplay state, which is all the golden ports read from it.

import type { Game, Renderer } from "@wgf/game-core";
import type { PlatformCapabilities } from "@wgf/platform-sdk";
import type { GameConfig } from "../core/game-config.js";
import type { I18n } from "../core/i18n.js";
import type { GameIntegration } from "./integration.js";

/** The platform as the game may see it: facts to adapt to, never methods to call. */
export interface PlatformInfo {
  readonly id: string;
  readonly target: string;
  readonly capabilities: PlatformCapabilities;
  readonly language: string | null;
}

/** The mute the platform requires: portal setting, an ad, lost focus, a portal overlay. */
export interface AudioGate {
  readonly muted: boolean;
  onMutedChange(listener: (muted: boolean) => void): () => void;
}

/** What contract 2's PlatformGameplay offers that a contract-1 repository can: its platform. */
export interface GameplayInfo {
  readonly platform: { readonly gameplayActive: boolean };
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface GameContext {
  readonly game: Game;
  readonly renderer: Renderer;
  readonly container: HTMLElement;
  readonly hud: HTMLElement;
  readonly ui: HTMLElement;
  readonly i18n: I18n;
  readonly integration: GameIntegration;
  readonly gameplay: GameplayInfo;
  readonly platform: PlatformInfo;
  readonly audio: AudioGate;
  readonly config: GameConfig;
  viewport(): ViewportSize;
  onResize(listener: (size: ViewportSize) => void): () => void;
  reportLoadingProgress(fraction: number): void;
}

/** The game's audio, as far as the platform is concerned: silence it and give it back. */
export interface GameAudio {
  mute(): void;
  unmute(): void;
}

export interface GameHandle {
  readonly audio?: GameAudio;
  dispose?(): void;
}

export type CreateGame = (context: GameContext) => Promise<GameHandle>;
