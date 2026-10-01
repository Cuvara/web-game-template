# Three.js games

What a game built on `engine.type: threejs` gets from the template, and how to reach it. The
code is `packages/three-framework` (`@wgf/three-framework`), which only a build with
`engine.type: threejs` contains — `src/rendering/create-renderer.ts` imports each engine
dynamically so the other one is dropped from the bundle.

Everything below except `ThreeRenderer` is optional, and the package is marked
`sideEffects: false`: a build contains exactly the helpers the game imports and nothing else.
Import them inside `src/rendering/threejs/`, the one directory allowed to import `three`.

## Reaching the renderer

`src/main.ts` creates and initialises the renderer before the game exists and passes it as the
engine-agnostic `Renderer`. Narrow it once:

```ts
import { asThreeRenderer } from "@wgf/three-framework";

const three = asThreeRenderer(context.renderer); // throws, naming game.config.yaml, on pixijs
three.scene.add(level);
three.camera.position.set(0, 4, 8);
```

`ThreeRenderer` exposes `scene`, `camera` (a `PerspectiveCamera`), `webgl` (the
`WebGLRenderer`) and `contextLost`, plus the settings `create-renderer.ts` cannot pass because
it constructs the renderer with no arguments:

| Call                                           | Effect                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `three.setMaxPixelRatio(1.5)`                  | Lower the drawing-buffer cap (default 2) on a fill-rate-bound title     |
| `three.setShadows("soft" \| "basic" \| "off")` | Shadow mapping; off by default, so a title that needs none pays nothing |
| `three.setBackground(0x101014 \| null)`        | Scene backdrop; `null` for a transparent canvas                         |
| `three.configureCamera({ fov, near, far })`    | The lens. Position and orientation stay the game's                      |

The renderer caps the pixel ratio at 2 and **re-applies it on every resize**, so a window moved
to a screen with a different device pixel ratio redraws at the new one. It also handles
`webglcontextlost` (a backgrounded mobile tab, a GPU reset): rendering pauses instead of
throwing, and resumes when the browser restores the context.

## Lights

The scene starts empty. A title drawn entirely with `MeshBasicMaterial` needs no lights;
anything using a standard or physical material does:

```ts
import { addDefaultLights } from "@wgf/three-framework";

const lights = addDefaultLights(three.scene, { shadows: true, shadowRadius: 15 });
three.setShadows("soft"); // and castShadow / receiveShadow on your own meshes
// lights.key, lights.ambient to tune; lights.dispose() to remove
```

## Assets: GLB, GLTF and textures

`ThreeAssets` is one cache, one progress source and one `dispose()`:

```ts
import { ThreeAssets } from "@wgf/three-framework";

const assets = new ThreeAssets({
  basePath: "./assets", // keep it relative: portals serve from a path they choose
  onProgress: context.reportLoadingProgress,
});

const gltf = await assets.loadGltf("hero.glb");
const enemy = await assets.instantiate("enemy.glb"); // a copy that shares the cached data
const sky = await assets.loadTexture("sky.webp");
await assets.loadAll(["level.glb", "props.glb", "atlas.webp"]); // one batch, one progress bar
```

- Hand `onProgress` to `context.reportLoadingProgress`. Profiles with `loading_api: required`
  list "does not report loading progress" as a rejection cause, and `main.ts` maps your
  fraction into the portal's loading bar.
- `instantiate` clones with `SkeletonUtils`, because `Object3D.clone()` re-uses the source's
  skeleton bindings and animates every copy as if it were the first.
- A clone shares the cache's geometry and materials. Tear a level down with
  `disposeObject3D(level, { keep: assets.resources })`; free the cache itself with
  `assets.dispose()`.

### Compressed assets

Draco, KTX2 and meshopt decoders are **not** shipped with the template: they are around a
megabyte that most titles never use, and every platform profile caps bundle size. Copy the
decoder your assets need into `public/` and point at it — the decoder module is then imported
dynamically, so a build that configures none contains none:

```ts
const assets = new ThreeAssets({
  draco: { decoderPath: "./draco/" }, // node_modules/three/examples/jsm/libs/draco/
  ktx2: { transcoderPath: "./basis/", renderer: three }, // …/libs/basis/
  meshopt: true, // decoder comes from three's addons, ~30 kB
});
```

## Animation

`AnimationMixer` takes seconds, and the obvious thing to feed it — the delta between two
rendered frames — makes every animation run at a speed that depends on the frame rate. The
template's loop is fixed-step, so drive animation from `Scene.update(stepMs)`:

