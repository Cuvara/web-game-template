// Fitting the design size to a screen: scale, world size, offsets, safe area, conversion.
//
// Pure arithmetic, so every screen shape a game claims to support is checkable here rather
// than in a browser. The sizes are the ones the responsive e2e suite drives (360x640,
// 640x360, 1280x720) plus the extremes that break naive versions of this.

import { describe, expect, it } from "vitest";
import {
  containsWorld,
  layoutViewport,
  readSafeAreaInsets,
  toCss,
  toWorld,
  type ProbeElement,
  type ProbePadding,
  type SafeAreaHost,
  type ViewportOptions,
} from "@wgf/game-core";

const DESIGN: ViewportOptions = { design: { width: 1280, height: 720 } };
const CONTAIN: ViewportOptions = { ...DESIGN, fit: "contain" };

describe("layoutViewport extend", () => {
  it("is exactly the design size at the design aspect ratio", () => {
    const layout = layoutViewport(DESIGN, { width: 1280, height: 720 });

    expect(layout).toMatchObject({
      scale: 1,
      width: 1280,
      height: 720,
      offsetX: 0,
      offsetY: 0,
      fit: "extend",
    });
  });

  it("scales without changing the world when the shape matches", () => {
    const layout = layoutViewport(DESIGN, { width: 640, height: 360 });

    expect(layout.scale).toBe(0.5);
    expect(layout.width).toBe(1280);
    expect(layout.height).toBe(720);
  });

  it("grows the world taller in portrait, and never crops the design width", () => {
    const layout = layoutViewport(DESIGN, { width: 360, height: 640 });

    expect(layout.width).toBe(1280);
    expect(layout.height).toBeGreaterThan(720);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
    // The whole design rectangle is on screen: that is what "nothing cropped" means.
    expect(layout.width * layout.scale).toBeLessThanOrEqual(360 + 1e-9);
    expect(1280 * layout.scale).toBeLessThanOrEqual(360 + 1e-9);
  });

  it("grows the world wider on a letterbox-shaped screen", () => {
    const layout = layoutViewport(DESIGN, { width: 1600, height: 720 });

    expect(layout.height).toBe(720);
    expect(layout.width).toBeCloseTo(1600, 6);
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBeCloseTo(0, 6);
  });

  it("still fills a 32:9 monitor, which is inside the default bounds", () => {
    const layout = layoutViewport(DESIGN, { width: 3840, height: 1080 });

    expect(layout.width / layout.height).toBeCloseTo(3840 / 1080, 6);
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeCloseTo(0, 6);
  });

  it("stops growing at maxAspect and leaves the rest as a margin, without overflowing", () => {
    // Aspect 5, past the default bound of 4. Scaling against the design size rather than the
    // clamped world is what overflows here, so this is the case that pins that down.
    const layout = layoutViewport(DESIGN, { width: 5000, height: 1000 });

    expect(layout.width / layout.height).toBeCloseTo(4, 6);
    expect(layout.width * layout.scale).toBeLessThanOrEqual(5000 + 1e-9);
    expect(layout.height * layout.scale).toBeLessThanOrEqual(1000 + 1e-9);
    expect(layout.offsetX).toBeGreaterThan(0);
  });

  it("stops growing at minAspect on an extremely tall viewport", () => {
    const layout = layoutViewport(DESIGN, { width: 360, height: 2400 });

    expect(layout.width / layout.height).toBeCloseTo(1 / 4, 6);
    expect(layout.height * layout.scale).toBeLessThanOrEqual(2400 + 1e-9);
    expect(layout.offsetY).toBeGreaterThan(0);
  });

  it("honours explicit aspect bounds", () => {
    const layout = layoutViewport(
      { ...DESIGN, minAspect: 9 / 21, maxAspect: 21 / 9 },
      { width: 3840, height: 1080 },
    );

    expect(layout.width / layout.height).toBeCloseTo(21 / 9, 6);
  });

  it("never scales an axis differently from the other", () => {
    for (const size of [
      { width: 360, height: 640 },
      { width: 640, height: 360 },
      { width: 1280, height: 720 },
      { width: 1024, height: 1024 },
    ]) {
      const layout = layoutViewport(DESIGN, size);
      expect(toCss(layout, layout.width, 0).x - layout.offsetX).toBeCloseTo(
        layout.width * layout.scale,
        6,
      );
      expect(toCss(layout, 0, layout.height).y - layout.offsetY).toBeCloseTo(
        layout.height * layout.scale,
        6,
      );
    }
  });
});

