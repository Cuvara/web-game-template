// src/game/integration.ts - the seam the integration (SDK) module wires. Game code calls
// these; it never calls a Platform method or a portal SDK directly.
//
// Template-owned: this is the Factory's INTEGRATION_CONTRACT (scripts/wgf_develop/brief.py)
// verbatim. main.ts hands the game a PlatformGameIntegration (src/platform/game-integration.ts)
// through GameContext.integration, so no step has to find and replace a construction site.
import type { EventProperties } from "@wgf/analytics-sdk";

export interface GameIntegration {
  /** Gameplay started or resumed / stopped (menus, game over, pause). */
  gameplayStart(): void;
  gameplayStop(): void;
  /** Whether a rewarded placement can be offered right now. Hide the offer when false. */
  canOfferRewarded(placement: string): boolean;
  /** Resolves true only when the reward must be granted. Never grant on anything else. */
  rewarded(placement: string): Promise<boolean>;
  /** A natural break. Resolves when play may continue, whether or not an ad showed. */
  interstitial(placement: string): Promise<void>;
  /** One analytics vocabulary; where it lands is wiring, not game code. */
  track(event: string, properties?: EventProperties): void;
  /** Persistence. Backed by cloud saves where the platform has them. */
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}
