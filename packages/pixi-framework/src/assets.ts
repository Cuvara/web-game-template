// Asset loading for `engine.type: pixijs`.
//
// Every 2D game needs the same three things: declare what it ships, load it before the first
// frame, and report how far along that is. The third one is not optional — the Factory's
// platform profiles carry `loading_api`, several portals list "does not report loading
// progress" among past rejections, and release validation counts the calls
// (tests/verify/facts.spec.ts). Leaving all of it to game code means every game re-derives
// the progress arithmetic, and a game that gets it wrong fails at submission rather than in
// CI.
//
// The declaration is data (AssetManifest), so it can be reviewed, diffed and budgeted
// without reading loader code. Loading goes through Pixi's own Assets cache, so nothing here
// duplicates caching, retries or texture lifetime.

import { Assets, type Texture } from "pixi.js";

/**
 * What a file is.
 *
 * Nothing is dispatched on this: Pixi picks its parser from the extension, and tells a
 * spritesheet atlas from plain data by what the `.json` contains. It is declaration —
 * `.json` alone does not say which of the three a file is, and it lets
 * {@link AssetLoader.texture} refuse an alias that was never declared as an image instead
 * of handing the renderer something that fails at draw time.
 */
export type AssetKind = "texture" | "spritesheet" | "bitmapFont" | "json";

export interface AssetEntry {
  /** What game code asks for. Unique across the whole manifest. */
  readonly alias: string;
  /**
   * URL relative to the built page. A file at `public/assets/hero.png` is `assets/hero.png`
   * — Vite copies `public/` to the build root and `vite.config.ts` sets `base: "./"`, which
   * is what portals require ("never use absolute paths").
   */
  readonly src: string;
  /** Inferred from the extension when absent. */
  readonly kind?: AssetKind;
}

export interface AssetBundle {
  /** The name passed to {@link AssetLoader.load}. Unique in the manifest. */
  readonly name: string;
  readonly assets: readonly AssetEntry[];
}

/**
 * Everything the game ships, grouped into bundles.
 *
 * Group by when it is needed, not by what it is: one bundle loaded before the first frame,
 * the rest loaded at a moment the player is already looking at something. Time to
 * interactive is measured by the verify suite, and a boot bundle that carries the whole game
 * is the usual reason it is bad.
 */
export interface AssetManifest {
  readonly bundles: readonly AssetBundle[];
}

/**
 * The loading mechanism, behind an interface.
 *
 * The default is Pixi's `Assets`. This seam exists so the progress arithmetic and the
 * manifest rules can be tested in Node without a WebGL context — it is not a plugin point,
 * and a game should never pass one.
 */
export interface AssetBackend {
  /** Called once, before the first load. */
  init(manifest: AssetManifest, basePath: string): Promise<void>;
  /** Load one bundle. `onProgress` receives 0..1 for that bundle alone. */
  loadBundle(name: string, onProgress: (fraction: number) => void): Promise<void>;
  /** Drop one bundle's assets from memory. */
  unloadBundle(name: string): Promise<void>;
  /** The loaded value for an alias, or undefined if its bundle is not loaded. */
  get(alias: string): unknown;
}

export interface AssetLoaderOptions {
  readonly manifest: AssetManifest;
  /**
   * Progress of one {@link AssetLoader.load} call, 0..1 — pass
   * `context.reportLoadingProgress` straight in. Within a call the value never decreases and
   * always ends at exactly 1; a call that fails stops where it stopped. Across two calls it
   * starts over, so make the boot load a single call listing every bundle the first frame
   * needs.
   */
  readonly onProgress?: (fraction: number) => void;
  /** Prefix applied to every `src`. Default none. */
  readonly basePath?: string;
  /** Test seam. Defaults to Pixi's `Assets`. */
  readonly backend?: AssetBackend;
}

const EXTENSION_KINDS: ReadonlyMap<string, AssetKind> = new Map([
  ["png", "texture"],
  ["jpg", "texture"],
  ["jpeg", "texture"],
  ["webp", "texture"],
  ["avif", "texture"],
  ["svg", "texture"],
  ["json", "json"],
]);

