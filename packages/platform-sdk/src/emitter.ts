// The smallest emitter the adapters need.
//
// platform-sdk depends on nothing, game-core included, so it cannot borrow game-core's
// EventBus. A handler that throws is isolated: one broken listener must not stop the game
// hearing that the portal took the foreground.

import type { PlatformEvents } from "./types.js";

type Handler<T> = (payload: T) => void;

export class PlatformEmitter {
  readonly #handlers = new Map<keyof PlatformEvents, Set<Handler<never>>>();

  on<K extends keyof PlatformEvents>(event: K, handler: Handler<PlatformEvents[K]>): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof PlatformEvents>(event: K, payload: PlatformEvents[K]): void {
    for (const handler of [...(this.#handlers.get(event) ?? [])]) {
      try {
        (handler as Handler<PlatformEvents[K]>)(payload);
      } catch (error) {
        console.error(`platform "${String(event)}" handler failed`, error);
      }
    }
  }
}
