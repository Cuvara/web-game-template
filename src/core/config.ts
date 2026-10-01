// The running game's copy of game.config.yaml.
//
// Injected by the vite plugin and already run through validateGameConfig at build time — a
// malformed config failed the build, so the assertion here is safe. Import from this module
// rather than from the virtual one so there is a single place to look when tracing a value
// back to the plan it came from.

import rawConfig, { targetPlatformId } from "virtual:game-config";
import type { CreatePlatformOptions } from "@wgf/platform-sdk";
import type { GameConfig, PlatformEntry } from "./game-config.js";

export const config = rawConfig as GameConfig;

/**
 * The platform this build is for. Fixed at build time: WGF_TARGET_PLATFORM, else the first
 * required entry, else the first entry (resolveTargetPlatform in ./game-config.ts). The
 * bundle contains this platform's adapter and no other.
 */
export function targetPlatform(): PlatformEntry {
  const entry = config.platforms.find((candidate) => candidate.id === targetPlatformId);
  if (!entry) throw new Error(`the build target "${targetPlatformId}" is not in platforms[]`);
  return entry;
}

/** @deprecated Use targetPlatform(). Kept so games written against contract 1 still build. */
export const primaryPlatform = targetPlatform;

/**
 * Everything the adapter for `entry` needs: the storage namespace, plus that portal's ids —
 * already validated, and already overridden from the build environment, by the plugin.
 */
export function platformOptions(entry: PlatformEntry): CreatePlatformOptions {
  return {
    namespace: config.game.id,
    ...(entry.id === "gamedistribution" && entry.game_id
      ? { gamedistribution: { gameId: entry.game_id } }
      : {}),
    ...(entry.id === "gamemonetize" ? { portalGameId: entry.game_id ?? null } : {}),
    ...(entry.id === "y8"
      ? { y8: entry.app_id ? { appId: entry.app_id, gameId: entry.game_id ?? null } : null }
      : {}),
  };
}
