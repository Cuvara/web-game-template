// Storage backends.
//
// Namespacing by game id keeps two titles served from the same portal origin from reading
// each other's saves.

import type { PlatformStorage } from "./types.js";

/** localStorage, with an in-memory fallback. Private browsing makes it throw, not absent. */
export class LocalStorageBackend implements PlatformStorage {
  readonly #prefix: string;
  readonly #fallback = new Map<string, string>();
  readonly #available: boolean;

  constructor(namespace: string) {
    this.#prefix = `${namespace}:`;
    this.#available = LocalStorageBackend.#probe();
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
    if (!this.#available) return Promise.resolve(this.#fallback.get(key) ?? null);
    return Promise.resolve(globalThis.localStorage.getItem(this.#prefix + key));
  }

  set(key: string, value: string): Promise<void> {
    if (this.#available) globalThis.localStorage.setItem(this.#prefix + key, value);
    else this.#fallback.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    if (this.#available) globalThis.localStorage.removeItem(this.#prefix + key);
    else this.#fallback.delete(key);
    return Promise.resolve();
  }

  /** Every key in this namespace with its value, without the prefix. */
  entries(): [string, string][] {
    if (!this.#available) return [...this.#fallback.entries()];
    const storage = globalThis.localStorage;
    const found: [string, string][] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const raw = storage.key(index);
      if (raw === null || !raw.startsWith(this.#prefix)) continue;
      const value = storage.getItem(raw);
      if (value !== null) found.push([raw.slice(this.#prefix.length), value]);
    }
    return found;
  }
}

/** Storage that forgets everything. Used by tests and by headless verification. */
export class MemoryStorageBackend implements PlatformStorage {
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
