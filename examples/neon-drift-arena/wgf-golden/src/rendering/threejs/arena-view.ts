// The Three.js half of Neon Drift Arena, drawn with its production models.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. It replaces the example's arena-view.ts (a box for the craft, boxes for the
// walls, a grid helper for the floor): the craft, the wall segments, the track and the
// skyline are GLBs built by the Factory's pinned Blender from model specs and loaded through
// the runtime asset manifest (assets.ts). It reads the pure Simulation and mirrors it into
// the scene; it never writes simulation state. Wall instances are pooled per obstacle id,
// each a clone of the one loaded wall (geometry and materials shared).

import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  type Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Obstacle, Simulation } from "../../game/simulation.js";
import type { ArenaAssets } from "./assets.js";

/** The floor's height in arena units: the simulation's walls and craft stand on it. */
const FLOOR_Y = -0.5;
/** Length of one track module (arena-track.model.json); modules tile toward the horizon. */
const TRACK_LENGTH = 10;
const TRACK_MODULES = 9;
/** The craft is fitted to 1.5 m long; this brings its span to the simulation's 1.0 width. */
const CRAFT_SCALE = 0.85;
/** The wall segment's height scale: the model is 1.1 m tall, the craft 0.3 m. */
const WALL_HEIGHT = 1.35;
/** How close (arena units of clear space) a passing wall counts as a near miss. */
const NEAR_MISS_GAP = 0.8;
const CRASH_PARTICLES = 90;
/** Palette (neon-night): signal, cool, danger. */
const SIGNAL = 0xff2e88;
const COOL = 0x2ef2ff;
const DANGER = 0xffb020;
const FOG = 0x1a1030;

/**
 * What the play probe reports about a drawn entity: its world box (centre and size), and
 * what draws it - read from the scene graph, not assumed. `render` is "asset" only when the
 * entity's meshes descend from a loaded GLB's root (the build stamps `wgf_asset` on it);
 * anything else - a box someone swapped in - is "primitive" with no asset.
 */
export interface DrawnEntity {
  readonly centre: [number, number, number];
  readonly size: [number, number, number];
  readonly asset: string | null;
  readonly render: "asset" | "primitive";
}

export interface ArenaViewEvents {
  /** A wall passed the craft with less than NEAR_MISS_GAP to spare. */
  nearMiss?(): void;
}

function glowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function skyTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  if (g) {
    const gradient = g.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#05050c");
    gradient.addColorStop(0.42, "#16162a");
    gradient.addColorStop(0.6, "#3a1450");
    gradient.addColorStop(0.66, "#1a1030");
    gradient.addColorStop(1, "#0b0b12");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 2, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Every descendant named `name` or `<name>-mirror` (the model spec's mirrored parts). */
function partsNamed(root: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((o) => {
    if (o.name === name || o.name === `${name}-mirror`) found.push(o);
  });
  return found;
}

/**
 * A loaded model merged into one mesh per material - a wall segment or a track module is
 * drawn in a handful of draw calls instead of one per part, which is what keeps a dozen walls
 * and a tiled track cheap on a low-end phone. The GLB root's `userData` (its `wgf_asset`
 * stamp) is kept on the result; the collision proxy is left out; `anchors` are the positions
 * of the named parts, in the model's space, for effects to attach to.
 */
interface Baked {
  readonly model: Group;
  readonly anchors: ReadonlyMap<string, readonly Vector3[]>;
}

function bake(source: Object3D, anchorNames: readonly string[]): Baked {
  source.updateMatrixWorld(true);
  const lambert = new Map<Material, Material>();
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const anchors = new Map<string, Vector3[]>();
  let stamp: Record<string, unknown> = {};
  source.traverse((o) => {
    if (typeof o.userData["wgf_asset"] === "string") stamp = { ...o.userData };
    const base = o.name.replace(/-mirror$/, "");
    if (anchorNames.includes(base)) {
      anchors.set(base, [
        ...(anchors.get(base) ?? []),
        new Vector3().setFromMatrixPosition(o.matrixWorld),
      ]);
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh || o.userData["wgf_role"] === "collision") return;
    const material = diffuse(mesh.material as MeshStandardMaterial, lambert);
    const geometry = mesh.geometry.clone().applyMatrix4(new Matrix4().copy(mesh.matrixWorld));
    byMaterial.set(material, [...(byMaterial.get(material) ?? []), geometry]);
  });
  const model = new Group();
  model.userData = stamp;
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false);
    if (merged) model.add(new Mesh(merged, material));
  }
  return { model, anchors };
}

/**
 * The model's PBR material as a Lambert one: the same base colour, texture, emissive and
 * opacity, without the per-pixel specular work - the track and the walls fill most of the
 * screen, and that cost decides the frame rate on a low-end phone. The craft keeps its PBR.
 */