describe("layoutViewport contain", () => {
  it("keeps the design size exactly and centres it", () => {
    const layout = layoutViewport(CONTAIN, { width: 1000, height: 720 });

    expect(layout.width).toBe(1280);
    expect(layout.height).toBe(720);
    expect(layout.scale).toBeCloseTo(1000 / 1280, 6);
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeGreaterThan(0);
  });

  it("letterboxes top and bottom on a wide viewport", () => {
    const layout = layoutViewport(CONTAIN, { width: 1600, height: 720 });

    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(160);
    expect(layout.offsetY).toBe(0);
  });

  it("ignores the aspect bounds, because its aspect is the design's", () => {
    const wide = layoutViewport({ ...CONTAIN, maxAspect: 1.1 }, { width: 3840, height: 1080 });

    expect(wide.width / wide.height).toBeCloseTo(1280 / 720, 6);
  });
});

describe("layoutViewport guards", () => {
  it("treats a zero-sized container as one pixel instead of dividing by it", () => {
    const layout = layoutViewport(DESIGN, { width: 0, height: 0 });

    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.cssWidth).toBe(1);
    expect(layout.cssHeight).toBe(1);
  });

  it("treats a negative or non-finite size the same way", () => {
    for (const size of [
      { width: -100, height: 200 },
      { width: Number.NaN, height: 200 },
      { width: 200, height: Number.POSITIVE_INFINITY },
    ]) {
      const layout = layoutViewport(DESIGN, size);
      expect(Number.isFinite(layout.scale)).toBe(true);
      expect(Number.isFinite(layout.width)).toBe(true);
      expect(Number.isFinite(layout.height)).toBe(true);
    }
  });

  it("defaults the device pixel ratio and keeps a real one", () => {
    expect(layoutViewport(DESIGN, { width: 800, height: 600 }).devicePixelRatio).toBe(1);
    expect(
      layoutViewport(DESIGN, { width: 800, height: 600, devicePixelRatio: 3 }).devicePixelRatio,
    ).toBe(3);
    expect(
      layoutViewport(DESIGN, { width: 800, height: 600, devicePixelRatio: 0 }).devicePixelRatio,
    ).toBe(1);
  });

  it("rejects a design size that is not positive", () => {
    for (const design of [
      { width: 0, height: 720 },
      { width: 1280, height: -1 },
      { width: Number.NaN, height: 720 },
    ]) {
      expect(() => layoutViewport({ design }, { width: 800, height: 600 })).toThrow(
        /viewport design size must be positive/,
      );
    }
  });

  it("rejects an unknown fit mode", () => {
    expect(() =>
      layoutViewport({ ...DESIGN, fit: "cover" as never }, { width: 800, height: 600 }),
    ).toThrow(/viewport fit must be "extend" or "contain", got "cover"/);
  });

  it("rejects aspect bounds that are not usable", () => {
    expect(() => layoutViewport({ ...DESIGN, minAspect: 0 }, { width: 8, height: 6 })).toThrow(
      /viewport minAspect must be positive/,
    );
    expect(() =>
      layoutViewport({ ...DESIGN, minAspect: 2, maxAspect: 1 }, { width: 8, height: 6 }),
    ).toThrow(/viewport maxAspect must be at least minAspect/);
  });
});