```ts
import { AnimationController } from "@wgf/three-framework";

const gltf = await assets.loadGltf("hero.glb");
const animation = new AnimationController(gltf.scene, gltf.animations);
animation.play("idle");

// Scene.update(stepMs)
animation.update(stepMs);
animation.play(moving ? "run" : "idle", { fadeMs: 150 }); // re-playing the current clip is a no-op
animation.play("attack", { loop: false });
animation.onFinished("attack", () => (state = "idle"));
```

## Cameras

All three rigs are driven by the game, never by their own timer.

```ts
import { FollowCamera, FirstPersonRig, OrbitRig } from "@wgf/three-framework";

// Third person: exponential damping, so it behaves the same at any step size.
const follow = new FollowCamera(three.camera, { offset: [0, 3, -6], stiffness: 6 });
follow.setTarget(player);
follow.snap(); // on spawn and on restart, so the camera does not fly in
// Scene.update(stepMs): follow.update(stepMs);

// First person: pointer lock plus movement; the intent comes from the game's own input.
const rig = new FirstPersonRig(three, { speed: 5 });
rig.onLockChange((locked) => (locked ? hidePrompt() : context.gameplay.pause()));
ui.addEventListener("click", () => rig.requestLock()); // a user gesture is required
// Scene.update(stepMs): rig.update(stepMs, { forward: keys.y, right: keys.x, run: keys.shift });

// Orbit: damped, no pan, distance-limited. Damping is per frame, not per step.
const orbit = new OrbitRig(three, { minDistance: 4, maxDistance: 20 });
// Scene.render(): orbit.update();
```

`FirstPersonRig` owns the pointer and the camera, never the keyboard: input stays the game's
(`src/input/`), and so do gravity, collision and head bob.

## Disposal and restart

three.js frees nothing automatically: removing a mesh from a scene leaves its geometry,
material and textures on the GPU. A game that rebuilds its level on every restart grows until
the tab closes.

```ts
import { disposeObject3D } from "@wgf/three-framework";

// Scene.exit(), or when a run ends
disposeObject3D(level, { keep: assets.resources });

// GameHandle.dispose()
assets.dispose();
```

`ThreeRenderer.destroy()` disposes whatever is still in the scene, so a page unload is covered
without the game doing anything.

## Physics

The template ships **no** physics: no dependency, no WebAssembly, no wrapper, no runtime. What
a game does is decided by `architecture.physics` in the tech plan, and that decision is
authoritative:

| `architecture.physics` | What the game does                                              |
| ---------------------- | --------------------------------------------------------------- |
| `rapier`               | Add Rapier as a **game** dependency and follow the recipe below |
| `custom`               | Write the motion the design needs. Do not introduce Rapier      |
| absent                 | No physics dependency — do not invent one                       |

### Rapier recipe

```bash
pnpm add @dimforge/rapier3d-compat   # then commit pnpm-lock.yaml
```

`rapier3d-compat` is the build that loads its WebAssembly itself, which is what works through
Vite on every portal without extra plugins. It must be initialised before a world exists, so
do it inside `createGame` while the loading bar is still up:

```ts
import RAPIER from "@dimforge/rapier3d-compat";

export async function createGame(context: GameContext): Promise<GameHandle> {
  await RAPIER.init(); // resolves once the wasm is ready; nothing works before it
  context.reportLoadingProgress(0.5);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // One fixed step, set once: the simulation must not depend on the frame rate.
  world.timestep = STEP_MS / 1000; // STEP_MS is the loop's step — 1000/60 by default
  ...
}
```

Step it from the scene's fixed update, never from `render`:

```ts
update(stepMs: number): void {
  world.step();          // exactly one step per simulation step
  const t = body.translation();
  this.#previous.copy(this.#current);
  this.#current.set(t.x, t.y, t.z);
}

render(alpha: number): void {
  // alpha is the loop's interpolation factor: draw between the last two physics states so
  // motion is smooth even though the simulation runs at a fixed rate.
  mesh.position.lerpVectors(this.#previous, this.#current, alpha);
}
```

Cleanup, from `GameHandle.dispose` (and whenever a level is rebuilt):

```ts
world.free(); // frees the wasm-side world, colliders and bodies; nothing else does
disposeObject3D(level, { keep: assets.resources });
assets.dispose();
```

Two things to keep straight: never call `world.step()` more than once per `update`, and never
keep a `RAPIER.Vector3` returned by `translation()` — it is a view, valid until the next step.

## What is still yours

Gameplay, input (`src/input/`), audio (`src/audio/`), UI (`src/ui/`), materials and art
direction, and every platform call — which goes through `context.integration` or
`context.gameplay`, never through a portal SDK. See [development.md](development.md).
