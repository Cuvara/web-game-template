// The play probe: what Tower Merge Rush reports about itself so it can be played and judged
// from outside (the Factory's playability step; its schema is the Factory's
// core/artifacts/shared/play-probe.schema.json).
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. Read-only: a snapshot never changes the game, and the playability step
// only ever acts through real pointer and key input at the positions listed here.
// `oracle` - the drop that merges now - is computed only when the page URL carries
// `wgf-probe=1`; a shipped build never computes it.

import type { Game } from "@wgf/game-core";
import type { App } from "./app.js";
import { COLUMNS } from "./rules.js";

type Input = { type: "pointer"; x: number; y: number } | { type: "key"; key: string };
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
}

/** The track's geometry, as rendering/pixijs/board-view.ts lays it out (gap 8, 92% wide). */
function cellRect(
  width: number,
  height: number,
  col: number,
): { x: number; y: number; size: number } {
  const gap = 8;
  const cell = Math.min((width * 0.92 - gap * (COLUMNS - 1)) / COLUMNS, height * 0.4);
  const track = cell * COLUMNS + gap * (COLUMNS - 1);
  return { x: (width - track) / 2 + col * (cell + gap), y: (height - cell) / 2, size: cell };
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
  const { app, game, surface, ui } = options;
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
      if (level === null) return [];
      const cell = cellRect(r.width, r.height, col);
      return [
        {
          id: `tower-${col}`,
          role: "target",
          x: r.left + cell.x,
          y: r.top + cell.y,
          w: cell.size,
          h: cell.size,
          visible: true,
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
