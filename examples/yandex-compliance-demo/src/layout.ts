// Where the playfield sits inside the canvas.
//
// The canvas always fills the space the portal gives the game (1.6.2.1). The playfield
// inside it is capped at PLAYFIELD_MAX_ASPECT wide so a desktop window does not stretch
// the game sideways, and the background the game draws around it is part of the scene, not
// a black bar (5.9). On a phone in portrait the playfield is simply the whole screen.

export const PLAYFIELD_MAX_ASPECT = 1.1;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function playfieldRect(width: number, height: number): Rect {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const fieldWidth = Math.min(w, h * PLAYFIELD_MAX_ASPECT);
  return { x: (w - fieldWidth) / 2, y: 0, width: fieldWidth, height: h };
}

/** A client x coordinate as a normalised playfield x, clamped to the field. */
export function toPlayfieldX(clientX: number, field: Rect): number {
  return Math.min(Math.max((clientX - field.x) / field.width, 0), 1);
}
