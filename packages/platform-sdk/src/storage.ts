// Storage backends.
//
// Namespacing by game id keeps two titles served from the same portal origin from reading
// each other's saves.

import type { PlatformStorage } from "./types.js";

/**
 * localStorage, with an in-memory fallback.
 *
 * Private browsing and blocked third-party storage do not make localStorage absent — they
 * make it throw, and not always at the same point: merely reading `window.localStorage` can
 * throw a SecurityError inside a portal's iframe, and a quota of zero lets the probe's
 * write succeed on some browsers and fail on the next real one. Poki's requirement is that
 * the game "must stay playable" in incognito, so every operation is guarded, and the first
 * failure moves this backend onto memory for the rest of the session.
 */
export class LocalStorageBackend implements PlatformStorage {
  readonly #prefix: string;
  readonly #fallback = new Map<string, string>();
  #available: boolean;

  constructor(namespace: string) {
    this.#prefix = `${namespace}:`;
    this.#available = LocalStorageBackend.#probe();
  }

  /** False once storage has failed and values live only in memory for this session. */
  get persistent(): boolean {
    return this.#available;
  }

  // Absent under Node and headless verification; present but throwing in private browsing.
  // Both have to end up on the in-memory fallback, so presence is checked as well as use.
  static #probe(): boolean {
    try {
      const storage = globalThis.localStorage as Storage | undefined;
      if (!storage) return false;
      const key = "__wgf_probe__";
      storage.setItem(key, "1");
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  get(key: string): Promise<string | null> {
    if (this.#available) {
      try {
        return Promise.resolve(globalThis.localStorage.getItem(this.#prefix + key));
      } catch {
        this.#available = false;
      }
    }
    return Promise.resolve(this.#fallback.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    // Written to memory as well, so a read after storage fails mid-session still sees it.
    this.#fallback.set(key, value);
    if (this.#available) {
      try {
        globalThis.localStorage.setItem(this.#prefix + key, value);
      } catch {
        this.#available = false;
      }
    }
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.#fallback.delete(key);
    if (this.#available) {
      try {
        globalThis.localStorage.removeItem(this.#prefix + key);
      } catch {
        this.#available = false;
      }
    }
    return Promise.resolve();
  }
}

/** Storage that forgets everything. Used by tests and by headless verification. */
export class MemoryStorageBackend implements PlatformStorage {
  readonly persistent = false;
  readonly #data = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#data.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.#data.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.#data.delete(key);
    return Promise.resolve();
  }
}
