// The textures Tower Merge Rush draws with, loaded from the runtime asset manifest.
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. Each slot names the design's asset id and its role; the manifest resolves it
// (assets/runtime-assets.ts). SVGs are rasterised by PixiJS at a resolution that stays sharp
// at the size the view draws them on a high-density phone.

import { Assets, type Texture } from "pixi.js";
import type { AssetQuery, RuntimeAssets } from "../../assets/runtime-assets.js";

export const ART = {
  pieces: { id: "pieces", role: "target" },
  frame: { id: "track-frame", role: "environment" },
  backdrop: { id: "backdrop", role: "background" },
  vfx: { id: "merge-vfx", role: "vfx" },
} as const satisfies Record<string, AssetQuery>;

export interface Drawn {
  readonly id: string;
  readonly texture: Texture;
}

/** What the view has to draw with. Empty lists and nulls mean "draw primitives". */
export interface BoardArt {
  /** One per tower level, level 1 first. */
  readonly pieces: readonly Drawn[];
  readonly frame: Drawn | null;
  /** The 9-slice border of the frame, in its own pixels. */
  readonly frameSlice: number;
  readonly backdrop: Drawn | null;
  /** The merge burst, then the cascade streak. */
  readonly vfx: readonly Drawn[];
}

export const NO_ART: BoardArt = { pieces: [], frame: null, frameSlice: 0, backdrop: null, vfx: [] };

export async function loadBoardArt(
  assets: RuntimeAssets,
  onProgress?: (share: number) => void,
): Promise<BoardArt> {
  if (!assets.present) return NO_ART;
  const resolution = Math.min(3, Math.max(2, Math.ceil(globalThis.devicePixelRatio ?? 1)));
  const wanted = new Map<string, number>();
  const pieces = assets.drawings(ART.pieces);
  const vfx = assets.drawings(ART.vfx);
  const frame = assets.find(ART.frame);
  const backdrop = assets.find(ART.backdrop);
  for (const id of pieces) wanted.set(id, resolution);
  for (const id of vfx) wanted.set(id, resolution);
  if (frame) wanted.set(frame, resolution);
  // The backdrop is drawn at about its own size: a 2x raster of 1920 px would be wasted.
  if (backdrop) wanted.set(backdrop, 1);

  const textures = new Map<string, Texture>();
  let done = 0;
  await Promise.all(
    [...wanted].map(async ([id, res]) => {
      const url = assets.url(id);
      if (!url) return;
      const entry = assets.entry(id);
      const scale = entry?.scale ?? 1;
      const svg = entry?.format === "svg";
      const texture = await Assets.load<Texture>({
        alias: `wgf:${id}`,
        src: url,
        data: { resolution: svg ? res * scale : scale },
        // The manifest's format, not the URL's extension, says what the file is.
        ...(svg ? { parser: "svg" } : {}),
      });
      textures.set(id, texture);
      assets.markLoaded(id);
      done += 1;
      onProgress?.(done / wanted.size);
    }),
  );

  const drawn = (id: string | null): Drawn | null => {
    const texture = id ? textures.get(id) : undefined;
    return id && texture ? { id, texture } : null;
  };
  const frameDrawn = drawn(frame);
  return {
    pieces: pieces.map(drawn).filter((d): d is Drawn => d !== null),
    frame: frameDrawn,
    // The frame's own drawing reserves 40 of its 144 px for each border.
    frameSlice: frameDrawn ? Math.round((frameDrawn.texture.width * 40) / 144) : 0,
    backdrop: drawn(backdrop),
    vfx: vfx.map(drawn).filter((d): d is Drawn => d !== null),
  };
}
