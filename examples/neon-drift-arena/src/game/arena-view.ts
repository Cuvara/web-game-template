// The Three.js half of Neon Drift Arena.
//
// This is the ONLY file that touches three. It reads the pure Simulation and mirrors it into
// meshes; it never writes simulation state. Meshes are pooled per obstacle id so the scene
// graph tracks the simulation's obstacle list without allocating every frame.

import {
  BoxGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Scene,
} from "three";
import type { Obstacle, Simulation } from "./simulation.js";

const PLAYER_COLOR = 0x33ffd6;
const PLAYER_CRASH_COLOR = 0xff4d6d;
const OBSTACLE_COLOR = 0xff5cf0;
const GRID_COLOR = 0x1b3a6b;

/**
 * Owns the neon meshes and keeps them in step with a Simulation. `attach` adds the arena to a
 * scene; `sync` is called each render with the current run (or null for the menu).
 */
export class ArenaView {
  readonly #root = new Group();
  readonly #player: Mesh;
  readonly #obstacleGeometry = new BoxGeometry(1, 1, 1);
  /** Live obstacle meshes keyed by the simulation's stable obstacle id. */
  readonly #obstacleMeshes = new Map<number, Mesh>();

  constructor() {
    const grid = new GridHelper(80, 40, GRID_COLOR, GRID_COLOR);
    // Push the floor grid ahead of the camera so the arena reads as a road stretching away.
    grid.position.set(0, -0.5, -20);
    this.#root.add(grid);

    this.#player = new Mesh(
      new BoxGeometry(0.9, 0.6, 1.4),
      new MeshBasicMaterial({ color: PLAYER_COLOR }),
    );
    this.#player.position.set(0, 0, 0);
    this.#root.add(this.#player);
  }

  attach(scene: Scene): void {
    scene.add(this.#root);
  }

  detach(scene: Scene): void {
    scene.remove(this.#root);
  }

  /** Mirror the simulation into the scene graph. Pass null to show the empty arena. */
  sync(sim: Simulation | null): void {
    if (!sim) {
      this.#clearObstacles();
      this.#player.position.x = 0;
      this.#setPlayerColor(PLAYER_COLOR);
      return;
    }

    this.#player.position.x = sim.playerX;
    this.#setPlayerColor(sim.state === "over" ? PLAYER_CRASH_COLOR : PLAYER_COLOR);

    const seen = new Set<number>();
    for (const obstacle of sim.obstacles) {
      seen.add(obstacle.id);
      this.#syncObstacle(obstacle);
    }
    // Remove meshes whose obstacle the simulation dropped (passed or off the back).
    for (const [id, mesh] of this.#obstacleMeshes) {
      if (!seen.has(id)) {
        this.#root.remove(mesh);
        this.#obstacleMeshes.delete(id);
      }
    }
  }

  #syncObstacle(obstacle: Obstacle): void {
    let mesh = this.#obstacleMeshes.get(obstacle.id);
    if (!mesh) {
      mesh = new Mesh(
        this.#obstacleGeometry,
        new MeshBasicMaterial({ color: OBSTACLE_COLOR }),
      );
      const width = obstacle.halfWidth * 2;
      mesh.scale.set(width, 1, 1);
      this.#obstacleMeshes.set(obstacle.id, mesh);
      this.#root.add(mesh);
    }
    mesh.position.set(obstacle.x, 0, -obstacle.z);
  }

  #clearObstacles(): void {
    for (const mesh of this.#obstacleMeshes.values()) this.#root.remove(mesh);
    this.#obstacleMeshes.clear();
  }

  #setPlayerColor(color: number): void {
    (this.#player.material as MeshBasicMaterial).color.setHex(color);
  }
}