function diffuse(material: MeshStandardMaterial, cache: Map<Material, Material>): Material {
  let cheap = cache.get(material);
  if (!cheap) {
    cheap = new MeshLambertMaterial({
      name: material.name,
      color: material.color,
      map: material.map,
      emissive: material.emissive,
      emissiveIntensity: material.emissiveIntensity,
      transparent: material.transparent,
      opacity: material.opacity,
    });
    cache.set(material, cheap);
  }
  return cheap;
}

/** Hide the spec's collision proxy: it is for physics, never drawn. */
function hideProxies(root: Object3D): void {
  root.traverse((o) => {
    if (o.userData["wgf_role"] === "collision") o.visible = false;
  });
}

interface WallInstance {
  readonly root: Group;
  /** Smallest clear space seen while the wall was level with the craft. */
  minGap: number;
}

export class ArenaView {
  readonly #root = new Group();
  readonly #assets: ArenaAssets;
  readonly #events: ArenaViewEvents;
  readonly #craft: Group;
  readonly #craftModel: Object3D;
  readonly #track: Group[] = [];
  readonly #walls = new Map<number, WallInstance>();
  readonly #glow = glowTexture();
  readonly #wallGlow: SpriteMaterial;
  readonly #thrusterGlow: SpriteMaterial;
  readonly #burst: Points;
  readonly #burstVelocity = new Float32Array(CRASH_PARTICLES * 3);
  readonly #wallModel: Baked;
  #camera: PerspectiveCamera | null = null;
  #aspect = 16 / 9;
  #trackOffset = 0;
  #lastElapsed = 0;
  #lastX = 0;
  #bank = 0;
  #crashAt = -1;
  #sim: Simulation | null = null;
  #lastFrame = 0;

  constructor(assets: ArenaAssets, events: ArenaViewEvents = {}) {
    this.#assets = assets;
    this.#events = events;
    this.#wallGlow = new SpriteMaterial({
      map: this.#glow,
      color: DANGER,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.#thrusterGlow = new SpriteMaterial({
      map: this.#glow,
      color: COOL,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    // Lighting: a cool sky / dark ground hemisphere, a key light from behind the camera and
    // a signal-pink rim from down the track. No point lights: every light is paid for in
    // every lit pixel, and the craft's engine glow on the track is a cheap additive decal.
    this.#root.add(new HemisphereLight(0x8a7cff, 0x0b0b12, 1.1));
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(4, 9, 7);
    this.#root.add(key);
    const rim = new DirectionalLight(SIGNAL, 0.8);
    rim.position.set(-6, 4, -12);
    this.#root.add(rim);

    // The ground beyond the track, so the arena never floats in a void.
    const ground = new Mesh(
      new PlaneGeometry(400, 400),
      new MeshBasicMaterial({ color: 0x0b0b12 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, FLOOR_Y - 0.02, -100);
    this.#root.add(ground);

    const track = bake(assets.track.scene, ["pylon-light"]);
    const pylonGlow = new SpriteMaterial({
      map: this.#glow,
      color: 0xedebff,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.55,
    });
    for (let i = 0; i < TRACK_MODULES; i++) {
      const module = track.model.clone();
      for (const at of track.anchors.get("pylon-light") ?? []) {
        const halo = new Sprite(pylonGlow);
        halo.scale.setScalar(1.1);
        halo.position.copy(at);
        module.add(halo);
      }
      this.#track.push(module);
      this.#root.add(module);
    }
    this.#wallModel = bake(assets.wall.scene, ["lamp"]);

    const skyline = assets.skyline.scene.clone();
    hideProxies(skyline);
    // The skyline sits behind the fog's far plane; it is drawn as a backdrop, unfogged.
    skyline.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) (mesh.material as MeshStandardMaterial).fog = false;
    });
    skyline.scale.setScalar(1.05);
    skyline.position.set(0, FLOOR_Y, -95);
    this.#root.add(skyline);