/** The declared kind, or the one the extension implies, or undefined if neither says. */
export function assetKind(entry: AssetEntry): AssetKind | undefined {
  if (entry.kind) return entry.kind;
  const extension = entry.src.split("?")[0]?.split(".").pop()?.toLowerCase();
  return extension ? EXTENSION_KINDS.get(extension) : undefined;
}

/**
 * Loads the manifest's bundles and reports progress across them.
 *
 * Construction validates the manifest, so a typo in an alias is a startup error naming the
 * problem rather than a texture that silently never appears.
 */
export class AssetLoader {
  readonly #manifest: AssetManifest;
  readonly #bundles: ReadonlyMap<string, AssetBundle>;
  readonly #entries: ReadonlyMap<string, AssetEntry>;
  readonly #bundleOf: ReadonlyMap<string, string>;
  readonly #backend: AssetBackend;
  readonly #basePath: string;
  readonly #onProgress: ((fraction: number) => void) | undefined;

  readonly #loaded = new Set<string>();
  #initialized: Promise<void> | null = null;

  constructor(options: AssetLoaderOptions) {
    this.#manifest = options.manifest;
    this.#backend = options.backend ?? new PixiAssetBackend();
    this.#basePath = options.basePath ?? "";
    this.#onProgress = options.onProgress;

    const bundles = new Map<string, AssetBundle>();
    const entries = new Map<string, AssetEntry>();
    const bundleOf = new Map<string, string>();
    for (const bundle of options.manifest.bundles) {
      if (!bundle.name) throw new Error("asset manifest: a bundle has an empty name");
      if (bundles.has(bundle.name)) {
        throw new Error(`asset manifest: two bundles are named "${bundle.name}"`);
      }
      bundles.set(bundle.name, bundle);
      for (const entry of bundle.assets) {
        if (!entry.alias) {
          throw new Error(`asset manifest: an asset in bundle "${bundle.name}" has no alias`);
        }
        if (!entry.src) {
          throw new Error(`asset manifest: asset "${entry.alias}" has no src`);
        }
        const owner = bundleOf.get(entry.alias);
        if (owner !== undefined) {
          throw new Error(
            `asset manifest: alias "${entry.alias}" is declared in both "${owner}" and "${bundle.name}"`,
          );
        }
        entries.set(entry.alias, entry);
        bundleOf.set(entry.alias, bundle.name);
      }
    }
    this.#bundles = bundles;
    this.#entries = entries;
    this.#bundleOf = bundleOf;
  }

