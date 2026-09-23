// Save and load through the platform's storage.
//
// Never localStorage directly: the platform's backend is what survives private browsing.
// A save that is missing, from an older version, or corrupt loads as a fresh one — a
// damaged save must cost the player their best score, never the game.

import type { PlatformStorage } from "@wgf/platform-sdk";

export interface SaveData {
  readonly version: 1;
  readonly best: number;
  readonly runs: number;
}

const KEY = "save";
export const FRESH_SAVE: SaveData = { version: 1, best: 0, runs: 0 };

export async function loadSave(storage: PlatformStorage): Promise<SaveData> {
  try {
    const raw = await storage.get(KEY);
    if (!raw) return FRESH_SAVE;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (parsed.version !== 1) return FRESH_SAVE;
    return {
      version: 1,
      best: Number.isFinite(parsed.best) ? Math.max(0, Number(parsed.best)) : 0,
      runs: Number.isFinite(parsed.runs) ? Math.max(0, Number(parsed.runs)) : 0,
    };
  } catch {
    return FRESH_SAVE;
  }
}

export async function writeSave(storage: PlatformStorage, data: SaveData): Promise<void> {
  try {
    await storage.set(KEY, JSON.stringify(data));
  } catch {
    // Storage failing is not a reason to interrupt play.
  }
}