    this.#craft = new Group();
    this.#craftModel = assets.craft.scene.clone();
    hideProxies(this.#craftModel);
    // The model faces +Z (glTF); the craft drives toward -Z, into the oncoming walls.
    this.#craftModel.rotation.y = Math.PI;
    this.#craftModel.scale.setScalar(CRAFT_SCALE);
    for (const nozzle of partsNamed(this.#craftModel, "thruster-glow")) {
      const halo = new Sprite(this.#thrusterGlow);
      halo.scale.setScalar(0.55);
      halo.position.set(0, 0, -0.08);
      nozzle.add(halo);
    }
    this.#craft.add(this.#craftModel);
    const wash = new Mesh(
      new PlaneGeometry(1.6, 2.4),
      new MeshBasicMaterial({
        map: this.#glow,
        color: COOL,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.5,
      }),
    );
    wash.rotation.x = -Math.PI / 2;
    wash.position.set(0, -0.1, 0.7);
    this.#craft.add(wash);
    this.#craft.position.set(0, FLOOR_Y, 0);
    this.#root.add(this.#craft);

    const burstGeometry = new BufferGeometry();
    burstGeometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(CRASH_PARTICLES * 3), 3),
    );
    this.#burst = new Points(
      burstGeometry,
      new PointsMaterial({
        color: DANGER,
        size: 0.22,
        map: assets.textures.spark ?? this.#glow,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.#burst.visible = false;
    this.#burst.frustumCulled = false;
    this.#root.add(this.#burst);
  }

  attach(scene: Scene, camera: PerspectiveCamera): void {
    scene.add(this.#root);
    scene.background = this.#assets.textures.sky ?? skyTexture();
    scene.fog = new Fog(FOG, 16, 62);
    this.#camera = camera;
    this.#placeCamera(0, 0);
  }

  detach(scene: Scene): void {
    scene.remove(this.#root);
  }

  /** Keep the arena's width in frame at any aspect: a portrait phone widens and backs off. */
  frame(aspect: number): void {
    this.#aspect = aspect > 0 ? aspect : 16 / 9;
    this.#placeCamera(this.#sim?.playerX ?? 0, 0);
  }

  /** The craft as drawn: for the play probe. */
  craft(): DrawnEntity {
    return this.#drawn(this.#craftModel, this.#assets.craft.id);
  }

  /** A wall as drawn, by obstacle id; null before its first frame. */
  wall(id: number): DrawnEntity | null {
    const wall = this.#walls.get(id);
    return wall ? this.#drawn(wall.root, this.#assets.wall.id) : null;
  }

  /** Mirror the simulation into the scene graph. Pass null to show the empty arena. */
  sync(sim: Simulation | null): void {
    const now = performance.now();
    const dt = this.#lastFrame ? Math.min(0.1, (now - this.#lastFrame) / 1000) : 0;
    this.#lastFrame = now;
    if (sim !== this.#sim) {
      // A new run (or the menu): forget the last run's walls and effects.
      this.#clearWalls();
      this.#crashAt = -1;
      this.#burst.visible = false;
      this.#lastElapsed = sim?.elapsedS ?? 0;
      this.#lastX = sim?.playerX ?? 0;
      this.#sim = sim;
    }

    // The track scrolls at the simulation's speed, so speed reads; the menu idles slowly.
    const travelled = sim ? sim.speed * Math.max(0, sim.elapsedS - this.#lastElapsed) : dt * 6;
    this.#lastElapsed = sim?.elapsedS ?? 0;
    this.#trackOffset = (this.#trackOffset + travelled) % TRACK_LENGTH;
    this.#track.forEach((module, i) => {
      module.position.set(0, FLOOR_Y, TRACK_LENGTH - i * TRACK_LENGTH + this.#trackOffset);
    });

    const x = sim?.playerX ?? 0;
    const crashed = sim?.state === "over";
    const steerRate = dt > 0 ? (x - this.#lastX) / dt : 0;
    this.#lastX = x;
    this.#bank += ((crashed ? 0 : -steerRate * 0.06) - this.#bank) * Math.min(1, dt * 10);
    const hover = Math.sin(now / 260) * 0.035;
    this.#craft.position.set(x, FLOOR_Y + 0.12 + hover, 0);
    this.#craftModel.rotation.z = this.#bank;
    this.#thrusterGlow.opacity = 0.75 + Math.sin(now / 45) * 0.2;

    if (sim) this.#syncWalls(sim);
    this.#syncCrash(sim, crashed, now, dt);
    this.#placeCamera(x, this.#crashAt >= 0 ? Math.max(0, 1 - (now - this.#crashAt) / 450) : 0);
  }

  #syncWalls(sim: Simulation): void {
    const seen = new Set<number>();
    for (const obstacle of sim.obstacles) {
      seen.add(obstacle.id);
      this.#syncWall(sim, obstacle);
    }
    // Walls the simulation dropped have passed the craft: a close one is a near miss.
    for (const [id, wall] of this.#walls) {
      if (seen.has(id)) continue;
      if (sim.state !== "over" && wall.minGap < NEAR_MISS_GAP) this.#events.nearMiss?.();
      this.#root.remove(wall.root);
      this.#walls.delete(id);
    }
  }

  #syncWall(sim: Simulation, obstacle: Obstacle): void {
    let wall = this.#walls.get(obstacle.id);
    if (!wall) {
      const root = this.#wallModel.model.clone();
      // The segment is modelled 1 m wide; the simulation gives each wall its own width. It
      // stands taller than the craft, so a barrier reads as one from far down the track.
      root.scale.set(obstacle.halfWidth * 2, WALL_HEIGHT, 1);
      for (const at of this.#wallModel.anchors.get("lamp") ?? []) {
        const halo = new Sprite(this.#wallGlow);
        halo.scale.set(0.6 / root.scale.x, 0.6 / WALL_HEIGHT, 1);
        halo.position.copy(at);
        root.add(halo);
      }
      wall = { root, minGap: Infinity };
      this.#walls.set(obstacle.id, wall);
      this.#root.add(root);
    }
    wall.root.position.set(obstacle.x, FLOOR_Y, -obstacle.z);
    if (obstacle.z < 1.2 && obstacle.z > -2) {
      const gap = Math.abs(obstacle.x - sim.playerX) - obstacle.halfWidth - sim.playerHalfWidth;
      wall.minGap = Math.min(wall.minGap, gap);
    }
  }

  #syncCrash(sim: Simulation | null, crashed: boolean, now: number, dt: number): void {
    if (crashed && this.#crashAt < 0 && sim) {
      this.#crashAt = now;
      const positions = this.#burst.geometry.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < CRASH_PARTICLES; i++) {
        positions.setXYZ(i, sim.playerX, FLOOR_Y + 0.3, -0.4);
        const a = (i / CRASH_PARTICLES) * Math.PI * 2 * 7.3;
        const up = ((i * 37) % 100) / 100;
        const speed = 2.5 + ((i * 53) % 100) / 30;
        this.#burstVelocity.set(
          [Math.cos(a) * speed, 1 + up * 4, Math.sin(a) * speed * 0.6 + 1.5],
          i * 3,
        );
      }
      positions.needsUpdate = true;
      this.#burst.visible = true;
    }
    if (this.#crashAt < 0) return;
    const age = (now - this.#crashAt) / 1000;
    const material = this.#burst.material as PointsMaterial;
    material.opacity = Math.max(0, 1 - age / 1.1);
    this.#burst.visible = age < 1.1;
    if (!this.#burst.visible || dt === 0) return;
    const positions = this.#burst.geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < CRASH_PARTICLES; i++) {
      const v = i * 3;
      const vy = (this.#burstVelocity[v + 1] ?? 0) - 9.8 * dt;
      this.#burstVelocity[v + 1] = vy;
      positions.setXYZ(
        i,
        positions.getX(i) + (this.#burstVelocity[v] ?? 0) * dt,
        Math.max(FLOOR_Y + 0.02, positions.getY(i) + vy * dt),
        positions.getZ(i) + (this.#burstVelocity[v + 2] ?? 0) * dt,
      );
    }
    positions.needsUpdate = true;
  }

  /**
   * A chase camera: follows the craft partway, backs off on narrow screens, shakes on a
   * crash. Landscape keeps the whole arena (half-width 4) in frame at the craft; a portrait
   * phone keeps a narrower window that follows the craft further. A long lens from further
   * back holds that width at the craft while drawing the walls down the track larger - they
   * have to be read while still far away.
   */
  #placeCamera(x: number, shake: number): void {
    const camera = this.#camera;
    if (!camera) return;
    const portrait = this.#aspect < 1;
    const want = portrait ? 3.4 : 5.0;
    const fov = portrait ? 56 : 38;
    const follow = portrait ? 0.55 : 0.4;
    const halfH = Math.tan(((fov / 2) * Math.PI) / 180);
    const distance = Math.max(6.4, want / (halfH * this.#aspect));
    const k = distance / 6.4;
    const jitter = shake * 0.18;
    camera.fov = fov;
    camera.position.set(
      x * follow + Math.sin(performance.now() / 23) * jitter,
      2.7 * k + Math.cos(performance.now() / 29) * jitter,
      distance,
    );
    camera.lookAt(x * follow * 0.6, 0.2 - 0.4 * (k - 1), -9);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  #drawn(object: Object3D, assetId: string): DrawnEntity {
    // Drawn meshes only: not the hidden collision proxy, not the glow sprites. Each must sit
    // under a GLB root for the entity to count as drawn from the asset.
    const box = new Box3();
    const part = new Box3();
    let meshes = 0;
    let fromAsset = 0;
    object.updateWorldMatrix(true, true);
    object.traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      for (let node: Object3D | null = mesh; node; node = node.parent) {
        if (typeof node.userData["wgf_asset"] === "string") {
          fromAsset += 1;
          break;
        }
      }
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        box.union(part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
      }
    });
    const centre = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const asset = meshes > 0 && fromAsset === meshes;
    return {
      centre: [centre.x, centre.y, centre.z],
      size: [size.x, size.y, size.z],
      asset: asset ? assetId : null,
      render: asset ? "asset" : "primitive",
    };
  }

  #clearWalls(): void {
    for (const wall of this.#walls.values()) this.#root.remove(wall.root);
    this.#walls.clear();
  }
}
