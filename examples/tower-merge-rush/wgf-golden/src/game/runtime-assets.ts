// The runtime asset manifest: public/assets/assets.json, written by the Factory's assets step.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. Fetched once at boot; every file the game draws is resolved from it by the
// design's asset id - never a path in code. An id the design does not use is looked up by its
// role instead (build_spec.assets[].role), so a library mapped by role still lands. A build
// without a manifest (the greybox, before the assets step) boots with no art at all, and every
// view falls back to primitives - which the play probe reports as such.
//
// Engine-free: textures are the PixiJS view's business (rendering/pixijs/art.ts). This module
// loads what the DOM draws (fonts and images) and records every id loaded, for the probe's
// assets_loaded.

export type AssetRole =
  | "player"
  | "threat"
  | "goal"
  | "target"
  | "projectile"
  | "collectible"
  | "hazard"
  | "environment"
  | "background"
  | "prop"
  | "ui"
  | "vfx"
  | "icon"
  | "font";

export interface RuntimeAsset {
  readonly type: string;
  readonly url?: string;
  readonly format?: string;
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
  readonly placeholder?: boolean;
  readonly role?: AssetRole | null;
  readonly variants?: readonly string[];
  readonly family?: string;
}

interface Manifest {
  readonly format: string;
  readonly assets: Readonly<Record<string, RuntimeAsset>>;
}

/** What the game asks the manifest for: the design's id first, then any asset of the role. */
export interface AssetQuery {
  readonly id: string;
  readonly role?: AssetRole;
  /** Among several of one role, prefer this shape (the wordmark is wide, the panel square). */
  readonly wide?: boolean;
}

/** The two faces the UI is set in: the identity's display face and its body face. */
export const FONT_DISPLAY = "wgf-display";
export const FONT_BODY = "wgf-body";

export class RuntimeAssets {
  readonly manifestUrl: string;
  readonly #manifest: Manifest | null;
  readonly #loaded = new Set<string>();

  private constructor(manifestUrl: string, manifest: Manifest | null) {
    this.manifestUrl = manifestUrl;
    this.#manifest = manifest;
  }

  /** Fetch public/assets/assets.json. Missing (a greybox build) is an empty manifest. */
  static async fetch(): Promise<RuntimeAssets> {
    const manifestUrl = new URL("assets/assets.json", document.baseURI).href;
    try {
      const response = await fetch(manifestUrl, { cache: "no-cache" });
      // A static server's single-page fallback answers a missing file with index.html.
      const json = (response.headers.get("content-type") ?? "").includes("json");
      if (!response.ok || !json) return new RuntimeAssets(manifestUrl, null);
      const manifest = (await response.json()) as Manifest;
      if (manifest.format !== "wgf-runtime-assets" || typeof manifest.assets !== "object") {
        throw new Error(`${manifestUrl} is not a wgf-runtime-assets manifest`);
      }
      return new RuntimeAssets(manifestUrl, manifest);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`${manifestUrl} is not JSON`);
      if (error instanceof TypeError) return new RuntimeAssets(manifestUrl, null);
      throw error;
    }
  }

  /** True when the build ships a runtime manifest at all. */
  get present(): boolean {
    return this.#manifest !== null;
  }

  /** Ids of every asset loaded so far (the play probe's assets_loaded). */
  get loaded(): string[] {
    return [...this.#loaded].sort();
  }

  /** Record an asset as loaded; a counted asset is loaded once all its drawings are. */
  markLoaded(id: string): void {
    this.#loaded.add(id);
    for (const [parent, entry] of Object.entries(this.#manifest?.assets ?? {})) {
      const variants = entry.variants ?? [];
      if (variants.includes(id) && variants.every((v) => this.#loaded.has(v))) {
        this.#loaded.add(parent);
      }
    }
  }

  entry(id: string): RuntimeAsset | null {
    return this.#manifest?.assets[id] ?? null;
  }

  /** The asset answering a query: by id, else the first of its role (wide or not). */
  find(query: AssetQuery): string | null {
    const assets = this.#manifest?.assets;
    if (!assets) return null;
    if (assets[query.id]) return query.id;
    if (!query.role) return null;
    const ofRole = Object.keys(assets)
      .filter((id) => assets[id]!.role === query.role && !this.#isVariantOfAnother(id))
      .sort();
    if (query.wide === undefined) return ofRole[0] ?? null;
    const wide = (id: string): boolean => {
      const a = assets[id]!;
      return (a.width ?? 0) > (a.height ?? 0) * 1.5;
    };
    return ofRole.find((id) => wide(id) === query.wide) ?? ofRole[0] ?? null;
  }

  /** The ids of a counted asset's drawings, in order; a single drawing is a list of one. */
  drawings(query: AssetQuery): string[] {
    const id = this.find(query);
    if (!id) return [];
    const variants = this.entry(id)?.variants;
    return variants && variants.length > 0 ? [...variants] : [id];
  }

  /** Absolute URL of an asset's file (relative to the manifest), or null. */
  url(id: string | null): string | null {
    if (!id) return null;
    const url = this.entry(id)?.url;
    return url ? new URL(url, this.manifestUrl).href : null;
  }

  /**
   * Bundle the identity's faces: @font-face rules for the font asset's files - the first
   * drawing the display face, the second the body face - awaited before the first UI frame.
   * A font entry with only a `family` is the pipeline's stated stand-in, used as given.
   */
  async loadFonts(query: AssetQuery): Promise<void> {
    const ids = this.drawings(query);
    const faces: string[] = [];
    const families: Record<string, string> = {};
    ids.slice(0, 2).forEach((id, n) => {
      const name = n === 0 ? FONT_DISPLAY : FONT_BODY;
      const url = this.url(id);
      if (url) {
        faces.push(
          `@font-face{font-family:"${name}";src:url("${url}") format("${this.#fontFormat(id)}");` +
            `font-weight:100 900;font-display:block;}`,
        );
      } else if (this.entry(id)?.family) {
        families[name] = this.entry(id)!.family!;
      }
    });
    if (ids.length === 1 && faces.length === 1) {
      // One face for both roles.
      faces.push(faces[0]!.replace(FONT_DISPLAY, FONT_BODY));
    }
    const style = document.createElement("style");
    style.dataset["wgf"] = "fonts";
    style.textContent = faces.join("\n");
    document.head.append(style);
    const root = document.documentElement.style;
    for (const [name, family] of Object.entries(families)) {
      root.setProperty(name === FONT_DISPLAY ? "--font-display" : "--font-body", family);
    }
    await Promise.all(
      ids.slice(0, 2).map(async (id, n) => {
        if (!this.url(id)) {
          if (this.entry(id)) this.markLoaded(id);
          return;
        }
        const name = n === 0 ? FONT_DISPLAY : FONT_BODY;
        const found = await document.fonts.load(`700 24px "${name}"`);
        if (found.length > 0) this.markLoaded(id);
      }),
    );
  }

  /** Fetch and decode images the DOM shows, so the first screen never pops in. */
  async preloadImages(ids: readonly (string | null)[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const url = this.url(id);
        if (!id || !url) return;
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
          this.markLoaded(id);
        } catch {
          // Reported by its absence from assets_loaded.
        }
      }),
    );
  }

  #fontFormat(id: string): string {
    const format = this.entry(id)?.format ?? "woff2";
    return format === "ttf" ? "truetype" : format === "otf" ? "opentype" : format;
  }

  #isVariantOfAnother(id: string): boolean {
    const assets = this.#manifest?.assets ?? {};
    return Object.entries(assets).some(
      ([other, entry]) => other !== id && (entry.variants ?? []).includes(id),
    );
  }
}
