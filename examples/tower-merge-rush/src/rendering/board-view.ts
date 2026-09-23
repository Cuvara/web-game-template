// The PixiJS view for Tower Merge Rush.
//
// Draw-only. It reads a Snapshot from the pure rules module and paints it; it never mutates
// game state and knows nothing about the platform. main.ts drives it: the game loop calls
// draw(), then the renderer presents. Pixi's own ticker is stopped (see @wgf/pixi-framework),
// so nothing here animates on its own — a redraw only happens when the loop or a resize asks.

import { Container, Graphics, Text, type TextStyleOptions } from "pixi.js";
import { COLUMNS, type Snapshot } from "../game/rules.js";

/** Distinct hues per tower level; higher levels wrap through the palette, lightened. */
const LEVEL_COLORS = [0x4f8cff, 0x39c37e, 0xffb454, 0xff6b6b, 0xb794f6, 0x4dd0e1];

function levelColor(level: number): number {
  return LEVEL_COLORS[(level - 1) % LEVEL_COLORS.length]!;
}

const LABEL_STYLE: TextStyleOptions = {
  fill: 0x0b1026,
  fontFamily: "system-ui, sans-serif",
  fontWeight: "800",
  fontSize: 40,
};

export class BoardView {
  readonly #root = new Container();
  readonly #cells = new Graphics();
  readonly #labels: Text[] = [];
  #width = 0;
  #height = 0;

  constructor(stage: Container) {
    this.#root.addChild(this.#cells);
    for (let i = 0; i < COLUMNS; i++) {
      const label = new Text({ text: "", style: LABEL_STYLE });
      label.anchor.set(0.5);
      label.visible = false;
      this.#labels.push(label);
      this.#root.addChild(label);
    }
    stage.addChild(this.#root);
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
  }

  /** Geometry of the track, centred in the viewport. Pure of Pixi so tests could reuse it. */
  #layout(): { x: number; y: number; cell: number; gap: number } {
    const gap = 8;
    const usableWidth = this.#width * 0.92;
    const cell = Math.min((usableWidth - gap * (COLUMNS - 1)) / COLUMNS, this.#height * 0.4);
    const trackWidth = cell * COLUMNS + gap * (COLUMNS - 1);
    const x = (this.#width - trackWidth) / 2;
    const y = (this.#height - cell) / 2;
    return { x, y, cell, gap };
  }

  draw(snapshot: Snapshot): void {
    const { x, y, cell, gap } = this.#layout();
    this.#cells.clear();

    for (let i = 0; i < COLUMNS; i++) {
      const cx = x + i * (cell + gap);
      const value = snapshot.board[i] ?? null;
      const label = this.#labels[i]!;

      // The empty slot outline, so the track reads as a fixed number of columns even when bare.
      this.#cells.roundRect(cx, y, cell, cell, 10).fill({ color: 0x1b2140, alpha: 0.9 });
      this.#cells.roundRect(cx, y, cell, cell, 10).stroke({ color: 0x2c3566, width: 2 });

      if (value === null) {
        label.visible = false;
        continue;
      }
      this.#cells.roundRect(cx + 3, y + 3, cell - 6, cell - 6, 8).fill(levelColor(value));
      label.visible = true;
      label.text = String(value);
      label.style.fontSize = Math.max(14, Math.floor(cell * 0.42));
      label.position.set(cx + cell / 2, y + cell / 2);
    }
  }

  destroy(): void {
    this.#root.destroy({ children: true });
  }
}