describe("coordinate conversion", () => {
  it("round-trips a point through world and back", () => {
    const layout = layoutViewport(CONTAIN, { width: 1600, height: 720 });

    const world = toWorld(layout, 800, 360);
    expect(toCss(layout, world.x, world.y)).toEqual({ x: 800, y: 360 });
  });

  it("puts the surface's top-left at the world origin when there is no margin", () => {
    const layout = layoutViewport(DESIGN, { width: 1280, height: 720 });

    expect(toWorld(layout, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(toWorld(layout, 1280, 720)).toEqual({ x: 1280, y: 720 });
  });

  it("accounts for the letterbox margin", () => {
    const layout = layoutViewport(CONTAIN, { width: 1600, height: 720 });

    // 160px of margin on the left, scale 1.
    expect(toWorld(layout, 160, 0)).toEqual({ x: 0, y: 0 });
    expect(toCss(layout, 0, 0)).toEqual({ x: 160, y: 0 });
  });

  it("reports a press in the margin as outside the world rather than clamping it", () => {
    const layout = layoutViewport(CONTAIN, { width: 1600, height: 720 });

    const outside = toWorld(layout, 10, 360);
    expect(outside.x).toBeLessThan(0);
    expect(containsWorld(layout, outside)).toBe(false);
    expect(containsWorld(layout, toWorld(layout, 800, 360))).toBe(true);
  });

  it("converts what Input.pointer reports, which is in the same CSS pixels", () => {
    const layout = layoutViewport(DESIGN, { width: 640, height: 360 });
    // Input.pointer gives surface-relative CSS pixels; scale here is 0.5.
    const pointer = { x: 320, y: 180 };

    expect(toWorld(layout, pointer.x, pointer.y)).toEqual({ x: 640, y: 360 });
  });
});

describe("safe area", () => {
  it("is the whole world when there are no insets", () => {
    const layout = layoutViewport(DESIGN, { width: 1280, height: 720 });

    expect(layout.safeArea).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("converts CSS-pixel insets into world units", () => {
    const layout = layoutViewport(
      DESIGN,
      { width: 640, height: 360 },
      { top: 10, right: 20, bottom: 0, left: 30 },
    );

    // scale 0.5: 30 CSS px of notch is 60 world units.
    expect(layout.safeArea).toEqual({ x: 60, y: 20, width: 1280 - 60 - 40, height: 720 - 20 });
  });

  it("measures from the world, not the surface, when there is a margin", () => {
    const layout = layoutViewport(CONTAIN, { width: 1600, height: 720 }, { ...ZERO, left: 160 });

    // The inset exactly covers the left letterbox margin, so the world is untouched.
    expect(layout.safeArea).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("clamps an inset larger than the world instead of reporting a negative size", () => {
    const layout = layoutViewport(DESIGN, { width: 1280, height: 720 }, { ...ZERO, left: 5000 });

    expect(layout.safeArea.x).toBe(1280);
    expect(layout.safeArea.width).toBe(0);
  });

  it("ignores a negative inset", () => {
    const layout = layoutViewport(DESIGN, { width: 1280, height: 720 }, { ...ZERO, top: -50 });

    expect(layout.safeArea).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

class FakeProbe implements ProbeElement {
  readonly properties = new Map<string, string>();
  readonly style = {
    setProperty: (property: string, value: string): void => {
      this.properties.set(property, value);
    },
  };
}

class FakeHost implements SafeAreaHost<FakeProbe> {
  readonly attached: FakeProbe[] = [];
  removed = 0;
  readonly ownerDocument = { createElement: (): FakeProbe => new FakeProbe() };

  appendChild(node: FakeProbe): unknown {
    this.attached.push(node);
    return node;
  }

  removeChild(): unknown {
    this.removed += 1;
    return undefined;
  }
}

function padding(values: Partial<ProbePadding>): ProbePadding {
  return {
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    ...values,
  };
}

describe("readSafeAreaInsets", () => {
  it("reads the env() values back off a probe and removes it", () => {
    const host = new FakeHost();

    const insets = readSafeAreaInsets(host, () =>
      padding({ paddingTop: "44px", paddingBottom: "34px" }),
    );

    expect(insets).toEqual({ top: 44, right: 0, bottom: 34, left: 0 });
    expect(host.attached[0]?.properties.get("padding-top")).toBe("env(safe-area-inset-top, 0px)");
    expect(host.removed).toBe(1);
  });

  it("removes the probe even when reading it throws, so they cannot pile up", () => {
    const host = new FakeHost();

    expect(() =>
      readSafeAreaInsets(host, () => {
        throw new Error("no layout");
      }),
    ).toThrow(/no layout/);
    expect(host.removed).toBe(1);
  });

  it("treats an unparseable or negative value as no inset", () => {
    const host = new FakeHost();

    const insets = readSafeAreaInsets(host, () =>
      padding({ paddingTop: "auto", paddingLeft: "-8px", paddingRight: "" }),
    );

    expect(insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("reports no insets when there is no document to probe with", () => {
    const host: SafeAreaHost<FakeProbe> = {
      ownerDocument: null,
      appendChild: () => undefined,
      removeChild: () => undefined,
    };

    expect(readSafeAreaInsets(host)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("hides the probe so it can never be seen or touched", () => {
    const host = new FakeHost();

    readSafeAreaInsets(host, () => padding({}));

    const properties = host.attached[0]!.properties;
    expect(properties.get("visibility")).toBe("hidden");
    expect(properties.get("pointer-events")).toBe("none");
    expect(properties.get("position")).toBe("absolute");
  });
});
