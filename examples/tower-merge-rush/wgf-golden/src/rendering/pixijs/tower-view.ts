// The production PixiJS view of Tower Merge Rush: the design's art, drawn from the runtime
// asset manifest, with merge feedback.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. Draw-only, like the example's board-view.ts it replaces in the port: it reads
// a Snapshot and paints it, and never changes game state. The game loop calls draw() every
// frame, so the feedback - a drop that lands, a merge that pops and bursts, a streak along a
// cascade, the points it scored - animates on wall-clock time between snapshots.
//
// Every tower is a sprite of the design's `pieces` (role target) drawing for its level, with
// its numeral on a badge; the track is the `track-frame` 9-slice over the `backdrop`; the
// burst and streak are `merge-vfx`. A build without those assets (a greybox) draws the same
// layout in primitives, and describe() says so, so the play probe never claims art it lacks.

import {
  Container,
  Graphics,
  NineSliceSprite,
  Sprite,
  Text,
  type TextStyleOptions,
  type Texture,
} from "pixi.js";
import { FONT_DISPLAY } from "../../assets/runtime-assets.js";
import { COLUMNS, type Cell, type Snapshot } from "../../game/rules.js";
import type { BoardArt } from "./art.js";

const PAPER = 0xf4ede1;
const PAPER_SHADE = 0xe4d9c6;
const INK = 0x1c1a17;
const PINK = 0xff48b0;
const BLUE = 0x0078bf;
/** Primitive stand-ins: one hue per level (greybox only). */
const LEVEL_COLORS = [
  0xff48b0, 0x0078bf, 0x6c3c9e, 0xe3350d, 0xffd23f, 0x2e92d2, 0xff7ac6, 0x1c1a17,
];

export interface TrackLayout {
  readonly x: number;
  readonly y: number;
  /** A slot's width. */
  readonly cell: number;
  /** A slot's height: taller than wide on a portrait screen, which has the room. */
  readonly slot: number;
  readonly gap: number;
  /** How tall a tower's drawing stands: the art is narrow and tall, so it rises over its slot. */
  readonly sprite: number;
}

/** The track's geometry, centred in the viewport: seven slots in one row. */
export function trackLayout(width: number, height: number): TrackLayout {
  const gap = Math.max(4, Math.min(8, Math.round(width * 0.01)));
  const usableWidth = width * 0.92;
  const cell = Math.min((usableWidth - gap * (COLUMNS - 1)) / COLUMNS, height * 0.32);
  const track = cell * COLUMNS + gap * (COLUMNS - 1);
  const portrait = height > width * 1.15;
  const slot = portrait ? cell * 1.45 : cell;
  // A little below the centre: the towers rise above their slots.
  const y = (height - slot) / 2 + slot * 0.3;
  return { x: (width - track) / 2, y, cell, slot, gap, sprite: cell * (portrait ? 2 : 1.7) };
}

export interface EntityView {
  readonly asset: string | null;
  readonly render: "asset" | "primitive";
  /** Screen bounds relative to the canvas. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Tower {
  readonly root: Container;
  readonly sprite: Sprite;
  readonly shape: Graphics;
  readonly badge: Graphics;
  readonly numeral: Text;
  /** Stars over a tower whose level is past the last drawing: one per level beyond. */
  readonly crowns: Container;
  level: Cell;
  /** What the tower was last painted as (level and size): repainting waits for a change. */
  painted: string;
  /** "drop" lands from above, "pop" is a merge result; with its start time. */
  anim: { kind: "drop" | "pop"; t0: number } | null;
}

interface Effect {
  readonly node: Container;
  readonly t0: number;
  readonly ms: number;
  /** p runs 0..1 over the effect's life. */
  readonly step: (p: number) => void;
}

const NUMERAL_STYLE: TextStyleOptions = {
  fontFamily: [FONT_DISPLAY, "sans-serif"],
  fontSize: 16,
  fill: INK,
};

const POPUP_STYLE: TextStyleOptions = {
  fontFamily: [FONT_DISPLAY, "sans-serif"],
  fontSize: 28,
  fill: PINK,
  stroke: { color: INK, width: 6, join: "round" },
};

