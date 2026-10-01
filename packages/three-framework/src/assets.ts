// GLB/GLTF and texture loading, cached, with progress and a way to free it all again.
//
// Three things every 3D title needs and none should have to write: one cache so a model is
// fetched once, load progress in [0,1] to hand to `context.reportLoadingProgress` (portals
// whose profile sets `loading_api: required` reject a game that reports none), and a dispose
// that actually frees the GPU memory.
//
// Compressed-asset decoders (Draco, KTX2, meshopt) are NOT shipped with the template: they
// are ~1 MB of decoder that most titles never use, and every profile caps bundle size. A game
// that ships compressed assets copies the decoder into public/ and passes its path here; the
// decoder module is then imported dynamically, so a build that configures none contains none.

import {
  LoadingManager,
  Mesh,
  Texture,
  TextureLoader,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { ThreeRenderer } from "./renderer.js";

export interface DracoOptions {
  /** Directory the Draco decoder was copied into, e.g. `"./draco/"` (relative — portals). */
  readonly decoderPath: string;
}

export interface Ktx2Options {
  /** Directory holding the basis transcoder, e.g. `"./basis/"`. */
  readonly transcoderPath: string;
  /** Needed for `detectSupport`: which compressed formats this GPU actually takes. */
  readonly renderer: ThreeRenderer;
}

export interface ThreeAssetsOptions {
  /** Prefixed to every relative url. Keep it relative: portals serve from a path they pick. */
  readonly basePath?: string;
  /** Called with overall progress in [0,1], never decreasing. */
  readonly onProgress?: (fraction: number) => void;
  readonly draco?: DracoOptions;
  readonly ktx2?: Ktx2Options;
  /** Meshopt-compressed geometry. Decoder is imported from three's addons, ~30 kB. */
  readonly meshopt?: boolean;
  /** Supply the manager (tests, or sharing one with another loader). */
  readonly manager?: LoadingManager;
  /** Supply the GLTF load step. Tests use it; a custom pipeline might. */
  readonly loadGltf?: (url: string, manager: LoadingManager) => Promise<GLTF>;
  /** Supply the texture load step. */
  readonly loadTexture?: (url: string, manager: LoadingManager) => Promise<Texture>;
}

type Tracked = BufferGeometry | Material | Texture;

/**
 * The game's asset cache. One per game is normal; create it in `createGame`, hand its
 * `onProgress` to `context.reportLoadingProgress`, and call `dispose()` from
 * `GameHandle.dispose`.
 */
export class ThreeAssets {
  readonly #options: ThreeAssetsOptions;
  readonly #manager: LoadingManager;
  readonly #gltfCache = new Map<string, Promise<GLTF>>();
  readonly #textureCache = new Map<string, Promise<Texture>>();
  readonly #tracked = new Set<Tracked>();
  #decoders: Promise<void> | null = null;
  #gltfLoader: GLTFLoader | null = null;
  #textureLoader: TextureLoader | null = null;
  #dracoLoader: { dispose(): void } | null = null;
  #ktx2Loader: { dispose(): void } | null = null;
  #reported = 0;

  constructor(options: ThreeAssetsOptions = {}) {
    this.#options = options;
    this.#manager = options.manager ?? new LoadingManager();
    this.#manager.onProgress = (_url, loaded, total): void => {
      this.#report(total > 0 ? loaded / total : 1);
    };
    this.#manager.onLoad = (): void => {
      this.#report(1);
    };
  }

  /**
   * Everything loaded so far, for `disposeObject3D(root, { keep: assets.resources })`: a
   * model instantiated from the cache shares the cache's geometry and materials, so tearing
   * a level down must not free them while the cache still hands them out.
   */
  get resources(): Iterable<Tracked> {
    return this.#tracked;
  }

  /** Load a .glb/.gltf. The same url resolves to the same promise. */
  async loadGltf(url: string): Promise<GLTF> {
    const resolved = this.#resolve(url);
    const cached = this.#gltfCache.get(resolved);
    if (cached) return cached;
    const pending = this.#loadGltfUncached(resolved);
    this.#gltfCache.set(resolved, pending);
    return pending;
  }

  /** Load a texture. Colour maps need `texture.colorSpace = SRGBColorSpace` from the game. */
  async loadTexture(url: string): Promise<Texture> {
    const resolved = this.#resolve(url);
    const cached = this.#textureCache.get(resolved);
    if (cached) return cached;
    const pending = (async (): Promise<Texture> => {
      const load =
        this.#options.loadTexture ??
        ((target: string, manager: LoadingManager): Promise<Texture> =>
          (this.#textureLoader ??= new TextureLoader(manager)).loadAsync(target));
      const texture = await load(resolved, this.#manager);
      this.#tracked.add(texture);
      return texture;
    })();
    this.#textureCache.set(resolved, pending);
    return pending;
  }

  /**
   * Load several assets as one batch; `.glb`/`.gltf` go through {@link loadGltf}, everything
   * else through {@link loadTexture}. Progress covers the whole batch.
   */
  async loadAll(urls: readonly string[]): Promise<void> {
    await Promise.all(
      urls.map((url) => (isModel(url) ? this.loadGltf(url) : this.loadTexture(url))),
    );
    this.#report(1);
  }

  /**
   * A fresh copy of a loaded model, ready to add to a scene. Skinned meshes are cloned with
   * SkeletonUtils — `Object3D.clone()` re-uses the source's skeleton bindings, which animates
   * every copy as though it were the first one. Geometry and materials are shared with the
   * cache, so a clone is cheap and must not be disposed on its own.
   */
  async instantiate(url: string): Promise<Object3D> {
    const gltf = await this.loadGltf(url);
    return cloneSkeleton(gltf.scene);
  }

  /** Free every cached geometry, material and texture, and the decoders. */
  dispose(): void {
    for (const resource of this.#tracked) resource.dispose();
    this.#tracked.clear();
    this.#gltfCache.clear();
    this.#textureCache.clear();
    this.#dracoLoader?.dispose();
    this.#ktx2Loader?.dispose();
    this.#dracoLoader = null;
    this.#ktx2Loader = null;
    this.#gltfLoader = null;
    this.#textureLoader = null;
    this.#decoders = null;
  }

  async #loadGltfUncached(resolved: string): Promise<GLTF> {
    const load =
      this.#options.loadGltf ??
      (async (target: string, manager: LoadingManager): Promise<GLTF> => {
        await this.#ensureDecoders();
        this.#gltfLoader ??= new GLTFLoader(manager);
        return this.#gltfLoader.loadAsync(target);
      });
    const gltf = await load(resolved, this.#manager);
    this.#track(gltf.scene);
    return gltf;
  }

  /** Record what a loaded model put on the GPU so `dispose()` can free exactly that. */
  #track(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry as BufferGeometry | undefined;
      if (geometry) this.#tracked.add(geometry);
      const material = object.material as Material | Material[] | undefined;
      for (const one of Array.isArray(material) ? material : material ? [material] : []) {
        this.#tracked.add(one);
        for (const value of Object.values(one as unknown as Record<string, unknown>)) {
          if (value instanceof Texture) this.#tracked.add(value);
        }
      }
    });
  }

  /**
   * Attach the configured decoders to the GLTF loader. Dynamic imports: a game that
   * configures no decoder never pulls their code into its bundle.
   */
  async #ensureDecoders(): Promise<void> {
    this.#decoders ??= (async (): Promise<void> => {
      const { draco, ktx2, meshopt } = this.#options;
      if (!draco && !ktx2 && !meshopt) return;
      this.#gltfLoader ??= new GLTFLoader(this.#manager);
      const loader = this.#gltfLoader;
      if (draco) {
        const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
        const dracoLoader = new DRACOLoader().setDecoderPath(draco.decoderPath);
        this.#dracoLoader = dracoLoader;
        loader.setDRACOLoader(dracoLoader);
      }
      if (ktx2) {
        const { KTX2Loader } = await import("three/addons/loaders/KTX2Loader.js");
        const ktx2Loader = new KTX2Loader()
          .setTranscoderPath(ktx2.transcoderPath)
          .detectSupport(ktx2.renderer.webgl);
        this.#ktx2Loader = ktx2Loader;
        loader.setKTX2Loader(ktx2Loader);
      }
      if (meshopt) {
        const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
        loader.setMeshoptDecoder(MeshoptDecoder);
      }
    })();
    return this.#decoders;
  }

  #resolve(url: string): string {
    const base = this.#options.basePath;
    if (!base || isAbsolute(url)) return url;
    return base.endsWith("/") ? `${base}${url}` : `${base}/${url}`;
  }

  /** Progress only ever moves forward: a second batch must not send the bar backwards. */
  #report(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    if (clamped <= this.#reported) return;
    this.#reported = clamped;
    this.#options.onProgress?.(clamped);
  }
}

function isAbsolute(url: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:") || url.startsWith("/");
}

function isModel(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path.endsWith(".glb") || path.endsWith(".gltf");
}
