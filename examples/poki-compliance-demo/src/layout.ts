// Fitting the world to the screen.
//
// Poki: "16:9 aspect ratio. Your game must scale to cover the full canvas", and on mobile
// "cover the full screen in portrait or landscape". So the world is not letterboxed. Its
// height is fixed at 720 units and its width follows the screen's aspect ratio, which gives
// exactly 1280 x 720 at 16:9 — Poki's 640x360, 836x470 and 1031x580 all land there — and a
// narrower or wider world on screens that are not 16:9, drawn edge to edge.

export const WORLD_HEIGHT = 720;
const MIN_ASPECT = 9 / 21;
const MAX_ASPECT = 21 / 9;

export interface WorldLayout {
  /** World units across. */
  readonly width: number;
  readonly height: number;
  /** CSS pixels per world unit. */
  readonly scale: number;
  /** CSS pixels from the left edge to the world, non-zero only beyond 21:9. */
  readonly offsetX: number;
}

export function layoutFor(cssWidth: number, cssHeight: number): WorldLayout {
  const safeWidth = Math.max(1, cssWidth);
  const safeHeight = Math.max(1, cssHeight);
  const aspect = Math.min(Math.max(safeWidth / safeHeight, MIN_ASPECT), MAX_ASPECT);
  const scale = safeHeight / WORLD_HEIGHT;
  const width = Math.round(WORLD_HEIGHT * aspect);
  return {
    width,
    height: WORLD_HEIGHT,
    scale,
    offsetX: Math.max(0, (safeWidth - width * scale) / 2),
  };
}
