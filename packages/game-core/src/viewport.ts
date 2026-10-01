// Fitting a fixed design size to whatever screen the portal gives the game.
//
// A game is authored against one size — "the world is 720 units tall" — and then has to run
// from a 360x640 phone to a desktop window, which every game so far has solved by writing
// the same arithmetic again: guard the zero-sized container, divide to get a scale, centre
// what is left over, and convert a pointer coordinate back into world units.
//
// What this is not: a layout engine. It computes one rectangle and the scale that maps into
// it. Where the HUD goes and what fills the margins stay the game's own.
//
// Letterboxing is the fallback, not the default. Poki asks a game to "scale to cover the
// full canvas", and Yandex 5.9 counts black bars against a submission while 1.6.2.1 requires
// the canvas to fill the frame — so `extend` keeps the authored scale and hands the game a
// slightly wider or taller world to draw into, and `contain` is there for a game whose
// playfield genuinely cannot change shape.

/** CSS pixels of chrome along each edge — a notch, a rounded corner, a portal's own bar. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How the design size meets a viewport that is a different shape.
 *
 * - `extend` — keep the scale that fits the design size, and let the world grow on the axis
 *   with room to spare. Nothing is cropped, nothing is bordered, and the game draws into
 *   `width`/`height`, which are not the design size on most screens.
 * - `contain` — keep the design aspect ratio exactly and centre it, leaving margins. The
 *   game is responsible for what goes in them; a portal that rejects black bars still
 *   rejects them when this produced the geometry.
 */
export type FitMode = "extend" | "contain";

export interface ViewportOptions {
  /** The size the game is authored against, in world units. */
  readonly design: { readonly width: number; readonly height: number };
  /** Default `extend`. */
  readonly fit?: FitMode;
  /**
   * Bounds on how far `extend` may stretch the world, as width / height. Past them the
   * world stops growing and the remainder becomes a margin, so a 32:9 monitor does not hand
   * the game a world twice as wide as anything it was designed to fill. Ignored by
   * `contain`, whose aspect is the design's. Default 1/4 and 4.
   */
  readonly minAspect?: number;
  readonly maxAspect?: number;
}

/** The size of the surface the game draws into, in CSS pixels. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio?: number;
}

export interface ViewportLayout {
  /** CSS pixels per world unit. Uniform: nothing here stretches one axis. */
  readonly scale: number;
  /** The world, in world units. Equal to the design size only when the shapes agree. */
  readonly width: number;
  readonly height: number;
  /** CSS pixels from the surface's left/top edge to world (0, 0). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The surface, in CSS pixels, after the guards below. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /**
   * The part of the world no chrome covers, in world units. Equal to the whole world when
   * there are no insets. Put anything the player must be able to see or touch inside it.
   */
  readonly safeArea: Rect;
  readonly fit: FitMode;
}

const DEFAULT_MIN_ASPECT = 1 / 4;
const DEFAULT_MAX_ASPECT = 4;
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A container that is display:none, or a viewport read before layout, reports zero. */
function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function checkOptions(options: ViewportOptions): {
  fit: FitMode;
  minAspect: number;
  maxAspect: number;
} {
  const { width, height } = options.design;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`viewport design size must be positive, got ${width}x${height}`);
  }
  const fit = options.fit ?? "extend";
  if (fit !== "extend" && fit !== "contain") {
    throw new Error(`viewport fit must be "extend" or "contain", got "${String(fit)}"`);
  }
  const minAspect = options.minAspect ?? DEFAULT_MIN_ASPECT;
  const maxAspect = options.maxAspect ?? DEFAULT_MAX_ASPECT;
  if (!Number.isFinite(minAspect) || minAspect <= 0) {
    throw new Error(`viewport minAspect must be positive, got ${minAspect}`);
  }
  if (!Number.isFinite(maxAspect) || maxAspect < minAspect) {
    throw new Error(`viewport maxAspect must be at least minAspect, got ${maxAspect}`);
  }
  return { fit, minAspect, maxAspect };
}

/**
 * Fit the design size into `size`.
 *
 * Pure: the same arguments give the same layout, so a game's geometry can be unit-tested at
 * every screen shape it claims to support without a browser. Call it from the listener
 * `context.onResize` returns, and once with `context.viewport()` for the first frame.
 */
export function layoutViewport(
  options: ViewportOptions,
  size: ViewportSize,
  insets: Insets = NO_INSETS,
): ViewportLayout {
  const { fit, minAspect, maxAspect } = checkOptions(options);
  const cssWidth = positive(size.width);
  const cssHeight = positive(size.height);
  const devicePixelRatio = positive(size.devicePixelRatio ?? 1);
  const design = options.design;

  let width = design.width;
  let height = design.height;
  if (fit === "extend") {
    // The design rectangle always fits whole — nothing is ever cropped — and the axis with
    // room to spare grows to take it. Past the aspect bounds the world stops growing and
    // what is left becomes a margin.
    const aspect = clamp(cssWidth / cssHeight, minAspect, maxAspect);
    if (aspect >= design.width / design.height) width = design.height * aspect;
    else height = design.width / aspect;
  }
  // One scale for both modes, measured against the world that was just decided. Measuring
  // against the design size instead would overflow a viewport whose aspect was clamped.
  const scale = Math.min(cssWidth / width, cssHeight / height);

  const offsetX = (cssWidth - width * scale) / 2;
  const offsetY = (cssHeight - height * scale) / 2;
  const layout: Omit<ViewportLayout, "safeArea"> = {
    scale,
    width,
    height,
    offsetX,
    offsetY,
    cssWidth,
    cssHeight,
    devicePixelRatio,
    fit,
  };
  return { ...layout, safeArea: safeAreaOf(layout, insets) };
}

