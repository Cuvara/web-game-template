// The Vite plugin that turns game.config.yaml and public/locales/ into virtual modules, and
// fixes the build's target platform and engine.
//
// Shared by the template's own vite.config.ts and by anything under examples/, so every
// build validates its config the same way. See vite.config.ts for why the config is
// compiled in rather than fetched.
//
// One build is for one platform (WGF_TARGET_PLATFORM, default the first required entry) and
// one engine (engine.type). Nothing else reaches the bundle: the target's adapter comes in
// through `virtual:target-platform`, which imports that adapter's subpath of
// @wgf/platform-sdk only, and the engine through the `import.meta.env.WGF_ENGINE` define,
// which leaves the other engine's dynamic import in a branch Rollup removes. Profiles assert
// a bundle free of foreign portal SDKs, and the other engine is a megabyte nobody runs.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { parse } from "yaml";
import {
  resolveBuild,
  validateGameConfig,
  applyPortalIdOverrides,
  type BuildEnv,
  type GameConfig,
  type PlatformEntry,
  type ResolvedBuild,
} from "../../src/core/game-config.js";

// Kept as a literal rather than imported from @wgf/platform-sdk: this file runs under Node
// before the packages are built. tests/integration/crazygames-build.test.ts asserts the two
// agree.
const CRAZYGAMES_SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
// Same rule, same test: must equal Y8_SDK_URL in packages/platform-sdk/src/adapters/y8/sdk.ts.
const Y8_SDK_URL = "https://cdn.y8.com/minimal-sdk/2-0/y8.min.js";

const VIRTUAL_ID = "virtual:game-config";
const LOCALES_ID = "virtual:locales";
const PLATFORM_CONFIG_ID = "virtual:platform-config";
const TARGET_PLATFORM_ID = "virtual:target-platform";
const APP_PLATFORM_SDK_ID = "virtual:wgf-app-platform-sdk";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;
const RESOLVED_LOCALES_ID = "\0" + LOCALES_ID;
const RESOLVED_PLATFORM_CONFIG_ID = "\0" + PLATFORM_CONFIG_ID;
const RESOLVED_TARGET_PLATFORM_ID = "\0" + TARGET_PLATFORM_ID;
const RESOLVED_APP_PLATFORM_SDK_ID = "\0" + APP_PLATFORM_SDK_ID;

/**
 * How `virtual:target-platform` constructs each platform's adapter: the @wgf/platform-sdk
 * subpath it imports (packages/platform-sdk/package.json exports), the class, and the
 * constructor argument built from `options: CreatePlatformOptions`. Must construct what
 * createPlatform in packages/platform-sdk/src/registry.ts constructs for the same id —
 * tests/unit/target-platform.test.ts checks the two agree for every id.
 */
export const TARGET_ADAPTERS: Readonly<
  Record<string, { readonly source: string; readonly className: string; readonly args: string }>
> = {
  "generic-web": {
    source: "adapters/generic-web",
    className: "GenericWebPlatform",
    args: "{ namespace: options.namespace }",
  },
  yandex: {
    source: "adapters/yandex",
    className: "YandexPlatform",
    args: "{ namespace: options.namespace }",
  },
  poki: {
    source: "adapters/poki",
    className: "PokiPlatform",
    args: "{ namespace: options.namespace }",
  },
  crazygames: {
    source: "adapters/crazygames/platform",
    className: "CrazyGamesPlatform",
    args: "{ namespace: options.namespace }",
  },
  gamevui: {
    source: "adapters/gamevui",
    className: "GameVuiPlatform",
    args: "{ namespace: options.namespace }",
  },
  y8: {
    source: "adapters/y8/platform",
    className: "Y8Platform",
    args: "{ namespace: options.namespace, config: options.y8 }",
  },
  gamedistribution: {
    source: "adapters/gamedistribution/platform",
    className: "GameDistributionPlatform",
    args: '{ namespace: options.namespace, gameId: options.gamedistribution?.gameId ?? "" }',
  },
  gamemonetize: {
    source: "adapters/gamemonetize",
    className: "GameMonetizePlatform",
    args: "{ namespace: options.namespace, gameId: options.portalGameId ?? null }",
  },
};

