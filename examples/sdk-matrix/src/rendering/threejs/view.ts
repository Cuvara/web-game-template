import { ThreeRenderer } from "@wgf/three-framework";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";
import type { MatrixView } from "../../view.js";

export async function createView(container: HTMLElement): Promise<MatrixView> {
  const renderer = new ThreeRenderer();
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  });
  const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
  renderer.scene.add(cube);
  return {
    renderer,
    draw(elapsedMs, score) {
      cube.rotation.set(elapsedMs / 1300, elapsedMs / 1000, 0);
      cube.scale.setScalar(1 + Math.min(score, 200) / 100);
      renderer.render();
    },
  };
}
