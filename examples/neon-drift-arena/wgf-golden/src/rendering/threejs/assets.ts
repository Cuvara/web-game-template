// Loads Neon Drift Arena's production assets through the runtime asset manifest.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. public/assets/assets.json is the Factory's runtime manifest (its
// core/artifacts/shared/runtime-assets.schema.json): asset ids to files, every url relative
// to the manifest. The models are GLBs the Factory's pinned Blender built from model specs
// (wgf-golden/library/); they are found by the role the design gives them, so the same code
// reads a manifest whose ids are the requirement's (`craft`) or a counted requirement's
// variants (`arena-kit-1`). A model that is missing, fails to load, or is a placeholder is a
// boot error - never an empty or boxed scene.

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface ManifestEntry {
  readonly type: string;
  readonly url?: string;
  readonly format?: string;
  readonly role?: string;
  readonly placeholder?: boolean;
  readonly variants?: readonly string[];
}

interface Manifest {
  readonly format: string;
  readonly assets: Readonly<Record<string, ManifestEntry>>;
}

/** A loaded model: the manifest id that drew it, and its scene to clone per instance. */
export interface LoadedModel {
  readonly id: string;
  readonly scene: Group;
}

export interface ArenaAssets {
  readonly craft: LoadedModel;
  readonly wall: LoadedModel;
  readonly track: LoadedModel;
  readonly skyline: LoadedModel;
  /** The sky gradient (`sky`) and the crash burst's particle (`crash-vfx`), when delivered. */
  readonly textures: { readonly sky: Texture | null; readonly spark: Texture | null };
  /** UI files by purpose: CSS-ready absolute URLs. */
  readonly ui: {
    readonly wordmark: string | null;
    /** The ui-kit panel: a 9-slice frame for the pause and result cards. */
    readonly panel: string | null;
    readonly icons: Readonly<Record<string, string>>;
  };
  /** Manifest ids loaded so far, for the play probe's `assets_loaded`. */
  readonly loaded: readonly string[];
}

/** The display, body and numeric faces, in the order the library lists the font files. */
export const FONT_FAMILIES = ["NDA Display", "NDA Body", "NDA Numeric"] as const;
/** The icon glyphs, in the order the design lists them (build_spec `icons`). */
const ICONS = ["play", "pause", "retry", "menu", "sound", "ad"] as const;

const MODEL_FORMATS = new Set(["glb", "gltf"]);

export const MANIFEST_PATH = "assets/assets.json";

/** The GLB root's name: the model spec's asset id, which the build stamps on the root node. */
function rootName(scene: Object3D): string {
  const named = scene.children.length === 1 ? scene.children[0] : scene;
  const wgf = named?.userData["wgf_asset"];
  return typeof wgf === "string" ? wgf : (named?.name ?? "");
}

/** A plain lit box, `size` metres, standing on y = 0 at `at` (x, z). */
function box(
  size: readonly [number, number, number],
  color: number,
  at: readonly [number, number] = [0, 0],
  lift = 0,
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(size[0], size[1], size[2]),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }),
  );
  mesh.position.set(at[0], lift + size[1] / 2, at[1]);
  return mesh;
}

function stand(id: string, ...meshes: Mesh[]): LoadedModel {
  const scene = new Group();
  scene.add(...meshes);
  return { id, scene };
}

/**
 * What a build with no runtime asset manifest draws: the greybox, before the assets exist
 * (the Factory's greybox phase). Plain boxes at the production models' sizes and pivots, in
 * the palette, with no `wgf_asset` stamp - so the play probe reports every one as a
 * primitive with no asset, and never claims art the build does not have.
 */
export function greyboxAssets(): ArenaAssets {
  return {
    craft: stand("", box([1.0, 0.3, 1.5], 0x2ef2ff)),
    wall: stand("", box([1.0, 1.1, 0.3], 0xff2e88)),
    track: stand(
      "",
      box([9.0, 0.02, 10.0], 0x2a2450, [0, 0], -0.02),
      box([0.08, 0.04, 10.0], 0x2ef2ff, [-4.4, 0]),
      box([0.08, 0.04, 10.0], 0x2ef2ff, [4.4, 0]),
    ),
    skyline: stand(
      "",
      box([12, 9, 6], 0x3a2f6e, [-14, -16]),
      box([10, 13, 6], 0x31285e, [0, -20]),
      box([12, 7, 6], 0x3a2f6e, [14, -16]),
    ),
    textures: { sky: null, spark: null },
    ui: { wordmark: null, panel: null, icons: {} },
    loaded: [],
  };
}

