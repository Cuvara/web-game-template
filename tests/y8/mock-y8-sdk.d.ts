// Types for mock-y8-sdk.js, so TypeScript tests and harnesses can drive it.

import type { Y8Global, Y8Sdk, Y8User } from "@wgf/platform-sdk";

export type Y8AdScript =
  | "viewed"
  | "dismissed"
  | "noAdPreloaded"
  | "frequencyCapped"
  | "notReady"
  | "timeout"
  | "error"
  | "ignored"
  | "other"
  | "reject"
  | "silent"
  | "stall"
  | "late"
  | "duplicate"
  | "viewed-dismissed";

export type Y8StorageMode = "ok" | "fail" | "rejected";

export interface Y8MockOptions {
  /** Default: the script announces itself once on load. */
  readonly ready?: "on-load" | "twice" | "never";
  readonly init?: "ok" | "throws" | "rejects";
  /** The player the first onAuth report carries. Default null (a guest). */
  readonly user?: Y8User | null;
  /** Report a sign-in error instead of a user. */
  readonly authError?: boolean;
  /** "never": no onAuth report at all after init. */
  readonly auth?: "report" | "never";
  readonly locale?: string;
  readonly ad?: Y8AdScript | readonly Y8AdScript[];
  readonly storage?: Y8StorageMode;
  /** How the ready event is scheduled. Default setTimeout(fn, 0), like the real script. */
  readonly defer?: (fn: () => void) => void;
  /** false: do not install window.y8 yet; call install() later (a late-loading script). */
  readonly install?: boolean;
}

export interface Y8Mock {
  readonly global: Y8Global;
  readonly sdk: Y8Sdk & { lastInit?: { appConfig: unknown; adConfig: unknown } };
  /** Every SDK call and callback, in order. */
  readonly calls: string[];
  readonly data: Map<string, string>;
  install(): void;
  setAd(script: Y8AdScript | readonly Y8AdScript[]): void;
  setStorage(mode: Y8StorageMode): void;
  setUser(user: Y8User | null): void;
  release(): void;
}

export function createY8Mock(target: EventTarget, options?: Y8MockOptions): Y8Mock;
