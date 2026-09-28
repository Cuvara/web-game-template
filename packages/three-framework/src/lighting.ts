// A lit scene in one call.
//
// Opt-in: the renderer creates an empty scene, because an unlit title (everything drawn with
// MeshBasicMaterial) should pay for no lights at all. Anything using a standard or physical
// material needs at least a key light and some ambient fill, and that setup is identical in
// every such game — so it lives here instead of being written again per title.

import { DirectionalLight, Group, HemisphereLight, type Scene } from "three";

export interface DefaultLightsOptions {
  /** Sun colour and strength. */
  readonly keyColor?: number;
  readonly keyIntensity?: number;
  /** Where the key light sits, looking at the origin. */
  readonly keyPosition?: readonly [number, number, number];
  /** Sky/ground fill, so unlit faces are not pure black. */
  readonly skyColor?: number;
  readonly groundColor?: number;
  readonly ambientIntensity?: number;
  /**
   * Cast shadows from the key light. Also needs `renderer.setShadows(...)` and `castShadow` /
   * `receiveShadow` on the game's own meshes.
   */
  readonly shadows?: boolean;
  /** Half-size of the shadow camera's box, in world units. Cover the playfield, no more. */
  readonly shadowRadius?: number;
  /** Shadow map resolution. 1024 is the low-end floor's budget. */
  readonly shadowMapSize?: number;
}

export interface DefaultLights {
  /** Added to the scene; move or re-parent it freely. */
  readonly group: Group;
  readonly key: DirectionalLight;
  readonly ambient: HemisphereLight;
  /** Remove the lights from the scene and free them. */
  dispose(): void;
}

/**
 * Add a key light plus hemisphere fill to `scene` and return the handles.
 *
 * The defaults are a neutral three-quarter key from above and slightly behind the camera's
 * usual position — readable on any material without looking authored.
 */
export function addDefaultLights(scene: Scene, options: DefaultLightsOptions = {}): DefaultLights {
  const group = new Group();
  group.name = "default-lights";

  const ambient = new HemisphereLight(
    options.skyColor ?? 0xbfd4ff,
    options.groundColor ?? 0x39312a,
    options.ambientIntensity ?? 1.2,
  );
  group.add(ambient);

  const key = new DirectionalLight(options.keyColor ?? 0xffffff, options.keyIntensity ?? 2.2);
  const [x, y, z] = options.keyPosition ?? [6, 10, 6];
  key.position.set(x, y, z);
  key.target.position.set(0, 0, 0);
  group.add(key, key.target);

  if (options.shadows) {
    const radius = options.shadowRadius ?? 12;
    const size = options.shadowMapSize ?? 1024;
    key.castShadow = true;
    key.shadow.mapSize.set(size, size);
    key.shadow.camera.left = -radius;
    key.shadow.camera.right = radius;
    key.shadow.camera.top = radius;
    key.shadow.camera.bottom = -radius;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = radius * 4;
    // Shadow acne on large flat floors is the default's most visible failure.
    key.shadow.bias = -0.0005;
    key.shadow.camera.updateProjectionMatrix();
  }

  scene.add(group);

  return {
    group,
    key,
    ambient,
    dispose: (): void => {
      key.dispose();
      ambient.dispose();
      key.shadow.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
