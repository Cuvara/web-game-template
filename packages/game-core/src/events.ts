// A typed event bus.
//
// Subscribing returns an unsubscribe function rather than requiring the caller to keep the
// handler reference around for a matching `off`. Scenes are torn down often and the
// forgotten `off` is the usual source of a listener leak.

export type EventMap = Record<string, unknown>;

export type Handler<T> = (payload: T) => void;

/** Call to unsubscribe. Calling more than once is safe. */
export type Unsubscribe = () => void;

export class EventBus<M extends EventMap> {
  readonly #handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, handler: Handler<M[K]>): Unsubscribe {
    let set = this.#handlers.get(type);
    if (!set) {
      set = new Set();
      this.#handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  /** Subscribe for a single delivery, then unsubscribe automatically. */
  once<K extends keyof M>(type: K, handler: Handler<M[K]>): Unsubscribe {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof M>(type: K, handler: Handler<M[K]>): void {
    const set = this.#handlers.get(type);
    if (!set) return;
    set.delete(handler as Handler<never>);
    if (set.size === 0) this.#handlers.delete(type);
  }

  /**
   * Deliver to every current subscriber. The set is copied first so a handler may
   * subscribe or unsubscribe during delivery without affecting this emission.
   */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.#handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) (handler as Handler<M[K]>)(payload);
  }

  listenerCount<K extends keyof M>(type: K): number {
    return this.#handlers.get(type)?.size ?? 0;
  }

  clear(): void {
    this.#handlers.clear();
  }
}
