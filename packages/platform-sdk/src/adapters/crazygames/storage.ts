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

  constructor(sdk: CrazyGamesSdk) {
    this.#data = sdk.data;
  }

  get(key: string): Promise<string | null> {
    return this.#call(() => this.#data.getItem(key));
  }

  set(key: string, value: string): Promise<void> {
    return this.#call(() => this.#data.setItem(key, value));
  }

  remove(key: string): Promise<void> {
    return this.#call(() => this.#data.removeItem(key));
  }

  // The module is synchronous and throws `{code, message}` — `dataLimitExcedeed` (sic) past
  // 1 MB, `dataModuleDisabled` when the submission did not opt into progress save. Surface
  // those as rejected promises carrying the code, so a failed save is never silent.
  #call<T>(body: () => T): Promise<T> {
    try {
      return Promise.resolve(body());
    } catch (error) {
      const detail = isCrazyGamesError(error) ? `${error.code}: ${error.message}` : String(error);
      return Promise.reject(new Error(`CrazyGames data module: ${detail}`));
    }
  }
}
