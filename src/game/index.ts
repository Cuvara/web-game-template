// The game's entry point: the one function a game implements.
//
// GAME-OWNED. main.ts (template-owned) boots the platform, strings and renderer, then calls
// createGame with everything wired (src/game/context.ts) and starts the loop once it
// resolves. Build the game's scenes, UI and input here; report platform moments through
// `context.integration` (or `context.gameplay`); return the audio the platform should mute
// for ads. The template's default is its scaffold scene.

import { BootScene } from "./boot-scene.js";
import type { GameContext, GameHandle } from "./context.js";

export async function createGame(context: GameContext): Promise<GameHandle> {
  await context.game.changeScene(new BootScene({ renderer: context.renderer }));
  return {};
}
