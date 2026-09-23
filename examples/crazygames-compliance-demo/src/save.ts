// Progress, saved through the platform's storage — the CrazyGames Data module when the
// adapter has the SDK, and local storage only when it does not.
//
// One key holding one JSON document keeps the save atomic and far below the module's 1 MB
// limit. Reads are validated: a save written by an older build, or edited by hand, must
// not crash the boot.

import type { PlatformStorage } from "@wgf/platform-sdk";

export const SAVE_KEY = "orb-catcher.progress";

export interface Progress {
  readonly version: 1;
  readonly level: number;
  readonly coins: number;
  /** Level breaks since the rewarded offer was last SHOWN — taken or declined. */
  readonly levelsSinceOffer: number;
}

export const NEW_PROGRESS: Progress = { version: 1, level: 1, coins: 0, levelsSinceOffer: 0 };

export function parseProgress(raw: string | null): Progress {
  if (!raw) return NEW_PROGRESS;
  try {
    const value = JSON.parse(raw) as Partial<Progress>;
    const level = Number(value.level);
    const coins = Number(value.coins);
    const since = Number(value.levelsSinceOffer);
    if (!Number.isInteger(level) || level < 1 || !Number.isFinite(coins) || coins < 0) {
      return NEW_PROGRESS;
    }
    return {
      version: 1,
      level,
      coins: Math.floor(coins),
      levelsSinceOffer: Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0,
    };
  } catch {
    return NEW_PROGRESS;
  }
}

export async function loadProgress(storage: PlatformStorage): Promise<Progress> {
  try {
    return parseProgress(await storage.get(SAVE_KEY));
  } catch (error) {
    console.warn("could not read progress; starting fresh", error);
    return NEW_PROGRESS;
  }
}

/** Resolves false when the save failed, so the caller can say so instead of lying. */
export async function saveProgress(storage: PlatformStorage, progress: Progress): Promise<boolean> {
  try {
    await storage.set(SAVE_KEY, JSON.stringify(progress));
    return true;
  } catch (error) {
    console.warn("could not save progress", error);
    return false;
  }
}
