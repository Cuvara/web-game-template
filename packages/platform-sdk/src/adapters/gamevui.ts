// GameVui — a portal with no developer SDK.
//
// GameVui (gamevui.vn) publishes no SDK, no developer documentation and no integration
// contract; submission is by email (docs/platforms/gamevui/platform-contract.md). The
// portal does inject its own script, `score.min.js`, into hosted games — it carries a score
// submission and a rewarded ad break — but that script is undocumented, served only on the
// portal's own host, and pays out to the portal's own AdSense account. A third-party build
// cannot honestly target it, so this adapter does not call it and must never load it.
//
// What is left is the honest adapter: the same Platform contract as every other target,
// with nothing to initialize, no ad the game can request, saves in local storage, and the
// game pausing itself when the tab hides. The capabilities below differ from the Factory
// profile (gamevui@1.0.0 lists interstitial and banner ads) on purpose: those are ads the
// portal shows around the game, not ads the game can ask for. Claiming them here would let
// a game build an offer that never plays.
//
// Re-checked 2026-09-23 against gamevui.vn/support/{contact,terms,help}; /developer, /sdk
// and /api do not exist. Revisit only if the operator publishes an integration contract.

import { NoSdkPlatform, type GenericWebOptions } from "./generic-web.js";
import type { PlatformCapabilities } from "../types.js";

export const GAMEVUI_CAPABILITIES: PlatformCapabilities = {
  ads: [],
  iap: false,
  cloudSaves: false,
  leaderboards: false,
  achievements: false,
  auth: "none",
  analytics: "self-hosted",
  loadingApi: "optional",
  interstitialMinIntervalS: null,
  gameplayStopOnHidden: true,
};

export class GameVuiPlatform extends NoSdkPlatform {
  declare readonly id: "gamevui";

  constructor(options: GenericWebOptions) {
    super("gamevui", GAMEVUI_CAPABILITIES, options);
  }
}
