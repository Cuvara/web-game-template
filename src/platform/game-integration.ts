// The game's integration seam, wired to the platform.
//
// Template-owned since contract 2 (ported from the Factory's scripts/wgf_sdk/game/src/
// platform/game-integration.ts). main.ts constructs one and hands it to the game as
// GameContext.integration, so there is no default implementation to find and replace. The
// game calls GameIntegration with its own placement ids; this looks each id up in the
// integration plan — which the Factory's `sdk` step builds from the game-design and from the
// ids the game source uses — and hands the moment to PlatformGameplay, which knows what that
// moment means on the platform the build is running on.

import { type GameIntegration } from "../game/integration.js";
import { gameplay, type PlatformGameplay } from "./gameplay.js";

type Properties = Parameters<GameIntegration["track"]>[1];

export class PlatformGameIntegration implements GameIntegration {
  // Resolved at call time, so the seam may be constructed before main.ts installs the
  // gameplay integration.
  get #gameplay(): PlatformGameplay {
    return gameplay();
  }

  gameplayStart(): void {
    this.#gameplay.runStarted();
  }

  gameplayStop(): void {
    this.#gameplay.runStopped();
  }

  canOfferRewarded(placement: string): boolean {
    const moment = this.#gameplay.momentOf(placement);
    return moment !== null && this.#gameplay.canOfferReward(moment);
  }

  async rewarded(placement: string): Promise<boolean> {
    const moment = this.#gameplay.momentOf(placement);
    if (moment === null) return false;
    return (await this.#gameplay.offerReward(moment)).rewarded;
  }

  async interstitial(placement: string): Promise<void> {
    // An id the plan does not know is still a natural break the game signalled: a portal
    // that wants an opportunity before every continue gets one.
    await this.#gameplay.naturalBreak(this.#gameplay.momentOf(placement));
  }

  track(event: string, properties?: Properties): void {
    const flat: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(properties ?? {})) flat[key] = value ?? null;
    this.#gameplay.track(event, flat);
  }

  async load(key: string): Promise<string | null> {
    try {
      return await this.#gameplay.platform.storage.get(key);
    } catch {
      return null;
    }
  }

  async save(key: string, value: string): Promise<void> {
    try {
      await this.#gameplay.platform.storage.set(key, value);
    } catch {
      this.#gameplay.track("save_failed", { key });
    }
  }
}
