// Saves on Yandex: the player's cloud data, mirrored to local storage.
//
// Requirement 1.9 wants progress saved straight after the action and restored after a
// reload, for guests as well as signed-in players. The platform keeps player data for both
// (https://yandex.com/dev/games/doc/en/sdk/sdk-player), so the player object is the store,
// and local storage is the mirror that covers the moments it is not: before getPlayer()
// resolves, when it fails, when the SDK did not load at all.
//
// Two copies need a rule for which one is newer. Every write stamps a revision into both;
// on attach the higher revision wins, and a newer local copy is pushed up. Without that, a
// write still waiting for its cloud slot when the player refreshes would be shadowed by the
// older cloud copy — exactly the "refresh straight after the action" check 1.9 describes.
//
// setData() replaces the player's whole data object, so the full map is kept here and sent
// each time. Writes are coalesced to stay inside the documented 100 requests per 5 minutes
// (shared with getData), and flushed at once when the page is being hidden or closed.

import { LocalStorageBackend } from "../storage.js";
import type { PlatformStorage } from "../types.js";
import type { YandexPlayer } from "./yandex-sdk.js";

/** Documented per-player limit for setData. */
export const YANDEX_DATA_LIMIT_BYTES = 200 * 1024;
/**
 * 100 requests per 5 minutes is one every 3 s, and getData draws on the same quota; the
 * extra 100 ms keeps sustained writing plus the boot read inside it.
 */
export const YANDEX_MIN_WRITE_INTERVAL_MS = 3_100;
/** Revision stamp, stored beside the data in both copies. */
export const REVISION_KEY = "__wgf_rev__";
/** Local only: the keys written, since local storage cannot list a namespace. */
const KEYS_KEY = "__wgf_keys__";
/**
 * Local only: set by detach(). The mirror then belongs to a player that is no longer
 * active, so its revision proves nothing, and the next attach defers to the cloud.
 */
const STALE_KEY = "__wgf_stale__";

export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface YandexStorageOptions {
  readonly namespace: string;
  readonly now?: () => number;
  readonly timers?: Timers;
  /** Where the mirror lives. Defaults to local storage under `namespace`. */
  readonly local?: PlatformStorage;
}

export class YandexStorage implements PlatformStorage {
  readonly #local: PlatformStorage;
  readonly #now: () => number;
  readonly #timers: Timers;

  #player: YandexPlayer | null = null;
  #cloud: Record<string, unknown> = {};
  #revision = 0;
  #suspended = false;
  #lastWriteMs = Number.NEGATIVE_INFINITY;
  #timer: unknown = null;
  #writing: Promise<void> | null = null;
  #dirty = false;
  #idle: Array<() => void> = [];
  #lastError: unknown = null;

  constructor(options: YandexStorageOptions) {
    this.#local = options.local ?? new LocalStorageBackend(options.namespace);
    this.#now = options.now ?? Date.now;
    this.#timers = options.timers ?? realTimers;
  }

  /** True once the player's cloud data has been read. */
  get cloud(): boolean {
    return this.#player !== null;
  }

  /** The last cloud write failure, or null. Local writes still succeeded. */
  get lastError(): unknown {
    return this.#lastError;
  }