  /** Bundle names loaded so far. */
  get loaded(): readonly string[] {
    return [...this.#loaded];
  }

  /**
   * Load the named bundles, reporting combined progress weighted by how many assets each
   * one holds. Already-loaded bundles are skipped but still count as done, so calling it
   * twice is safe and still ends at 1.
   *
   * Bundles load one after another rather than at once: Pixi reports progress per bundle,
   * and interleaving those streams makes the reported fraction jump around. The network is
   * saturated by the files inside a bundle anyway.
   */
  async load(...bundleNames: readonly string[]): Promise<void> {
    const names = bundleNames.length > 0 ? bundleNames : [...this.#bundles.keys()];
    const requested = names.map((name) => this.#requireBundle(name));

    const total = requested.reduce((sum, bundle) => sum + Math.max(1, bundle.assets.length), 0);
    let done = 0;
    let reported = -1;
    const report = (fraction: number): void => {
      if (!this.#onProgress) return;
      const clamped = Math.min(1, Math.max(0, fraction));
      // Never backwards: a loading bar that retreats reads as a broken game to a portal
      // reviewer, and every call is counted by release validation.
      if (clamped <= reported) return;
      reported = clamped;
      this.#onProgress(clamped);
    };

    await this.#init();
    for (const bundle of requested) {
      const weight = Math.max(1, bundle.assets.length);
      if (this.#loaded.has(bundle.name)) {
        done += weight;
        report(done / total);
        continue;
      }
      try {
        await this.#backend.loadBundle(bundle.name, (fraction) => {
          report((done + weight * Math.min(1, Math.max(0, fraction))) / total);
        });
      } catch (cause) {
        // Pixi reports the failure for the bundle, not the file, so the message names the
        // bundle and its assets and carries the original text, which holds the actual URL.
        // Folded into the message rather than passed as `cause`: tsconfig.base.json targets
        // ES2020, where Error has no cause option, and the template's target is not this
        // task's to change.
        const detail = cause instanceof Error ? cause.message : String(cause);
        const aliases = bundle.assets.map((entry) => entry.alias).join(", ");
        throw new Error(`asset bundle "${bundle.name}" failed to load (${aliases}): ${detail}`);
      }
      this.#loaded.add(bundle.name);
      done += weight;
      report(done / total);
    }
    report(1);
  }

  /** Whether `alias` is declared and its bundle is loaded. */
  has(alias: string): boolean {
    const bundle = this.#bundleOf.get(alias);
    return bundle !== undefined && this.#loaded.has(bundle);
  }

  /**
   * A loaded asset. Throws rather than returning undefined: a missing texture that reaches
   * the renderer is a blank screen with no explanation, which is worse to debug than a
   * throw naming the bundle that was never loaded.
   */
  get<T>(alias: string): T {
    const bundle = this.#bundleOf.get(alias);
    if (bundle === undefined) {
      throw new Error(`asset "${alias}" is not in the manifest`);
    }
    if (!this.#loaded.has(bundle)) {
      throw new Error(`asset "${alias}" is not loaded yet — await load("${bundle}") first`);
    }
    const value = this.#backend.get(alias);
    if (value === undefined) {
      throw new Error(`asset "${alias}" is missing from bundle "${bundle}" after loading it`);
    }
    return value as T;
  }

  /** A loaded image, checked against what the manifest says the alias is. */
  texture(alias: string): Texture {
    const entry = this.#entries.get(alias);
    if (entry) {
      const kind = assetKind(entry);
      if (kind !== undefined && kind !== "texture") {
        throw new Error(`asset "${alias}" is declared as ${kind}, not a texture`);
      }
    }
    return this.get<Texture>(alias);
  }

  /** Release a bundle's assets. Loading it again re-fetches. */
  async unload(bundleName: string): Promise<void> {
    this.#requireBundle(bundleName);
    if (!this.#loaded.has(bundleName)) return;
    await this.#backend.unloadBundle(bundleName);
    this.#loaded.delete(bundleName);
  }

  #requireBundle(name: string): AssetBundle {
    const bundle = this.#bundles.get(name);
    if (!bundle) {
      throw new Error(
        `asset bundle "${name}" is not in the manifest (have: ${[...this.#bundles.keys()].join(", ") || "none"})`,
      );
    }
    return bundle;
  }

  #init(): Promise<void> {
    this.#initialized ??= this.#backend.init(this.#manifest, this.#basePath);
    return this.#initialized;
  }
}

/** The real backend: Pixi's `Assets`, which owns the cache and the parsers. */
export class PixiAssetBackend implements AssetBackend {
  async init(manifest: AssetManifest, basePath: string): Promise<void> {
    await Assets.init({
      manifest: {
        bundles: manifest.bundles.map((bundle) => ({
          name: bundle.name,
          assets: bundle.assets.map((entry) => ({
            alias: entry.alias,
            src: `${basePath}${entry.src}`,
          })),
        })),
      },
    });
  }

  async loadBundle(name: string, onProgress: (fraction: number) => void): Promise<void> {
    await Assets.loadBundle(name, onProgress);
  }

  async unloadBundle(name: string): Promise<void> {
    await Assets.unloadBundle(name);
  }

  get(alias: string): unknown {
    return Assets.cache.get(alias);
  }
}