function easeOutBack(p: number): number {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
}

function easeOutBounce(p: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

export class TowerView {
  readonly #art: BoardArt;
  readonly #root = new Container();
  readonly #ground = new Graphics();
  readonly #backdrop: Sprite | null;
  readonly #frame: NineSliceSprite | null;
  readonly #framePrimitive = new Graphics();
  readonly #slots = new Graphics();
  readonly #slotLabels: Text[] = [];
  readonly #towers: Tower[] = [];
  /** Bursts play behind the towers, confetti, streaks and points in front. */
  readonly #fxBack = new Container();
  readonly #fx = new Container();
  readonly #effects: Effect[] = [];
  #width = 0;
  #height = 0;
  #layout: TrackLayout = { x: 0, y: 0, cell: 0, slot: 0, gap: 0, sprite: 0 };
  #previous: Snapshot | null = null;
  #shake = { t0: 0, power: 0 };
  /** When the last burst was spawned: changes faster than a frame share one (a test's loop). */
  #lastFx = -Infinity;

  constructor(stage: Container, art: BoardArt) {
    this.#art = art;
    this.#root.addChild(this.#ground);
    this.#backdrop = art.backdrop ? new Sprite(art.backdrop.texture) : null;
    if (this.#backdrop) {
      this.#backdrop.anchor.set(0.5, 1);
      this.#root.addChild(this.#backdrop);
    }
    this.#frame = art.frame
      ? new NineSliceSprite({
          texture: art.frame.texture,
          leftWidth: art.frameSlice,
          topHeight: art.frameSlice,
          rightWidth: art.frameSlice,
          bottomHeight: art.frameSlice,
        })
      : null;
    this.#root.addChild(this.#frame ?? this.#framePrimitive);
    this.#root.addChild(this.#slots);
    for (let i = 0; i < COLUMNS; i++) {
      const label = new Text({ text: String(i + 1), style: { ...NUMERAL_STYLE, fill: INK } });
      label.anchor.set(0.5);
      label.alpha = 0.28;
      this.#slotLabels.push(label);
      this.#root.addChild(label);
    }
    const towers = new Container();
    this.#root.addChild(this.#fxBack, towers);
    for (let i = 0; i < COLUMNS; i++) {
      const root = new Container();
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      const shape = new Graphics();
      const badge = new Graphics();
      const numeral = new Text({ text: "", style: NUMERAL_STYLE });
      numeral.anchor.set(0.5, 0.52);
      const crowns = new Container();
      root.addChild(sprite, shape, crowns, badge, numeral);
      root.visible = false;
      towers.addChild(root);
      this.#towers.push({
        root,
        sprite,
        shape,
        badge,
        numeral,
        crowns,
        level: null,
        anim: null,
        painted: "",
      });
    }
    this.#root.addChild(this.#fx);
    stage.addChild(this.#root);
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#layout = trackLayout(width, height);
    this.#drawStatic();
  }

  /** What draws the tower in a column, and where - for the play probe. */
  describe(col: number, level: number): EntityView | null {
    if (col < 0 || col >= COLUMNS) return null;
    const { x, y, cell, slot, gap, sprite } = this.#layout;
    const piece = this.#pieceFor(level);
    return {
      asset: piece?.id ?? null,
      render: piece ? "asset" : "primitive",
      x: x + col * (cell + gap),
      y: y + slot - sprite,
      w: cell,
      h: sprite,
    };
  }

  draw(snapshot: Snapshot): void {
    const now = performance.now();
    this.#diff(snapshot, now);
    this.#previous = snapshot;

    // The slots pulse while the track is bare: "drop a piece here".
    const bare = snapshot.state === "playing" && snapshot.board.every((c) => c === null);
    this.#slots.alpha = bare ? 0.75 + 0.25 * Math.sin(now / 220) : 1;

    const { x, y, cell, slot, gap } = this.#layout;
    for (let col = 0; col < COLUMNS; col++) {
      const tower = this.#towers[col]!;
      const level = snapshot.board[col] ?? null;
      this.#slotLabels[col]!.visible = level === null;
      tower.level = level;
      if (level === null) {
        tower.root.visible = false;
        tower.anim = null;
        continue;
      }
      tower.root.visible = true;
      this.#paintTower(tower, level);
      let dy = 0;
      let sx = 1;
      let sy = 1;
      if (tower.anim) {
        const age = now - tower.anim.t0;
        if (tower.anim.kind === "drop") {
          const p = Math.min(1, age / 340);
          dy = -(1 - easeOutBounce(p)) * cell * 1.6;
          const squash = p > 0.55 ? Math.sin(((p - 0.55) / 0.45) * Math.PI) * 0.1 : 0;
          sx = 1 + squash;
          sy = 1 - squash;
          if (p >= 1) tower.anim = null;
        } else {
          const p = Math.min(1, age / 380);
          const s =
            p < 0.35 ? 1 + 0.38 * (p / 0.35) : 1 + 0.38 * (1 - easeOutBack((p - 0.35) / 0.65));
          sx = s;
          sy = s;
          if (p >= 1) tower.anim = null;
        }
      }
      tower.root.position.set(x + col * (cell + gap) + cell / 2, y + slot - cell * 0.06 + dy);
      tower.root.scale.set(sx, sy);
    }

    // Effects, oldest first; finished ones are removed.
    for (let i = this.#effects.length - 1; i >= 0; i--) {
      const effect = this.#effects[i]!;
      const p = (now - effect.t0) / effect.ms;
      if (p >= 1) {
        effect.node.destroy({ children: true });
        this.#effects.splice(i, 1);
      } else {
        effect.step(Math.max(0, p));
      }
    }

    const shakeAge = (now - this.#shake.t0) / 260;
    const shake = shakeAge < 1 ? this.#shake.power * (1 - shakeAge) : 0;
    this.#root.position.set(
      shake ? Math.sin(now / 17) * shake : 0,
      shake ? Math.cos(now / 23) * shake : 0,
    );
  }

  destroy(): void {
    this.#root.destroy({ children: true });
  }

  // --- drawing ------------------------------------------------------------------------------

  #pieceFor(level: number): { id: string; texture: Texture } | null {
    const pieces = this.#art.pieces;
    if (pieces.length === 0) return null;
    return pieces[Math.min(level, pieces.length) - 1]!;
  }

  #paintTower(tower: Tower, level: number): void {
    const { cell, sprite: height } = this.#layout;
    const key = `${level}:${cell}:${height}`;
    if (tower.painted === key) return;
    tower.painted = key;
    const piece = this.#pieceFor(level);
    tower.sprite.visible = piece !== null;
    tower.shape.visible = piece === null;
    if (piece) {
      if (tower.sprite.texture !== piece.texture) tower.sprite.texture = piece.texture;
      tower.sprite.height = height;
      tower.sprite.width = height * (piece.texture.width / piece.texture.height);
    } else {
      const color = LEVEL_COLORS[(level - 1) % LEVEL_COLORS.length]!;
      const h = cell * (0.45 + 0.07 * Math.min(level, 8));
      tower.shape
        .clear()
        .roundRect(-cell * 0.4, -h, cell * 0.8, h, 6)
        .fill(color)
        .stroke({ color: INK, width: 3 });
    }
    // The numeral badge: bottom right of the slot, on paper.
    const r = Math.max(11, cell * 0.19);
    const bx = cell * 0.34;
    const by = -r * 0.85;
    tower.badge
      .clear()
      .circle(bx + 2, by + 2, r)
      .fill(INK)
      .circle(bx, by, r)
      .fill(PAPER)
      .stroke({ color: INK, width: Math.max(2, r * 0.18) });
    tower.numeral.text = String(level);
    tower.numeral.style.fontSize = Math.round(r * 1.15);
    this.#crown(tower, level);
    tower.numeral.position.set(bx, by);
  }

  /**
   * A level past the design's last drawing reuses that drawing, crowned with one burst star
   * per level beyond it, so two such towers are never mistaken for equals.
   */
  #crown(tower: Tower, level: number): void {
    tower.crowns.removeChildren().forEach((child) => child.destroy());
    const beyond = level - this.#art.pieces.length;
    const star = this.#art.vfx[0];
    if (this.#art.pieces.length === 0 || beyond <= 0 || !star) return;
    const { cell, sprite } = this.#layout;
    const size = cell * 0.34;
    for (let i = 0; i < beyond; i++) {
      const s = new Sprite(star.texture);
      s.anchor.set(0.5);
      s.width = s.height = size;
      s.position.set((i - (beyond - 1) / 2) * size * 0.8, -sprite * 0.93);
      tower.crowns.addChild(s);
    }
  }

  /** Backdrop, frame and slots: redrawn only on resize. */
  #drawStatic(): void {
    const w = this.#width;
    const h = this.#height;
    this.#ground.clear().rect(0, 0, w, h).fill(PAPER);
    if (this.#backdrop) {
      const tex = this.#backdrop.texture;
      const scale = Math.max(w / tex.width, h / tex.height);
      this.#backdrop.scale.set(scale);
      this.#backdrop.position.set(w / 2, h);
    }
    const { x, y, cell, slot, gap } = this.#layout;
    const track = cell * COLUMNS + gap * (COLUMNS - 1);
    const pad = Math.max(8, cell * 0.16);
    const fw = track + pad * 2;
    const fh = slot + pad * 2;
    if (this.#frame) {
      // Shrink the borders on a small track so the four corners never overlap.
      const k = Math.min(1, (fh * 0.9) / (this.#art.frameSlice * 2), cell / 60);
      this.#frame.scale.set(k);
      this.#frame.width = fw / k;
      this.#frame.height = fh / k;
      this.#frame.position.set(x - pad, y - pad);
    } else {
      this.#framePrimitive
        .clear()
        .roundRect(x - pad, y - pad, fw, fh, 8)
        .fill(PAPER_SHADE)
        .stroke({ color: INK, width: 4 });
    }
    this.#slots.clear();
    for (let col = 0; col < COLUMNS; col++) {
      const cx = x + col * (cell + gap);
      this.#slots
        .roundRect(cx + 2, y + 2, cell - 4, slot - 4, Math.max(4, cell * 0.1))
        .fill({ color: PAPER, alpha: 0.85 })
        .stroke({ color: INK, width: 2, alpha: 0.45 });
      const label = this.#slotLabels[col]!;
      label.style.fontSize = Math.max(12, Math.round(cell * 0.32));
      label.position.set(cx + cell / 2, y + slot / 2);
    }
  }

  // --- feedback -----------------------------------------------------------------------------

  #diff(next: Snapshot, now: number): void {
    const prev = this.#previous;
    if (!prev || prev.board === next.board) return;
    if (next.score < prev.score || next.board.every((c) => c === null)) {
      // A new run or a continue: the track clears without fanfare.
      for (const tower of this.#towers) tower.anim = null;
      return;
    }
    const merges = next.merges - prev.merges;
    const gained = next.score - prev.score;
    let best = -1;
    for (let col = 0; col < COLUMNS; col++) {
      const before = prev.board[col] ?? null;
      const after = next.board[col] ?? null;
      const tower = this.#towers[col]!;
      if (after !== null && before === null && merges === 0) {
        tower.anim = { kind: "drop", t0: now };
      } else if (after !== null && after !== before) {
        tower.anim = { kind: "pop", t0: now };
        if (merges > 0 && (best < 0 || after > (next.board[best] ?? 0))) best = col;
      } else if (after === null && before !== null && now - this.#lastFx > 50) {
        this.#streak(col, now);
      }
    }
    if (merges > 0 && best >= 0 && now - this.#lastFx > 50) {
      this.#lastFx = now;
      this.#burst(best, now, merges);
      this.#popup(best, now, `+${gained}`, merges);
      this.#shake = { t0: now, power: Math.min(10, 2 + merges * 2.5) };
    }
  }

  /** The middle of a column's tower, where its feedback plays. */
  #centre(col: number): { cx: number; cy: number; cell: number } {
    const { x, y, cell, slot, gap, sprite } = this.#layout;
    return { cx: x + col * (cell + gap) + cell / 2, cy: y + slot - sprite * 0.45, cell };
  }

  #add(node: Container, now: number, ms: number, step: (p: number) => void, back = false): void {
    (back ? this.#fxBack : this.#fx).addChild(node);
    this.#effects.push({ node, t0: now, ms, step });
    step(0);
  }

  #burst(col: number, now: number, merges: number): void {
    const { cx, cy, cell } = this.#centre(col);
    const burst = this.#art.vfx[0];
    if (burst) {
      const ring = new Sprite(burst.texture);
      ring.anchor.set(0.5);
      ring.position.set(cx, cy);
      const size = cell * (1.35 + 0.2 * Math.min(merges, 3));
      this.#add(
        ring,
        now,
        420,
        (p) => {
          ring.width = ring.height = size * (0.35 + 0.65 * easeOutBack(Math.min(1, p * 1.6)));
          ring.rotation = p * 0.9;
          ring.alpha = p < 0.45 ? 0.95 : 0.95 * (1 - (p - 0.45) / 0.55);
        },
        true,
      );
    } else {
      const ring = new Graphics();
      ring.position.set(cx, cy);
      this.#add(ring, now, 380, (p) => {
        ring
          .clear()
          .circle(0, 0, cell * (0.3 + p))
          .stroke({ color: PINK, width: 6 * (1 - p) + 1 });
      });
    }
    // Confetti: small copies of the burst flung out and falling.
    const count = 6 + Math.min(merges, 3) * 3;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (i % 2) * 0.3;
      const speed = cell * (1.4 + (i % 3) * 0.45);
      const bit: Container = burst
        ? new Sprite(burst.texture)
        : new Graphics().rect(-3, -3, 6, 6).fill(BLUE);
      if (bit instanceof Sprite) {
        bit.anchor.set(0.5);
        bit.width = bit.height = cell * (0.09 + (i % 3) * 0.035);
        bit.tint = i % 3 === 0 ? BLUE : i % 3 === 1 ? 0xffffff : 0x6c3c9e;
      }
      bit.position.set(cx, cy);
      this.#add(bit, now, 620, (p) => {
        bit.position.set(
          cx + Math.cos(angle) * speed * p,
          cy + Math.sin(angle) * speed * p * 0.8 + cell * 1.4 * p * p,
        );
        bit.rotation = p * 6 * (i % 2 ? 1 : -1);
        bit.alpha = 1 - p * p;
      });
    }
  }

  #streak(col: number, now: number): void {
    const streak = this.#art.vfx[1] ?? this.#art.vfx[0];
    const from = this.#centre(col);
    const to = this.#centre(Math.max(0, col - 1));
    if (!streak) return;
    // The streak's head (the right end of its drawing) leads leftwards, where the piece went.
    const node = new Sprite(streak.texture);
    node.anchor.set(0, 0.5);
    node.rotation = Math.PI;
    node.position.set(from.cx + from.cell * 0.5, from.cy + from.cell * 0.35);
    const length = Math.max(from.cell * 1.4, from.cx - to.cx + from.cell);
    this.#add(node, now, 360, (p) => {
      node.width = length * (0.4 + 0.6 * p);
      node.height = from.cell * 0.22;
      node.alpha = 1 - p;
    });
  }

  #popup(col: number, now: number, text: string, merges: number): void {
    const { cx, cy, cell } = this.#centre(col);
    const label = new Text({
      text: merges > 1 ? `${text}  x${merges}` : text,
      style: { ...POPUP_STYLE, fontSize: Math.max(18, Math.round(cell * 0.32)) },
    });
    label.anchor.set(0.5);
    // Kept on screen when the merge is at the track's edge.
    const half = label.width / 2 + 6;
    const x = Math.min(Math.max(cx, half), this.#width - half);
    this.#add(label, now, 900, (p) => {
      label.position.set(x, cy - cell * 0.9 - cell * 0.7 * easeOutBack(Math.min(1, p * 2)));
      label.scale.set(p < 0.15 ? 0.6 + (p / 0.15) * 0.5 : 1.1 - Math.min(0.1, (p - 0.15) * 0.3));
      label.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    });
  }
}
