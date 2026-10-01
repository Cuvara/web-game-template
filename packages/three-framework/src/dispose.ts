// Freeing what a scene put on the GPU.
//
// three.js allocates GPU resources lazily and frees none of them automatically: removing a
// mesh from a scene drops the JavaScript reference and leaves the geometry, the material and
// its textures uploaded. A game that rebuilds its level on every restart therefore grows
// until the tab is closed — which is exactly the leak a restart-memory measurement looks for,
// and the reason this is template infrastructure rather than something each title rewrites.

import {
  Mesh,
  SkinnedMesh,
  Texture,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

export interface DisposeOptions {
  /**
   * Resources to leave alone — a shared geometry, or anything still cached by
   * {@link ThreeAssets}. Pass the same objects the cache holds.
   */
  readonly keep?: Iterable<BufferGeometry | Material | Texture>;
}

/**
 * Dispose every geometry, material, material texture and skeleton under `root`, then detach
 * `root` from its parent. Each resource is disposed once however many meshes share it.
 *
 * Call it when a scene exits, when a level is torn down, and from `GameHandle.dispose`.
 */
export function disposeObject3D(root: Object3D, options: DisposeOptions = {}): void {
  const seen = new Set<object>(options.keep ?? []);
  // Collected first: disposing while traversing mutates nothing here, but a material's
  // textures must be reached through the material, and a material may be shared.
  root.traverse((object) => {
    if (object instanceof Mesh) {
      disposeGeometry(object.geometry as BufferGeometry, seen);
      disposeMaterials(object.material as Material | Material[], seen);
    }
    if (object instanceof SkinnedMesh) object.skeleton?.dispose();
  });
  root.removeFromParent();
}

function disposeGeometry(geometry: BufferGeometry | undefined, seen: Set<object>): void {
  if (!geometry || seen.has(geometry)) return;
  seen.add(geometry);
  geometry.dispose();
}

function disposeMaterials(material: Material | Material[] | undefined, seen: Set<object>): void {
  if (!material) return;
  for (const one of Array.isArray(material) ? material : [material]) {
    if (seen.has(one)) continue;
    seen.add(one);
    disposeMaterialTextures(one, seen);
    one.dispose();
  }
}

/**
 * Every texture-valued property of a material — `map`, `normalMap`, `envMap`, and whatever a
 * custom material added. Read off the instance rather than from a list of known names so a
 * material this template has never heard of still frees its textures.
 */
function disposeMaterialTextures(material: Material, seen: Set<object>): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (!(value instanceof Texture) || seen.has(value)) continue;
    seen.add(value);
    value.dispose();
  }
}