/**
 * Fetch the manifest and everything Neon Drift Arena draws with. `progress` gets 0..1 as
 * files arrive, for the platform's loading bar. No manifest at all (a greybox build: none
 * is served, or the preview server answers its SPA page instead) draws greyboxAssets(); a
 * manifest that is malformed, or lacks a production model, still fails the boot visibly.
 */
export async function loadArenaAssets(
  base: string,
  progress: (fraction: number) => void = () => undefined,
): Promise<ArenaAssets> {
  const manifestUrl = new URL(MANIFEST_PATH, base).href;
  const response = await fetch(manifestUrl);
  const json = (response.headers.get("content-type") ?? "").includes("json");
  if (response.status === 404 || (response.ok && !json)) {
    progress(1);
    return greyboxAssets();
  }
  if (!response.ok) throw new Error(`${MANIFEST_PATH}: HTTP ${response.status}`);
  const manifest = (await response.json()) as Manifest;
  if (manifest.format !== "wgf-runtime-assets") {
    throw new Error(`${MANIFEST_PATH} is not a wgf-runtime-assets manifest`);
  }
  const entries = Object.entries(manifest.assets);
  const url = (entry: ManifestEntry): string => new URL(entry.url ?? "", manifestUrl).href;
  const loaded: string[] = [];

  // Every loadable model file, once: a counted requirement's own entry repeats its first
  // variant's file, so it is skipped when it lists variants. A placeholder (the Factory's
  // stand-in box) is never loaded: a role only it supplies fails the boot below.
  const models = entries.filter(
    ([, e]) => e.url && MODEL_FORMATS.has(e.format ?? "") && !e.variants?.length && !e.placeholder,
  );
  const fonts = entries.filter(([, e]) => e.type === "font" && e.url && !e.variants?.length);
  const icons = entries.filter(
    ([, e]) => e.type === "icon" && e.role === "icon" && e.url && !e.variants?.length,
  );
  const wordmark = entries.find(([id, e]) => id === "wordmark" && e.url);
  const panel = entries.find(([id, e]) => id === "ui-kit" && e.url && !e.placeholder);
  const image = (id: string): [string, ManifestEntry] | undefined =>
    entries.find(([key, e]) => key === id && e.url && !e.placeholder && e.format === "png");
  const textureLoader = new TextureLoader();
  const texture = async (id: string): Promise<Texture | null> => {
    const found = image(id);
    if (!found) return null;
    const loadedTexture = await textureLoader.loadAsync(url(found[1]));
    loadedTexture.colorSpace = SRGBColorSpace;
    loaded.push(id);
    return loadedTexture;
  };

  let done = 0;
  const total = models.length + fonts.length;
  const tick = (): void => progress(total ? ++done / total : 1);

  const loader = new GLTFLoader();
  const byRole = new Map<string, LoadedModel[]>();
  const byName = new Map<string, LoadedModel>();
  await Promise.all(
    models.map(async ([id, entry]) => {
      const gltf = await loader.loadAsync(url(entry));
      const model: LoadedModel = { id, scene: gltf.scene };
      const role = entry.role ?? "";
      byRole.set(role, [...(byRole.get(role) ?? []), model]);
      byName.set(rootName(gltf.scene), model);
      loaded.push(id);
      tick();
    }),
  );

  // Fonts: @font-face through the FontFace API, awaited before the first UI frame.
  await Promise.all(
    fonts
      .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
      .map(async ([id, entry], index) => {
        const family = FONT_FAMILIES[index];
        if (!family) return;
        const face = new FontFace(family, `url(${url(entry)})`, { display: "block" });
        document.fonts.add(await face.load());
        loaded.push(id);
        tick();
      }),
  );

  const iconUrls: Record<string, string> = {};
  icons
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .forEach(([id, entry], index) => {
      const name = ICONS[index];
      if (name) {
        iconUrls[name] = url(entry);
        loaded.push(id);
      }
    });
  if (wordmark) loaded.push(wordmark[0]);
  if (panel) loaded.push(panel[0]);
  const [sky, spark] = await Promise.all([texture("sky"), texture("crash-vfx")]);

  const pick = (name: string, role: string): LoadedModel => {
    const candidates = byRole.get(role) ?? [];
    const model = byName.get(name) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!model) throw new Error(`${MANIFEST_PATH} lists no production ${role} model "${name}"`);
    return model;
  };
  return {
    craft: pick("craft", "player"),
    wall: pick("wall", "threat"),
    track: pick("arena-track", "environment"),
    skyline: pick("arena-skyline", "environment"),
    textures: { sky, spark },
    ui: {
      wordmark: wordmark ? url(wordmark[1]) : null,
      panel: panel ? url(panel[1]) : null,
      icons: iconUrls,
    },
    loaded: loaded.sort(),
  };
}
