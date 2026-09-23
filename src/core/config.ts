// The running game's copy of game.config.yaml.
//
// Injected by the vite plugin and already run through validateGameConfig at build time — a
// malformed config failed the build, so the assertion here is safe. Import from this module
// rather than from the virtual one so there is a single place to look when tracing a value
// back to the plan it came from.

import buildTarget from "virtual:build-target";
import rawConfig from "virtual:game-config";
import type { GameConfig, PlatformEntry } from "./game-config.js";

export const config = rawConfig as GameConfig;

/**
 * The platform this build targets: the one it was built for (WGF_PLATFORM, validated at
 * build time), else the first required entry, else the first entry.
 */
export function primaryPlatform(): PlatformEntry {
  const entry =
    (buildTarget
      ? config.platforms.find((candidate) => candidate.id === buildTarget)
      : undefined) ??
    config.platforms.find((candidate) => candidate.role === "required") ??
    config.platforms[0];
  if (!entry) throw new Error("game.config.yaml declares no platforms");
  return entry;
}
