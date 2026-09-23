import { PixiRenderer } from "@wgf/pixi-framework";
import { Graphics } from "pixi.js";
import type { MatrixView } from "../../view.js";

export async function createView(container: HTMLElement): Promise<MatrixView> {
  const renderer = new PixiRenderer();
  await renderer.init({
    container,
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  });
  const shape = new Graphics();
  renderer.stage.addChild(shape);
  return {
    renderer,
    draw(elapsedMs, score) {
      const { width, height } = renderer.app.renderer.screen;
      const size = 40 + Math.min(score, 200);
      shape
        .clear()
        .rect(-size / 2, -size / 2, size, size)
        .fill({ color: 0x27f5ff });
      shape.position.set(width / 2, height / 2);
      shape.rotation = elapsedMs / 1000;
      renderer.render();
    },
  };
}
