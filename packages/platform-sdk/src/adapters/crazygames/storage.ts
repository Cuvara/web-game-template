// PlatformStorage over the CrazyGames Data module.
//
// The docs require games that use the Data module to rely on it fully — for guests as well
// as logged-in users — rather than mixing it with their own localStorage saves: the module
// already keeps guest data in localStorage and migrates it to the account on login. So this
// is the only backend on CrazyGames, not a cloud layer over a local one.
//
// Keys are not namespaced. The module is already scoped to the game, and a prefix would
// make a later migration from plain localStorage keys (which the docs describe) harder.
//
// https://docs.crazygames.com/sdk/data/

import type { PlatformStorage } from "../../types.js";
import { isCrazyGamesError, type CrazyGamesSdk } from "./sdk.js";

/** The docs' limit, for the whole game's data serialised as JSON. */
export const CRAZYGAMES_DATA_LIMIT_BYTES = 1_048_576;

export class CrazyGamesDataStorage implements PlatformStorage {
  readonly #data: CrazyGamesSdk["data"];
  readonly #fallback: PlatformStorage | null;
  #disabled = false;

  /**
   * `fallback` takes over for good once the module answers `dataModuleDisabled` — the
   * submission did not opt into Progress Save. Without it every save would reject and the
   * player would have no persistence at all; with it they keep a local save, as the game
   * would have without the SDK.
   */
  constructor(sdk: CrazyGamesSdk, fallback: PlatformStorage | null = null) {
    this.#data = sdk.data;
    this.#fallback = fallback;
  }

  /** True once the Data module refused and saves went to the local fallback. */
  get dataModuleDisabled(): boolean {
    return this.#disabled;
  }

  get(key: string): Promise<string | null> {
    return this.#call(
      () => this.#data.getItem(key),
      (fallback) => fallback.get(key),
    );
  }

  set(key: string, value: string): Promise<void> {
    return this.#call(
      () => this.#data.setItem(key, value),
      (fallback) => fallback.set(key, value),
    );
  }

  remove(key: string): Promise<void> {
    return this.#call(
      () => this.#data.removeItem(key),
      (fallback) => fallback.remove(key),
    );
  }

  // The module is synchronous and throws `{code, message}` — `dataLimitExcedeed` (sic) past
  // 1 MB, `dataModuleDisabled` when the submission did not opt into progress save. The
  // second switches to the fallback; anything else surfaces as a rejected promise carrying
  // the code, so a failed save is never silent.
  #call<T>(body: () => T, viaFallback: (fallback: PlatformStorage) => Promise<T>): Promise<T> {
    if (this.#disabled && this.#fallback) return viaFallback(this.#fallback);
    try {
      return Promise.resolve(body());
    } catch (error) {
      if (isCrazyGamesError(error) && error.code === "dataModuleDisabled" && this.#fallback) {
        this.#disabled = true;
        console.warn(
          "CrazyGames: the Data module is disabled for this game (Progress Save was not " +
            "selected at submission); saving to local storage instead",
        );
        return viaFallback(this.#fallback);
      }
      const detail = isCrazyGamesError(error) ? `${error.code}: ${error.message}` : String(error);
      return Promise.reject(new Error(`CrazyGames data module: ${detail}`));
    }
  }
}
