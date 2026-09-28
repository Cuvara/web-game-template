// Three.js binding for `engine.type: threejs`, and the 3D infrastructure a game would
// otherwise write before it could write any gameplay: asset loading with progress, animation
// on the fixed step, disposal, lights and camera rigs.
//
// Every export below is optional except ThreeRenderer, which src/rendering/create-renderer.ts
// constructs. The package is side-effect free, so a build contains only what the game imports
// — see docs/threejs.md.

export {
  ThreeRenderer,
  pixelRatioFor,
  type CameraSettings,
  type ShadowQuality,
} from "./renderer.js";
export { asThreeRenderer } from "./renderer-access.js";
export { disposeObject3D, type DisposeOptions } from "./dispose.js";
export { addDefaultLights, type DefaultLights, type DefaultLightsOptions } from "./lighting.js";
export {
  ThreeAssets,
  type DracoOptions,
  type Ktx2Options,
  type ThreeAssetsOptions,
} from "./assets.js";
export { AnimationController, type PlayOptions } from "./animation.js";
export { FollowCamera, type FollowCameraOptions } from "./camera/follow.js";
export {
  FirstPersonRig,
  type FirstPersonRigOptions,
  type MoveIntent,
} from "./camera/first-person.js";
export { OrbitRig, type OrbitRigOptions } from "./camera/orbit.js";
