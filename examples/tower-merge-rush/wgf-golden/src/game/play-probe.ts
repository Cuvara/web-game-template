// The play probe: what Tower Merge Rush reports about itself so it can be played and judged
// from outside (the Factory's playability step; its schema is the Factory's
// core/artifacts/shared/play-probe.schema.json).
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. Read-only: a snapshot never changes the game, and the playability step
// only ever acts through real pointer and key input at the positions listed here.
// `oracle` - the drop that merges now - is computed only when the page URL carries
// `wgf-probe=1`; a shipped build never computes it. Each tower says what draws it - the
// runtime asset id and `render: "asset"`, or `render: "primitive"` with no asset in a build
// without art - and `assets_loaded` lists every runtime asset id the game has loaded.

import type { Game } from "@wgf/game-core";
import type { App } from "./app.js";
import { COLUMNS } from "./rules.js";

type Input = { type: "pointer"; x: number; y: number } | { type: "key"; key: string };
/** What draws a column's tower, and where: the board view answers (rendering/pixijs). */
export interface EntitySource {
  describe(
    col: number,
    level: number,
  ): {
    asset: string | null;
    render: "asset" | "primitive";
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
}

interface Move {
  action: string;
  input: Input;
}

export interface PlayProbeOptions {
  readonly app: App;
  readonly game: Game;
  /** The element column input is read from (input/columns.ts): the whole play surface. */
  readonly surface: HTMLElement;
  /** The UI root, whose buttons are the title, pause and result screens' inputs. */
  readonly ui: HTMLElement;
  readonly view: EntitySource;
  /** The runtime asset manifest's loader: the ids it has loaded. */
  readonly assets: { readonly loaded: string[] };
}

function centre(element: Element | null): Input | null {
  if (!element || (element as HTMLElement).hidden) return null;
  const r = element.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    type: "pointer",
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
  };
}

export function installPlayProbe(options: PlayProbeOptions): void {
  const { app, game, surface, ui, view, assets } = options;
  const withOracle = new URLSearchParams(location.search).has("wgf-probe");

  const button = (action: string, name: string): Move | null => {
    const input = centre(ui.querySelector(`[data-action="${action}"]`));
    return input ? { action: name, input } : null;
  };

  const dropAt = (col: number): Move => {
    const r = surface.getBoundingClientRect();
    return {
      action: "drop",
      input: {
        type: "pointer",
        x: Math.round(r.left + ((col + 0.5) * r.width) / COLUMNS),
        y: Math.round(r.top + r.height * 0.5),
      },
    };
  };

  const snapshot = (): unknown => {
    const merge = app.merge;
    const state =
      game.paused && merge.state === "playing"
        ? "paused"
        : merge.state === "start"
          ? "title"
          : merge.state === "over"
            ? "lost"
            : "playing";
    const r = surface.getBoundingClientRect();
    const entities = merge.board.flatMap((level, col) => {
      const drawn = level === null ? null : view.describe(col, level);
      if (!drawn) return [];
      return [
        {
          id: `tower-${col}`,
          role: "target",
          x: Math.round(r.left + drawn.x),
          y: Math.round(r.top + drawn.y),
          w: Math.round(drawn.w),
          h: Math.round(drawn.h),
          visible: true,
          asset: drawn.asset,
          render: drawn.render,
        },
      ];
    });
    const open = merge.board.flatMap((level, col) => (level === null ? [col] : []));
    const inputs: Move[] = [];
    let oracle: Move | null = null;
    if (state === "title") {
      const play = button("play", "play");
      if (play) inputs.push(play);
    } else if (state === "playing") {
      inputs.push(...open.map(dropAt));
      const pause = button("pause", "pause");
      if (pause) inputs.push(pause);
      if (withOracle) {
        // The drop that merges: an open cell beside a tower of the level about to drop; else
        // the leftmost open cell.
        const level = merge.dropLevel;
        const merging = open.find(
          (col) => merge.levelAt(col - 1) === level || merge.levelAt(col + 1) === level,
        );
        oracle = open.length ? dropAt(merging ?? open[0]!) : null;
      }
    } else if (state === "paused") {
      const resume = button("resume", "resume");
      if (resume) inputs.push(resume);
    } else if (state === "lost") {
      const restart = button("restart", "restart");
      if (restart) inputs.push(restart);
    }
    return {
      state,
      metrics: {
        score: merge.score,
        best: app.best,
        "next-piece": merge.dropLevel,
        merges: merge.merges,
      },
      entities,
      inputs,
      assets_loaded: assets.loaded,
      ...(withOracle ? { oracle } : {}),
    };
  };

  // Beside what the template's installProbe() put on window.__wgf__, which must run first:
  // it replaces the object.
  const host = window as unknown as { __wgf__?: Record<string, unknown> };
  const probe = host.__wgf__ ?? {};
  probe["play"] = { snapshot };
  host.__wgf__ = probe;
}
