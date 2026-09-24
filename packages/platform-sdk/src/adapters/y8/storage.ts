// PlatformStorage over Y8 Cloud Storage, for signed-in players only.
//
// "Cloud Storage requires the player to be authenticated." — https://docs.y8.com/sdk/cloud-storage/
// Most players are not ("Let guests play", https://docs.y8.com/best-practices/), and every
// cloud call made for a guest fails with the plain string "The token can't be null.". So the
// backend is chosen per player, not per build:
//
//   signed in  -> saveData / loadData / removeData, values up to 30 KB
//   guest      -> local storage (namespaced), exactly as a game without the SDK would save
//
// The two are never mixed for one read or write. When the player signs in or out, the
// adapter raises `storage:changed` and the game re-reads: the data it had cached came from
// the other backend. Guest progress is not copied to the account automatically — each key is
// a network request, Y8 asks games to be sparing with them, and whether a guest save should
// replace an account save is the game's decision (docs/platforms/y8.md).
//
// A cloud failure is never silent and never quietly redirected to local storage: "Check
// that a failed save is visible to the player rather than silent" (local-development page).
// It surfaces as a rejected promise carrying the SDK's code where it has one.

import type { PlatformStorage } from "../../types.js";
import { Y8_SAVE_REJECTED, describeY8Error, type Y8Sdk } from "./sdk.js";

/** "Individual values must not exceed 30 KB." */
export const Y8_VALUE_LIMIT_BYTES = 30 * 1024;

/** Thrown (as a rejection) by every failed cloud operation. */
export class Y8StorageError extends Error {
  /** The SDK's error code (`saveRejected`, …) or null for a plain-string / network failure. */
  readonly code: string | null;

  constructor(operation: string, cause: unknown) {
    super(`Y8 cloud storage ${operation} failed: ${describeY8Error(cause)}`);
    this.name = "Y8StorageError";
    const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : null;
    this.code = typeof code === "string" ? code : null;
  }

  /** The server refused the save even after the SDK's retries (Y8Sdk.saveRejected). */
  get rejected(): boolean {
    return this.code === Y8_SAVE_REJECTED;
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export class Y8Storage implements PlatformStorage {
  readonly #local: PlatformStorage;
  #sdk: Y8Sdk | null = null;
  #signedIn = false;

  constructor(local: PlatformStorage) {
    this.#local = local;
  }

  /** True while reads and writes go to Y8 Cloud Storage. */
  get cloud(): boolean {
    return this.#sdk !== null && this.#signedIn;
  }

  /**
   * Cloud saves persist; guest saves persist only as far as local storage does. A local
   * backend that cannot tell is reported as not persistent, so the game warns rather than
   * promising progress it may lose.
   */
  get persistent(): boolean {
    return this.cloud || this.#local.persistent === true;
  }

  /** Called by the adapter once the SDK is initialized, and with null if it later fails. */
  attach(sdk: Y8Sdk | null): void {
    this.#sdk = sdk;
  }

  /** Returns whether the backend changed, so the adapter knows to raise storage:changed. */
  setSignedIn(signedIn: boolean): boolean {
    const before = this.cloud;
    this.#signedIn = signedIn;
    return before !== this.cloud;
  }

  async get(key: string): Promise<string | null> {
    const sdk = this.#cloudSdk();
    if (!sdk) return this.#local.get(key);
    try {
      const value = await sdk.loadData({ key });
      // "If no value exists for the specified key, the Promise resolves with null."
      return typeof value === "string" ? value : null;
    } catch (error) {
      throw new Y8StorageError("load", error);
    }
  }

  async set(key: string, value: string): Promise<void> {
    const sdk = this.#cloudSdk();
    if (!sdk) return this.#local.set(key, value);
    const bytes = utf8Bytes(value);
    if (bytes > Y8_VALUE_LIMIT_BYTES) {
      throw new Y8StorageError(
        "save",
        `value for "${key}" is ${bytes} bytes; Y8 allows ${Y8_VALUE_LIMIT_BYTES}`,
      );
    }
    try {
      // retries left at the SDK default (true): up to five retries, three seconds apart.
      await sdk.saveData({ key, value });
    } catch (error) {
      throw new Y8StorageError("save", error);
    }
  }

  async remove(key: string): Promise<void> {
    const sdk = this.#cloudSdk();
    if (!sdk) return this.#local.remove(key);
    try {
      await sdk.removeData({ key });
    } catch (error) {
      throw new Y8StorageError("remove", error);
    }
  }

  #cloudSdk(): Y8Sdk | null {
    return this.#signedIn ? this.#sdk : null;
  }
}