/** The `@wgf/platform-sdk/<subpath>` export for platform `id`'s adapter. */
export function adapterSubpath(id: string): string {
  return `adapters/${id}`;
}

/** Source of `virtual:target-platform` for a build whose target is `id`. */
export function targetPlatformModule(id: string): string {
  const adapter = TARGET_ADAPTERS[id];
  if (!adapter) throw new Error(`no adapter for platform "${id}"`);
  return [
    `import { ${adapter.className} } from "@wgf/platform-sdk/${adapterSubpath(id)}";`,
    `export const TARGET_PLATFORM_ID = ${JSON.stringify(id)};`,
    `export function createTargetPlatform(options) {`,
    `  return new ${adapter.className}(${adapter.args});`,
    `}`,
  ].join("\n");
}

/** Portal settings that are per title, as the pre-v2 `virtual:platform-config` shaped them. */
export interface PlatformConfig {
  /** Y8 App ID and Game ID, or null when the build targets another platform or has none. */
  readonly y8: { readonly appId: string; readonly gameId: string | null } | null;
}

/** `virtual:platform-config` for a build whose target is `target`. */
export function platformConfigFor(target: PlatformEntry): PlatformConfig {
  // Only a build that targets Y8 carries its IDs.
  if (target.id !== "y8" || !target.app_id) return { y8: null };
  return { y8: { appId: target.app_id, gameId: target.game_id ?? null } };
}

/**
 * game.config.yaml, validated, with the portal id overrides (WGF_Y8_APP_ID, WGF_Y8_GAME_ID,
 * WGF_GAMEMONETIZE_GAME_ID) applied. The overrides let a release job supply ids without
 * committing them; they are validated exactly like ones written in the file.
 */
export function loadGameConfig(configPath: string, env: BuildEnv = process.env): GameConfig {
  return validateGameConfig(applyPortalIdOverrides(parse(readFileSync(configPath, "utf8")), env));
}

/** The config, target platform and portal readiness for a build. Throws what fails it. */
export function loadBuild(configPath: string, env: BuildEnv = process.env): ResolvedBuild {
  return resolveBuild(parse(readFileSync(configPath, "utf8")), env);
}

export interface GameConfigPluginOptions {
  /** Absolute path to game.config.yaml. */
  readonly configPath: string;
  /** Absolute path to the public/locales directory. */
  readonly localesDir: string;
  /** The build environment. Defaults to process.env; tests pass their own. */
  readonly env?: BuildEnv;
}

/**
 * The locales the package ships, read from the files themselves. Deliberately not declared
 * anywhere: the files are what gets copied into the build, and the files are what release
 * validation measures for `package.locales`. A declaration could disagree with them.
 */
