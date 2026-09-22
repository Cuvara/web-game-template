// The shape of game.config.yaml, and its validator.
//
// Lives in source rather than inside vite.config.ts so three consumers can share one
// definition: the build plugin that injects it, the typing of `virtual:game-config`, and
// the test that validates the shipped file.
//
// Nothing here runs in the browser. The bundle receives the already-validated value.

export const ENGINES = ["pixijs", "threejs"] as const;
export type EngineType = (typeof ENGINES)[number];

export interface PlatformEntry {
  readonly id: string;
  readonly profile: string;
  readonly role: "required" | "optional";
}

export const AD_KINDS = ["interstitial", "rewarded", "banner"] as const;
export type AdKind = (typeof AD_KINDS)[number];

export interface Monetization {
  /** Deduplicated ad kinds the design committed to. Empty means the title shows no ads. */
  readonly ad_kinds: readonly AdKind[];
  readonly iap: boolean;
}

export interface GameConfig {
  readonly game: { readonly id: string; readonly name: string; readonly version: string };
  readonly engine: { readonly type: EngineType };
  readonly platforms: readonly PlatformEntry[];
  readonly monetization: Monetization;
  readonly build: { readonly command: string; readonly output: string };
  readonly verification: Record<string, boolean>;
  readonly publishing: { readonly enabled: boolean };
}

const PROFILE_PIN = /^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/;

function fail(message: string): never {
  throw new Error(`game.config.yaml: ${message}`);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${what} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validates the parts the build depends on. Deliberately strict about platform entries:
 * they must be pinned objects, never bare strings. An unpinned platform detaches the build
 * from the compliance rules that were in force when the plan was approved at G3, which is
 * exactly what release validation later checks it against.
 */
export function validateGameConfig(raw: unknown): GameConfig {
  const config = record(raw, "root");

  const engine = record(config["engine"], "engine");
  if (!ENGINES.includes(engine["type"] as EngineType)) {
    fail(`engine.type must be one of ${ENGINES.join(", ")}, got ${String(engine["type"])}`);
  }

  const platforms = config["platforms"];
  if (!Array.isArray(platforms) || platforms.length === 0) {
    fail("platforms must be a non-empty list");
  }

  for (const [index, raw] of (platforms as unknown[]).entries()) {
    const where = `platforms[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(`${where} must be a pinned object {id, profile, role}, not a bare string`);
    }
    const entry = raw as Record<string, unknown>;

    const id = entry["id"];
    if (typeof id !== "string") fail(`${where}.id must be a string`);

    const profile = entry["profile"];
    if (typeof profile !== "string" || !PROFILE_PIN.test(profile)) {
      fail(`${where}.profile must look like <platform-id>@<version>, got ${String(profile)}`);
    }
    if (profile.split("@")[0] !== id) {
      fail(`${where}.profile "${profile}" does not match id "${id}"`);
    }

    const role = entry["role"];
    if (role !== "required" && role !== "optional") {
      fail(`${where}.role must be required or optional, got ${String(role)}`);
    }
  }

  const monetization = record(config["monetization"], "monetization");
  const adKinds = monetization["ad_kinds"];
  if (!Array.isArray(adKinds)) {
    fail("monetization.ad_kinds must be a list (empty means the title shows no ads)");
  }
  for (const [index, kind] of (adKinds as unknown[]).entries()) {
    if (!AD_KINDS.includes(kind as AdKind)) {
      fail(
        `monetization.ad_kinds[${index}] must be one of ${AD_KINDS.join(", ")}, got ${String(kind)}`,
      );
    }
  }
  if (new Set(adKinds as AdKind[]).size !== (adKinds as AdKind[]).length) {
    fail("monetization.ad_kinds must not repeat a kind");
  }
  if (typeof monetization["iap"] !== "boolean") {
    fail("monetization.iap must be a boolean");
  }

  return config as unknown as GameConfig;
}
