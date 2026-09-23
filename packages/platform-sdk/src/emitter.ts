// The platform's own event source.
//
// A copy of the shape of @wgf/game-core's EventBus rather than an import of it: the platform
// package has no dependencies, and an adapter must not pull the game loop in just to tell
// the game an ad started.

import type { PlatformEventSource, PlatformEvents, Unsubscribe } from "./types.js";

type Handler = (payload: never) => void;

export class PlatformEmitter implements PlatformEventSource {
  readonly #handlers = new Map<keyof PlatformEvents, Set<Handler>>();

  on<K extends keyof PlatformEvents>(
    type: K,
    handler: (payload: PlatformEvents[K]) => void,
  ): Unsubscribe {
    let set = this.#handlers.get(type);
    if (!set) {
      set = new Set();
      this.#handlers.set(type, set);
    }
    set.add(handler as Handler);
    return () => {
      set.delete(handler as Handler);
    };
  }

  emit<K extends keyof PlatformEvents>(type: K, payload: PlatformEvents[K]): void {
    const set = this.#handlers.get(type);
    if (!set) return;
    // A throwing listener must not stop the others, nor the adapter that emitted: an ad
    // callback that dies halfway leaves the game paused forever.
    for (const handler of [...set]) {
      try {
        (handler as (payload: PlatformEvents[K]) => void)(payload);
      } catch (error) {
        console.error(`platform event "${String(type)}" handler failed`, error);
      }
    }
  }
}
