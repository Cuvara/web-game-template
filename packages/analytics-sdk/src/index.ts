// Analytics, behind one vocabulary.
//
// Platform profiles report `analytics: platform-provided | self-hosted | none`. A game that
// branches on that ends up with three different event vocabularies and a performance review
// that cannot compare two titles. The game emits one set of events; where they land is a
// wiring decision made once, at startup.

export type EventProperties = Record<string, string | number | boolean | null>;

export interface AnalyticsEvent {
  readonly name: string;
  readonly properties: EventProperties;
  /** Milliseconds since the Unix epoch, stamped when the event was recorded. */
  readonly timestampMs: number;
}

export interface AnalyticsSink {
  send(events: readonly AnalyticsEvent[]): Promise<void>;
}

export interface AnalyticsOptions {
  readonly sink: AnalyticsSink;
  /** Events buffered before an automatic flush. Default 20. */
  readonly batchSize?: number;
  readonly now?: () => number;
}

/**
 * Buffers events and flushes in batches. Batching exists because several target portals
 * restrict external requests — Yandex's profile sets `external_requests: restricted` — and
 * one request per event is the shape most likely to trip that.
 */
export class Analytics {
  readonly #sink: AnalyticsSink;
  readonly #batchSize: number;
  readonly #now: () => number;
  #buffer: AnalyticsEvent[] = [];

  constructor(options: AnalyticsOptions) {
    this.#sink = options.sink;
    this.#batchSize = options.batchSize ?? 20;
    this.#now = options.now ?? Date.now;
  }

  get pending(): number {
    return this.#buffer.length;
  }

  track(name: string, properties: EventProperties = {}): void {
    this.#buffer.push({ name, properties, timestampMs: this.#now() });
    if (this.#buffer.length >= this.#batchSize) void this.flush();
  }

  /** Send everything buffered. Failures drop the batch rather than block gameplay. */
  async flush(): Promise<void> {
    if (this.#buffer.length === 0) return;
    const batch = this.#buffer;
    this.#buffer = [];
    try {
      await this.#sink.send(batch);
    } catch {
      // Analytics must never take the game down with it.
    }
  }
}

/** Discards everything. For `analytics: none`, and for tests. */
export class NullSink implements AnalyticsSink {
  send(): Promise<void> {
    return Promise.resolve();
  }
}

/** Keeps every batch in memory. For tests and for local inspection. */
export class MemorySink implements AnalyticsSink {
  readonly batches: AnalyticsEvent[][] = [];

  send(events: readonly AnalyticsEvent[]): Promise<void> {
    this.batches.push([...events]);
    return Promise.resolve();
  }

  get events(): AnalyticsEvent[] {
    return this.batches.flat();
  }
}