export function shippedLocales(localesDir: string): string[] {
  if (!existsSync(localesDir)) return [];
  return readdirSync(localesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export function gameConfigPlugin(options: GameConfigPluginOptions): Plugin {
  const env = (): BuildEnv => options.env ?? process.env;
  // Resolved in the config hook, so a config or environment that cannot build fails before
  // Vite does any work. The dev server re-resolves when game.config.yaml changes.
  let build: ResolvedBuild | undefined;
  const current = (): ResolvedBuild => (build ??= loadBuild(options.configPath, env()));
  let appSrc = "";

  return {
    name: "wgf:game-config",
    // Before vite:resolve, which would otherwise resolve @wgf/platform-sdk for the app first.
    enforce: "pre",
    config() {
      const { config, target } = current();
      return {
        define: {
          "import.meta.env.WGF_ENGINE": JSON.stringify(config.engine.type),
          "import.meta.env.WGF_TARGET_PLATFORM": JSON.stringify(target.id),
        },
      };
    },
    configResolved(resolved) {
      appSrc = resolve(resolved.root, "src") + sep;
      const { target, portalConfigured } = current();
      if (!portalConfigured) {
        resolved.logger.warn(
          `[wgf] WGF_ALLOW_UNCONFIGURED_PORTAL=1: this ${target.id} build has no portal ids ` +
            "and runs without the portal SDK — no ads, nothing counted. release:package refuses it.",
        );
      }
    },
    resolveId(id, importer) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (id === LOCALES_ID) return RESOLVED_LOCALES_ID;
      if (id === PLATFORM_CONFIG_ID) return RESOLVED_PLATFORM_CONFIG_ID;
      if (id === TARGET_PLATFORM_ID) return RESOLVED_TARGET_PLATFORM_ID;
      // The app's own source gets @wgf/platform-sdk with createPlatform narrowed to the
      // target. The registry's createPlatform references every adapter, so an app that
      // called it would bundle every portal's SDK loader; this one references one.
      if (
        id === "@wgf/platform-sdk" &&
        importer !== undefined &&
        appSrc !== "" &&
        resolve(importer).startsWith(appSrc)
      ) {
        return RESOLVED_APP_PLATFORM_SDK_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        const { config, target } = current();
        return (
          `export default ${JSON.stringify(config)};\n` +
          `export const targetPlatformId = ${JSON.stringify(target.id)};`
        );
      }
      if (id === RESOLVED_LOCALES_ID) {
        const locales = shippedLocales(options.localesDir);
        if (locales.length === 0) {
          this.warn(
            "public/locales/ is empty — package.locales will measure as [], which is a " +
              "blocking assertion on Yandex, CrazyGames and GameVui",
          );
        }
        return `export default ${JSON.stringify(locales)};`;
      }
      if (id === RESOLVED_PLATFORM_CONFIG_ID) {
        return `export default ${JSON.stringify(platformConfigFor(current().target))};`;
      }
      if (id === RESOLVED_TARGET_PLATFORM_ID) {
        return targetPlatformModule(current().target.id);
      }
      if (id === RESOLVED_APP_PLATFORM_SDK_ID) {
        // Resolved from this module the id is not the app's, so it reaches the real package.
        return [
          `export * from "@wgf/platform-sdk";`,
          `import { TARGET_PLATFORM_ID, createTargetPlatform } from "${TARGET_PLATFORM_ID}";`,
          `export function createPlatform(id, options) {`,
          `  if (id !== TARGET_PLATFORM_ID) {`,
          `    throw new Error("This build bundles only the " + TARGET_PLATFORM_ID +`,
          `      " adapter; createPlatform(\\"" + id + "\\") needs a build for that platform " +`,
          `      "(WGF_TARGET_PLATFORM, or pnpm build:platforms).");`,
          `  }`,
          `  return createTargetPlatform(options);`,
          `}`,
        ].join("\n");
      }
      return null;
    },
    configureServer(server) {
      server.watcher.add(options.configPath);
      server.watcher.add(options.localesDir);
      server.watcher.on("change", (path) => {
        if (resolve(path) === resolve(options.configPath)) build = undefined;
      });
    },
    // CrazyGames documents one way to load its SDK: a classic <script> in <head>, before the
    // game code. Only a build whose target is crazygames gets it — every other profile
    // asserts a bundle free of foreign portal SDKs.
    //
    // Y8 documents the same place with `async` (https://docs.y8.com/sdk/intro/#installation),
    // and only for a build that has an App ID to initialize it with. The adapter handles the
    // resulting race — the script may run before or after it listens for y8sdk.ready.
    transformIndexHtml() {
      const { target } = current();
      if (target.id === "crazygames") {
        return [{ tag: "script", attrs: { src: CRAZYGAMES_SDK_URL }, injectTo: "head-prepend" }];
      }
      if (target.id === "y8" && target.app_id) {
        return [
          { tag: "script", attrs: { src: Y8_SDK_URL, async: true }, injectTo: "head-prepend" },
        ];
      }
      return [];
    },
  };
}
