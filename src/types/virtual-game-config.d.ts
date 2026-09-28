// `virtual:game-config` is produced by the vite plugin in vite.config.ts.
//
// Typed as `unknown` on purpose. An ambient module declaration cannot import the GameConfig
// interface without pulling a module-mode import into a script-mode declaration file, and
// the honest shape at this boundary is unknown anyway — src/core/config.ts is the one place
// that asserts it, right next to the comment saying the build already validated it.
declare module "virtual:game-config" {
  const config: unknown;
  export default config;
}

/** The locale ids found in public/locales at build time. See the same plugin. */
declare module "virtual:locales" {
  const locales: string[];
  export default locales;
}

/**
 * Build-time constants the game-config plugin defines.
 *
 * WGF_ENGINE is game.config.yaml's engine.type. src/rendering/create-renderer.ts compares
 * against it so the engines this build does not use are removed from the bundle. Optional:
 * a bundle built without the plugin (tests/sdk-matrix/) has none and selects at run time.
 */
interface ImportMetaEnv {
  readonly WGF_ENGINE?: "pixijs" | "phaserjs" | "threejs";
}

/** Per-title portal settings from the build environment. See readPlatformConfig. */
declare module "virtual:platform-config" {
  const config: { readonly y8: unknown };
  export default config;
}
