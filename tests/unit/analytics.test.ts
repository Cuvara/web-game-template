import { describe, expect, it } from "vitest";
import { Analytics, MemorySink, NullSink, type AnalyticsSink } from "@wgf/analytics-sdk";

describe("Analytics", () => {
  it("buffers until the batch size, then flushes once", async () => {
    const sink = new MemorySink();
    const analytics = new Analytics({ sink, batchSize: 3 });

    analytics.track("a");
    analytics.track("b");
    expect(sink.batches).toHaveLength(0);
    expect(analytics.pending).toBe(2);

    analytics.track("c");
    await analytics.flush();

    expect(sink.batches).toHaveLength(1);
    expect(sink.events.map((event) => event.name)).toEqual(["a", "b", "c"]);
  });

  it("stamps events with the injected clock", async () => {
    const sink = new MemorySink();
    const analytics = new Analytics({ sink, batchSize: 100, now: () => 1234 });
    analytics.track("a", { level: 2 });
    await analytics.flush();
    expect(sink.events[0]).toEqual({
      name: "a",
      properties: { level: 2 },
      timestampMs: 1234,
    });
  });

  it("flushing an empty buffer sends nothing", async () => {
    const sink = new MemorySink();
    await new Analytics({ sink }).flush();
    expect(sink.batches).toHaveLength(0);
  });

  it("swallows a failing sink rather than taking the game down", async () => {
    const failing: AnalyticsSink = {
      send: () => Promise.reject(new Error("network blocked")),
    };
    const analytics = new Analytics({ sink: failing, batchSize: 100 });
    analytics.track("a");

    await expect(analytics.flush()).resolves.toBeUndefined();
    // The batch is gone: dropping is deliberate, retrying forever is worse on a portal
    // whose profile restricts external requests.
    expect(analytics.pending).toBe(0);
  });

  it("discards everything through the null sink", async () => {
    const analytics = new Analytics({ sink: new NullSink(), batchSize: 1 });
    analytics.track("a");
    await expect(analytics.flush()).resolves.toBeUndefined();
  });
});
