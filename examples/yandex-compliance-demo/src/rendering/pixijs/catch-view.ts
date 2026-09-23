// Draws a CatchGame with PixiJS.
//
// The only module in the demo that imports pixi.js, per the template's rule that engine
// code lives under rendering/<engine>/. Everything is vector — no textures, so nothing to
// download and nothing that could be an external asset.

// Pixi generates shader glue with `new Function` unless this module is loaded. Whether the
// portal's Content-Security-Policy allows 'unsafe-eval' is not documented, so the demo does
// not depend on it.
import "pixi.js/unsafe-eval";
import { Graphics, type Container } from "pixi.js";
import { BASKET_WIDTH, BASKET_Y, STAR_RADIUS, type CatchGame } from "../../game/catch-game.js";
import { playfieldRect, type Rect } from "../../layout.js";

const BACKDROP = 0x0b1026;
const FIELD = 0x141a3c;
const DUST = 0x5a64a8;
const STAR = 0xffd66b;
const BASKET = 0x6be3ff;

export class CatchView {
  readonly #backdrop = new Graphics();
  readonly #actors = new Graphics();
  readonly #dust: Array<{ x: number; y: number; r: number }>;
  #field: Rect = { x: 0, y: 0, width: 1, height: 1 };
  #width = 1;
  #height = 1;

  constructor(stage: Container, random: () => number = Math.random) {
    this.#dust = Array.from({ length: 70 }, () => ({
      x: random(),
      y: random(),
      r: 0.6 + random() * 1.4,
    }));
    stage.addChild(this.#backdrop, this.#actors);
  }

  get field(): Rect {
    return this.#field;
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#field = playfieldRect(width, height);
    this.#drawBackdrop();
  }

  draw(game: CatchGame | null): void {
    const g = this.#actors.clear();
    if (!game) return;
    const f = this.#field;
    const px = (x: number): number => f.x + x * f.width;
    const py = (y: number): number => f.y + y * f.height;
    const radius = Math.max(6, STAR_RADIUS * f.width);

    for (const star of game.stars) {
      g.star(px(star.x), py(star.y), 5, radius, radius * 0.45).fill(STAR);
    }

    const basketWidth = BASKET_WIDTH * f.width;
    const basketHeight = Math.max(10, f.height * 0.03);
    g.roundRect(
      px(game.basketX) - basketWidth / 2,
      py(BASKET_Y),
      basketWidth,
      basketHeight,
      6,
    ).fill(BASKET);
  }

  #drawBackdrop(): void {
    const g = this.#backdrop.clear();
    g.rect(0, 0, this.#width, this.#height).fill(BACKDROP);
    const f = this.#field;
    g.rect(f.x, f.y, f.width, f.height).fill(FIELD);
    for (const dot of this.#dust) {
      g.circle(dot.x * this.#width, dot.y * this.#height, dot.r).fill(DUST);
    }
  }
}
