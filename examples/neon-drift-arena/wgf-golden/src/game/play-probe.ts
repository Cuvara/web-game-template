// The play probe: what Neon Drift Arena reports about itself so it can be played and judged
// from outside (the Factory's playability step; its schema is the Factory's
// core/artifacts/shared/play-probe.schema.json).
//
// GOLDEN-RUN REPLAY, written by hand for the Factory's golden-run replay developer; not
// agent-written. Read-only: a snapshot never changes the game, and the playability step
// only ever acts through real pointer and key input at the positions listed here. `oracle`
// - the steer that keeps the craft out of the next wall - is computed only when the page URL
// carries `wgf-probe=1`; a shipped build never computes it.

import type { Game } from "@wgf/game-core";
import type { App } from "./app.js";

type Input =
  | { type: "pointer"; x: number; y: number; hold_ms?: number }
  | { type: "key"; key: string; hold_ms?: number };
interface Move {
  action: string;
  input: Input;
}
type Bounds = { x: number; y: number; w: number; h: number; inFront: boolean };

export interface PlayProbeOptions {
  readonly app: App;
  readonly game: Game;
  /** The element steering input is read from (input/steering.ts): the whole play surface. */
  readonly surface: HTMLElement;
  /** The UI root, whose buttons are the menu, pause and result screens' inputs. */
  readonly ui: HTMLElement;
  /** Screen bounds of an arena box (rendering/threejs/arena.ts screenBounds). */
  readonly project: (centre: [number, number, number], size: [number, number, number]) => Bounds;
}

/** A steer is held: the craft slides while the pointer is down (input/steering.ts). */
const HOLD_MS = 220;
/** How far ahead (arena units) a wall is worth steering for. */
const LOOKAHEAD = 14;

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
  const { app, game, surface, ui, project } = options;
  const withOracle = new URLSearchParams(location.search).has("wgf-probe");

  const button = (id: string, action: string): Move | null => {
    const input = centre(ui.querySelector(`#${id}`));
    return input ? { action, input } : null;
  };

  const steer = (side: -1 | 1): Move => {
    const r = surface.getBoundingClientRect();
    return {
      action: "steer",
      input: {
        type: "pointer",
        x: Math.round(r.left + r.width * (side < 0 ? 0.1 : 0.9)),
        y: Math.round(r.top + r.height * 0.6),
        hold_ms: HOLD_MS,
      },
    };
  };

  const entity = (id: string, role: string, b: Bounds): Record<string, unknown> => {
    const r = surface.getBoundingClientRect();
    const onScreen =
      b.inFront && b.x + b.w > r.left && b.y + b.h > r.top && b.x < r.right && b.y < r.bottom;
    return { id, role, x: b.x, y: b.y, w: b.w, h: b.h, visible: onScreen };
  };

  const snapshot = (): unknown => {
    const sim = app.simulation;
    const state =
      app.phase === "menu"
        ? "title"
        : app.phase === "over"
          ? "lost"
          : game.paused
            ? "paused"
            : "playing";
    const entities: Record<string, unknown>[] = [];
    if (sim && app.phase !== "menu") {
      entities.push(entity("craft", "player", project([sim.playerX, 0, 0], [0.9, 0.6, 1.4])));
      for (const wall of sim.obstacles) {
        entities.push(
          entity(
            `wall-${wall.id}`,
            "threat",
            project([wall.x, 0, -wall.z], [wall.halfWidth * 2, 1, 1]),
          ),
        );
      }
    }
    const inputs: Move[] = [];
    let oracle: Move | null = null;
    if (state === "title") {
      const play = button("play", "play");
      if (play) inputs.push(play);
    } else if (state === "playing" && sim) {
      inputs.push(steer(-1), steer(1));
      const pause = button("pause", "pause");
      if (pause) inputs.push(pause);
      if (withOracle) {
        // Away from the nearest wall ahead that would hit the craft where it is; with none,
        // back toward the middle of the arena, where the craft has room either way.
        const reach = sim.playerHalfWidth + 0.35;
        const threat = sim.obstacles
          .filter(
            (w) => w.z > 0 && w.z < LOOKAHEAD && Math.abs(w.x - sim.playerX) < w.halfWidth + reach,
          )
          .sort((a, b) => a.z - b.z)[0];
        const bound = sim.arenaHalfWidth - sim.playerHalfWidth;
        const side: -1 | 1 = threat
          ? threat.x > sim.playerX
            ? sim.playerX - 1 > -bound
              ? -1
              : 1
            : sim.playerX + 1 < bound
              ? 1
              : -1
          : sim.playerX > 0
            ? -1
            : 1;
        oracle = steer(side);
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
      metrics: { score: app.score, best: app.best },
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
