// `virtual:game-config` is produced by the vite plugin in vite.config.ts.
//
// Typed as `unknown` on purpose. An ambient module declaration cannot import the GameConfig
// interface — a relative import is not allowed in one — and the honest shape at this
// boundary is unknown anyway: src/core/config.ts is the one place that asserts it, right
// next to the comment saying the build already validated it.
declare module "virtual:game-config" {
  const config: unknown;
  export default config;
  /** The id of the platforms[] entry this build is for (WGF_TARGET_PLATFORM or default). */
  export const targetPlatformId: string;
}

/** The locale ids found in public/locales at build time. See the same plugin. */
declare module "virtual:locales" {
  const locales: string[];
  export default locales;
}

/**
 * Per-title portal settings for the build target. Contract 1; src/core/config.ts's
 * platformOptions now carries the same values. See platformConfigFor in the plugin.
 */
declare module "virtual:platform-config" {
  const config: { readonly y8: unknown };
  export default config;
}

/** The build target's adapter alone. See targetPlatformModule in the plugin. */
declare module "virtual:target-platform" {
  import type { CreatePlatformOptions, Platform } from "@wgf/platform-sdk";
  export const TARGET_PLATFORM_ID: string;
  export function createTargetPlatform(options: CreatePlatformOptions): Platform;
}

/** Build-time constants the same plugin defines. Undefined in a build made without it. */
interface ImportMetaEnv {
  readonly WGF_ENGINE?: "pixijs" | "threejs";
  readonly WGF_TARGET_PLATFORM?: string;
}
