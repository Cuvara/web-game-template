import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageBackend } from "@wgf/platform-sdk";

// Incognito and blocked storage, simulated. Poki: "Incognito mode restricts localStorage,
// so wrap localStorage operations in a try/catch. Your game must stay playable."

class MapStorage {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException("quota", "QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function install(value: unknown | (() => never)): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: typeof value === "function" ? (value as () => never) : () => value,
  });
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("LocalStorageBackend", () => {
  it("persists through localStorage when it works", async () => {
    const storage = new MapStorage();
    install(storage);
    const backend = new LocalStorageBackend("game");
    await backend.set("save", "1");
    expect(storage.data.get("game:save")).toBe("1");
    await expect(backend.get("save")).resolves.toBe("1");
    expect(backend.persistent).toBe(true);
  });

  it("falls back to memory when merely touching localStorage throws", async () => {
    install(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const backend = new LocalStorageBackend("game");
    await backend.set("save", "1");
    await expect(backend.get("save")).resolves.toBe("1");
    expect(backend.persistent).toBe(false);
  });

  it("falls back to memory when writes start failing mid-session", async () => {
    const storage = new MapStorage();
    install(storage);
    const backend = new LocalStorageBackend("game");
    storage.failWrites = true;
    await expect(backend.set("save", "2")).resolves.toBeUndefined();
    await expect(backend.get("save")).resolves.toBe("2");
    expect(backend.persistent).toBe(false);
  });

  it("survives a getter that starts throwing after the probe", async () => {
    const storage = new MapStorage();
    let blocked = false;
    install(() => {
      if (blocked) throw new DOMException("denied", "SecurityError");
      return storage as never;
    });
    const backend = new LocalStorageBackend("game");
    blocked = true;
    await expect(backend.get("x")).resolves.toBeNull();
    await expect(backend.remove("x")).resolves.toBeUndefined();
  });
});
