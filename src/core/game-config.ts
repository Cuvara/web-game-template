// The shape of game.config.yaml, and its validator.
//
// Lives in source rather than inside vite.config.ts so three consumers can share one
// definition: the build plugin that injects it, the typing of `virtual:game-config`, and
// the test that validates the shipped file.
//
// Nothing here runs in the browser. The bundle receives the already-validated value.
//
// Keep this file free of imports. scripts/_shared.mjs transpiles and evaluates it directly so
// the plain-Node build scripts (build:platforms, release, facts) apply the same rules as the
// Vite plugin without a second copy of them.

export const ENGINES = ["pixijs", "threejs"] as const;
export type EngineType = (typeof ENGINES)[number];

// Kept as a literal rather than imported from @wgf/platform-sdk: this file runs under Node
// before the packages are built. tests/unit/game-config-build.test.ts asserts they agree.
export const KNOWN_PLATFORM_IDS = [
  "generic-web",
  "yandex",
  "poki",
  "crazygames",
  "gamevui",
  "y8",
  "gamedistribution",
  "gamemonetize",
] as const;

export interface PlatformEntry {
  readonly id: string;
  readonly profile: string;
  readonly role: "required" | "optional";
  /**
   * The Game ID the portal issued for this title, where its SDK needs one:
   * - gamedistribution (required): the 32-hex Game ID from the developer panel.
   * - gamemonetize (required at build): the "Game ID" from Game Management > My games.
   *   WGF_GAMEMONETIZE_GAME_ID at build time overrides it.
   * - y8 (optional): the Game ID from https://docs.y8.com/studio/sdk-initialization/.
   *   WGF_Y8_GAME_ID overrides it.
   * Public — it ships in the bundle — but per title, so the template never carries one.
   */
  readonly game_id?: string;
  /** y8 only (required at build): the App ID Y8 issued. WGF_Y8_APP_ID overrides it. */
  readonly app_id?: string;
  /**
   * gamedistribution only. `gamedistribution` (the default): the build is uploaded and
   * GameDistribution hosts it. `self-hosted`: the game is served from `game_url`, and the
   * GameDistribution submission is a wrapper page that frames it with
   * `gd_sdk_referrer_url` (docs/platforms/gamedistribution.md).
   */
  readonly hosting?: GameDistributionHosting;
  /** gamedistribution, self-hosted only: the https URL the game itself is served from. */
  readonly game_url?: string;
}

export const GAMEDISTRIBUTION_HOSTING = ["gamedistribution", "self-hosted"] as const;
export type GameDistributionHosting = (typeof GAMEDISTRIBUTION_HOSTING)[number];

/** Platforms whose entry may carry a `game_id`. */
export const PLATFORMS_WITH_GAME_ID = ["gamedistribution", "gamemonetize", "y8"] as const;

/**
 * The portal ids a build for each platform cannot do without. Missing, the adapter would boot
 * without its SDK — no ads, nothing counted — which a portal rejects, so the build fails
 * instead (see resolveBuild).
 */
export const REQUIRED_PORTAL_IDS: Readonly<Record<string, readonly ("game_id" | "app_id")[]>> = {
  gamedistribution: ["game_id"],
  gamemonetize: ["game_id"],
  y8: ["app_id"],
};

/** Environment variables that override a platform entry's portal ids. They win over the file. */
export const PORTAL_ID_OVERRIDES = [
  { env: "WGF_Y8_APP_ID", platform: "y8", field: "app_id" },
  { env: "WGF_Y8_GAME_ID", platform: "y8", field: "game_id" },
  { env: "WGF_GAMEMONETIZE_GAME_ID", platform: "gamemonetize", field: "game_id" },
] as const;

// Kept as literals rather than imported from @wgf/platform-sdk: this file runs under Node
// before the packages are built. tests/unit/gamedistribution.test.ts asserts they agree.
const GD_GAME_ID = /^[0-9a-f]{32}$/i;
const GD_PLACEHOLDER_GAME_ID = "4f3d7d38d24b740c95da2b03dc3a2333";
const GD_ONLY_FIELDS = ["hosting", "game_url"] as const;

// Mirrors gameMonetizeGameIdProblem in @wgf/platform-sdk, which this file cannot import: it
// runs under Node before the packages are built. tests/unit/gamemonetize.test.ts keeps the
// two in step.
const GAME_ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;
const GAME_ID_PLACEHOLDERS = new Set(["your_game_id_here", "your-game-id", "game_id", "gameid"]);