/** The inset rectangle, in world units, clamped to the world. */
function safeAreaOf(layout: Omit<ViewportLayout, "safeArea">, insets: Insets): Rect {
  const toWorldX = (cssX: number): number =>
    clamp((cssX - layout.offsetX) / layout.scale, 0, layout.width);
  const toWorldY = (cssY: number): number =>
    clamp((cssY - layout.offsetY) / layout.scale, 0, layout.height);
  const left = toWorldX(Math.max(0, insets.left));
  const top = toWorldY(Math.max(0, insets.top));
  const right = toWorldX(layout.cssWidth - Math.max(0, insets.right));
  const bottom = toWorldY(layout.cssHeight - Math.max(0, insets.bottom));
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * A surface coordinate in world units — what `Input.pointer` reports, converted.
 *
 * Not clamped: a press that lands in a margin is outside the world, and a game that cares
 * should say so rather than have the point quietly moved to an edge it never touched.
 */
export function toWorld(layout: ViewportLayout, cssX: number, cssY: number): Point {
  return {
    x: (cssX - layout.offsetX) / layout.scale,
    y: (cssY - layout.offsetY) / layout.scale,
  };
}

/** A world coordinate in the surface's CSS pixels — for placing a DOM element over it. */
export function toCss(layout: ViewportLayout, worldX: number, worldY: number): Point {
  return {
    x: worldX * layout.scale + layout.offsetX,
    y: worldY * layout.scale + layout.offsetY,
  };
}

/** Whether a world point is inside the world at all. */
export function containsWorld(layout: ViewportLayout, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= layout.width && point.y <= layout.height;
}

/** The padding {@link readSafeAreaInsets} reads back off its probe. */
export interface ProbePadding {
  readonly paddingTop: string;
  readonly paddingRight: string;
  readonly paddingBottom: string;
  readonly paddingLeft: string;
}

/** A probe element: anything whose style can be set one property at a time. */
export interface ProbeElement {
  readonly style: { setProperty(property: string, value: string): void };
}

/** What {@link readSafeAreaInsets} needs from the document. Tests pass a fake. */
export interface SafeAreaHost<E extends ProbeElement> {
  /** Somewhere to attach the probe — the template's #game. */
  appendChild(node: E): unknown;
  removeChild(node: E): unknown;
  readonly ownerDocument: { createElement(tag: "div"): E } | null;
}

/**
 * The CSS safe-area insets, in CSS pixels.
 *
 * `env(safe-area-inset-*)` cannot be read from script, only used in a declaration — so this
 * puts the values on a hidden element's padding and reads that back. They are zero unless
 * the page asks for the full screen, which the template's index.html already does
 * (`viewport-fit=cover`); on a notched phone in landscape they are not.
 *
 * A DOM-drawn HUD should use the CSS variables directly. This is for a HUD drawn on the
 * canvas, which has no other way to know.
 */
export function readSafeAreaInsets<E extends ProbeElement>(
  host: SafeAreaHost<E>,
  computeStyle: (element: E) => ProbePadding = (element) =>
    globalThis.getComputedStyle(element as unknown as Element),
): Insets {
  const document = host.ownerDocument;
  if (!document) return NO_INSETS;
  const probe = document.createElement("div");
  for (const [property, value] of [
    ["position", "absolute"],
    ["visibility", "hidden"],
    ["pointer-events", "none"],
    ["top", "0"],
    ["left", "0"],
    ["width", "0"],
    ["height", "0"],
    ["padding-top", "env(safe-area-inset-top, 0px)"],
    ["padding-right", "env(safe-area-inset-right, 0px)"],
    ["padding-bottom", "env(safe-area-inset-bottom, 0px)"],
    ["padding-left", "env(safe-area-inset-left, 0px)"],
  ] as const) {
    probe.style.setProperty(property, value);
  }
  host.appendChild(probe);
  try {
    const computed = computeStyle(probe);
    return {
      top: pixels(computed.paddingTop),
      right: pixels(computed.paddingRight),
      bottom: pixels(computed.paddingBottom),
      left: pixels(computed.paddingLeft),
    };
  } finally {
    // The probe must go even if reading it threw, or a resize that fails once leaves a
    // growing pile of hidden divs in the container.
    host.removeChild(probe);
  }
}

/** "24px" → 24. Anything unparseable is no inset, which is the safe way to be wrong. */
function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