  /**
   * Read the player's data, reconcile it with the local copy, and start writing through.
   *
   * `reconcile` (boot): the higher revision wins, and a newer local copy is pushed up.
   * `cloud` (after the portal's account-selection dialog): the player has just chosen which
   * progress to keep, so the chosen data wins outright — even when the guest session on
   * this device is newer, and including anything written while the dialog was open.
   */
  async attach(player: YandexPlayer, mode: "reconcile" | "cloud" = "reconcile"): Promise<void> {
    const data = await player.getData();
    const cloud: Record<string, unknown> = data && typeof data === "object" ? { ...data } : {};
    const cloudRevision = Number(cloud[REVISION_KEY]) || 0;
    const localRevision = Number(await this.#local.get(REVISION_KEY)) || 0;
    const keys = await this.#localKeys();
    if ((await this.#local.get(STALE_KEY)) !== null) {
      mode = "cloud";
      await this.#local.remove(STALE_KEY);
    }

    this.#player = player;
    this.#cloud = cloud;
    if (mode === "cloud") {
      this.#dirty = false;
      if (this.#timer !== null) {
        this.#timers.clearTimeout(this.#timer);
        this.#timer = null;
      }
    }
    if (mode === "reconcile" && localRevision > cloudRevision) {
      // This device holds writes the cloud never received. Push them up.
      for (const key of keys) {
        const value = await this.#local.get(key);
        if (value === null) delete this.#cloud[key];
        else this.#cloud[key] = value;
      }
      this.#revision = localRevision;
      this.#cloud[REVISION_KEY] = localRevision;
      this.#schedule();
    } else {
      // The cloud is as new or newer — another device, or this one after a cleared cache.
      this.#revision = cloudRevision;
      // The mirror becomes an exact copy: a key the cloud does not have must not show
      // through get()'s local fallback as if it belonged to this player.
      for (const key of keys) {
        if (!(key in cloud)) await this.#local.remove(key);
      }
      for (const [key, value] of Object.entries(cloud)) {
        if (key !== REVISION_KEY && typeof value === "string") await this.#local.set(key, value);
      }
      await this.#local.set(REVISION_KEY, String(cloudRevision));
      await this.#local.set(
        KEYS_KEY,
        JSON.stringify(Object.keys(cloud).filter((key) => key !== REVISION_KEY)),
      );
    }
  }

  /**
   * Stop sending to the cloud. The portal asks for this while its account-selection dialog
   * is open, because the player is about to choose which progress to keep. Local writes
   * carry on; attach() with the chosen player resumes.
   */
  suspendSync(): void {
    this.#suspended = true;
    if (this.#timer !== null) {
      this.#timers.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  resumeSync(): void {
    this.#suspended = false;
  }

  /**
   * Stop using the cloud for the rest of the session. For when the player object can no
   * longer be trusted — the account changed and the new one could not be fetched. Writes
   * made meanwhile stay local with a newer revision, and the next boot pushes them up.
   */
  detach(): void {
    void this.#local.set(STALE_KEY, "1");
    this.suspendSync();
    this.#player = null;
    this.#cloud = {};
    this.#dirty = false;
    this.#suspended = false;
  }

  async get(key: string): Promise<string | null> {
    const cloud = this.#cloud[key];
    if (this.#player && typeof cloud === "string") return cloud;
    return this.#local.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    const revision = this.#bump();
    await this.#local.set(key, value);
    await this.#remember(key, true);
    await this.#local.set(REVISION_KEY, String(revision));
    if (!this.#player) return;
    this.#cloud[key] = value;
    this.#cloud[REVISION_KEY] = revision;
    this.#schedule();
  }

  async remove(key: string): Promise<void> {
    const revision = this.#bump();
    await this.#local.remove(key);
    await this.#remember(key, false);
    await this.#local.set(REVISION_KEY, String(revision));
    if (!this.#player) return;
    delete this.#cloud[key];
    this.#cloud[REVISION_KEY] = revision;
    this.#schedule();
  }

  /**
   * Send a pending write now, ignoring the spacing. For the page being hidden or closed:
   * the quota can afford it, a lost save cannot.
   */
  flush(): void {
    if (!this.#player || this.#suspended || this.#writing) return;
    if (this.#timer === null && !this.#dirty) return;
    if (this.#timer !== null) {
      this.#timers.clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#write();
  }

  /** Resolves once no cloud write is pending or in flight. */
  whenSaved(): Promise<void> {
    if (!this.#busy()) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  #bump(): number {
    this.#revision = Math.max(this.#now(), this.#revision + 1);
    return this.#revision;
  }

  async #localKeys(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse((await this.#local.get(KEYS_KEY)) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
    } catch {
      return [];
    }
  }

  async #remember(key: string, present: boolean): Promise<void> {
    const keys = new Set(await this.#localKeys());
    if (present === keys.has(key)) return;
    if (present) keys.add(key);
    else keys.delete(key);
    await this.#local.set(KEYS_KEY, JSON.stringify([...keys]));
  }

  #busy(): boolean {
    return this.#writing !== null || this.#timer !== null || (this.#dirty && !this.#suspended);
  }

  #schedule(): void {
    if (this.#suspended) {
      this.#dirty = true;
      return;
    }
    if (this.#writing || this.#timer !== null) {
      this.#dirty = true;
      return;
    }
    const wait = Math.max(0, this.#lastWriteMs + YANDEX_MIN_WRITE_INTERVAL_MS - this.#now());
    if (wait === 0) {
      this.#write();
      return;
    }
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = null;
      this.#write();
    }, wait);
  }

  #write(): void {
    const player = this.#player;
    if (!player || this.#suspended) return;
    this.#dirty = false;
    this.#lastWriteMs = this.#now();
    const snapshot = { ...this.#cloud };

    const size = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    const attempt =
      size > YANDEX_DATA_LIMIT_BYTES
        ? Promise.reject(
            new Error(`save is ${size} bytes; Yandex allows ${YANDEX_DATA_LIMIT_BYTES}`),
          )
        : Promise.resolve().then(() => player.setData(snapshot, true));

    this.#writing = attempt
      .then(() => {
        this.#lastError = null;
      })
      .catch((error: unknown) => {
        // Local storage already holds the value, with a newer revision than the cloud, so
        // the next attach pushes it up. Report and carry on (1.14).
        this.#lastError = error;
        console.warn("Yandex setData failed; the save is kept locally", error);
      })
      .finally(() => {
        this.#writing = null;
        if (this.#dirty) this.#schedule();
        if (!this.#busy()) for (const resolve of this.#idle.splice(0)) resolve();
      });
  }
}