// Same rule as validateY8Config in the Y8 adapter: the docs give no format, so only what any
// identifier must satisfy. tests/integration/y8-build.test.ts keeps the two in step.
const Y8_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

  const seen = new Set<string>();
  for (const [index, raw] of (platforms as unknown[]).entries()) {
    const where = `platforms[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(`${where} must be a pinned object {id, profile, role}, not a bare string`);
    }
    const entry = raw as Record<string, unknown>;

    const id = entry["id"];
    if (typeof id !== "string") fail(`${where}.id must be a string`);
    if (!(KNOWN_PLATFORM_IDS as readonly string[]).includes(id)) {
      fail(`${where}.id "${id}" is not a known platform (${KNOWN_PLATFORM_IDS.join(", ")})`);
    }
    // One build per entry (pnpm build:platforms), keyed by id: a repeat would overwrite one.
    if (seen.has(id)) fail(`${where}.id "${id}" is listed twice`);
    seen.add(id);

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

    if (entry["app_id"] !== undefined && id !== "y8") {
      fail(`${where}.app_id applies to y8 only`);
    }

    if (id === "gamedistribution") validateGameDistribution(entry, where);
    else {
      for (const field of GD_ONLY_FIELDS) {
        if (field in entry) fail(`${where}.${field} applies to gamedistribution only`);
      }
      const gameId = entry["game_id"];
      if (gameId !== undefined && !(PLATFORMS_WITH_GAME_ID as readonly string[]).includes(id)) {
        fail(`${where}.game_id is only read for ${PLATFORMS_WITH_GAME_ID.join(", ")}`);
      }
      if (id === "y8") validateY8(entry, where);
      else if (gameId !== undefined) {
        if (typeof gameId !== "string" || !GAME_ID_FORMAT.test(gameId)) {
          fail(`${where}.game_id must be 8-64 letters, digits, '-' or '_', got ${String(gameId)}`);
        }
        if (GAME_ID_PLACEHOLDERS.has(gameId.toLowerCase())) {
          fail(`${where}.game_id is the documented placeholder, not a Game ID`);
        }
      }
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

/** Y8's App ID and Game ID: the docs give no format, so only what any identifier satisfies. */
function validateY8(entry: Record<string, unknown>, where: string): void {
  for (const field of ["app_id", "game_id"] as const) {
    const value = entry[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !Y8_IDENTIFIER.test(value)) {
      fail(`${where}.${field} ${JSON.stringify(value)} is malformed`);
    }
  }
}

/**
 * GameDistribution has no default Game ID — without one the SDK reports "no revenue will be
 * reported" — and self-hosting needs the URL the wrapper page frames. Both fail the build
 * here rather than a submission later.
 */
function validateGameDistribution(entry: Record<string, unknown>, where: string): void {
  const gameId = entry["game_id"];
  if (typeof gameId !== "string" || !GD_GAME_ID.test(gameId)) {
    fail(
      `${where}.game_id must be the 32-hex Game ID from the GameDistribution developer ` +
        `panel, got ${JSON.stringify(gameId ?? null)}`,
    );
  }
  if (gameId.toLowerCase() === GD_PLACEHOLDER_GAME_ID) {
    fail(`${where}.game_id is the SDK's built-in placeholder, which reports no revenue`);
  }

  const hosting = entry["hosting"] ?? "gamedistribution";
  if (!GAMEDISTRIBUTION_HOSTING.includes(hosting as GameDistributionHosting)) {
    fail(
      `${where}.hosting must be one of ${GAMEDISTRIBUTION_HOSTING.join(", ")}, got ${String(hosting)}`,
    );
  }
  const gameUrl = entry["game_url"];
  if (hosting === "gamedistribution") {
    if (gameUrl !== undefined) fail(`${where}.game_url applies to hosting: self-hosted only`);
    return;
  }
  if (typeof gameUrl !== "string") fail(`${where}.game_url is required for hosting: self-hosted`);
  let url: URL;
  try {
    url = new URL(gameUrl);
  } catch {
    fail(`${where}.game_url must be an absolute URL, got ${JSON.stringify(gameUrl)}`);
  }
  // Guidelines §3.1: "Games must be HTTPS ready".
  if (url.protocol !== "https:") fail(`${where}.game_url must be https, got ${url.protocol}`);
  // The wrapper page adds the referrer at run time, from where it is embedded. A value
  // written into the config would claim every embed came from one page.
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === "gd_sdk_referrer_url") {
      fail(`${where}.game_url must not carry gd_sdk_referrer_url; the wrapper page sets it`);
    }
  }
}

