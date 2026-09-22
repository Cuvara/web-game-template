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