/** The build environment, as far as this module reads it. `process.env` satisfies it. */
export type BuildEnv = Readonly<Record<string, string | undefined>>;

function envValue(env: BuildEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The parsed config with WGF_Y8_APP_ID, WGF_Y8_GAME_ID and WGF_GAMEMONETIZE_GAME_ID applied
 * to their platform's entry. They let a release job supply portal ids without committing
 * them; an empty variable counts as unset. Returns a copy, validated like the file would be
 * by validateGameConfig afterwards — an override is no more trusted than the file.
 */
export function applyPortalIdOverrides(raw: unknown, env: BuildEnv): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const platforms = (raw as { platforms?: unknown }).platforms;
  if (!Array.isArray(platforms)) return raw;
  return {
    ...raw,
    platforms: platforms.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return entry;
      let next = entry as Record<string, unknown>;
      for (const override of PORTAL_ID_OVERRIDES) {
        const value = envValue(env, override.env);
        if (value !== undefined && next["id"] === override.platform) {
          next = { ...next, [override.field]: value };
        }
      }
      return next;
    }),
  };
}

/**
 * The entry this build targets: WGF_TARGET_PLATFORM when set — it must name an entry in
 * platforms[] — else the first required entry, else the first entry.
 */
export function resolveTargetPlatform(config: GameConfig, env: BuildEnv): PlatformEntry {
  const requested = envValue(env, "WGF_TARGET_PLATFORM");
  if (requested !== undefined) {
    const entry = config.platforms.find((candidate) => candidate.id === requested);
    if (!entry) {
      fail(
        `WGF_TARGET_PLATFORM "${requested}" is not in platforms[] ` +
          `(${config.platforms.map((candidate) => candidate.id).join(", ")})`,
      );
    }
    return entry;
  }
  const entry =
    config.platforms.find((candidate) => candidate.role === "required") ?? config.platforms[0];
  if (!entry) fail("platforms must be a non-empty list");
  return entry;
}

/** The portal ids `entry` needs for a working build and does not have, e.g. `["app_id"]`. */
export function missingPortalIds(entry: PlatformEntry): string[] {
  return (REQUIRED_PORTAL_IDS[entry.id] ?? []).filter((field) => !entry[field]);
}

export interface ResolvedBuild {
  /** The validated config, portal id overrides applied. What the bundle carries. */
  readonly config: GameConfig;
  /** The platform this build is for. */
  readonly target: PlatformEntry;
  /** False only for a build let through by WGF_ALLOW_UNCONFIGURED_PORTAL=1. */
  readonly portalConfigured: boolean;
}

/**
 * Everything a build decides from the config and the environment, in one place so the Vite
 * plugin and scripts/build/build-platforms.mjs cannot disagree.
 *
 * A target whose portal ids are missing fails: such a bundle boots without its portal's SDK,
 * shows no ads and counts no plays, and the portal rejects it at review — later and more
 * expensively than here. WGF_ALLOW_UNCONFIGURED_PORTAL=1 lets tests and local development
 * build it anyway; the build is then marked portal_configured=false and release:package
 * refuses it.
 */
export function resolveBuild(raw: unknown, env: BuildEnv): ResolvedBuild {
  const config = validateGameConfig(applyPortalIdOverrides(raw, env));
  const target = resolveTargetPlatform(config, env);
  const missing = missingPortalIds(target);
  if (missing.length > 0 && envValue(env, "WGF_ALLOW_UNCONFIGURED_PORTAL") !== "1") {
    const overrides = PORTAL_ID_OVERRIDES.filter(
      (override) =>
        override.platform === target.id && (missing as string[]).includes(override.field),
    ).map((override) => override.env);
    fail(
      `the ${target.id} build needs ${missing.join(" and ")} on its platform entry` +
        (overrides.length > 0 ? ` (or ${overrides.join(", ")})` : "") +
        " — without it the game runs without the portal SDK. " +
        "WGF_ALLOW_UNCONFIGURED_PORTAL=1 builds it anyway, for tests and local development only",
    );
  }
  return { config, target, portalConfigured: missing.length === 0 };
}
