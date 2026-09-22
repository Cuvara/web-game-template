import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@wgf/game-core";

interface TestEvents extends Record<string, unknown> {
  ping: number;
  pong: void;
}

describe("EventBus", () => {
  it("delivers payloads to every subscriber", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("ping", a);
    bus.on("ping", b);

    bus.emit("ping", 42);

    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it("unsubscribes through the returned function, idempotently", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const off = bus.on("ping", handler);

    off();
    off();
    bus.emit("ping", 1);

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount("ping")).toBe(0);
  });

  it("delivers a `once` subscription exactly once", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once("ping", handler);

    bus.emit("ping", 1);
    bus.emit("ping", 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it("is not disturbed by a handler that unsubscribes during delivery", () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    const off = bus.on("ping", () => off());
    bus.on("ping", second);

    expect(() => bus.emit("ping", 1)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not deliver to a handler subscribed during the same emission", () => {
    const bus = new EventBus<TestEvents>();
    const late = vi.fn();
    bus.on("ping", () => bus.on("ping", late));

    bus.emit("ping", 1);

    expect(late).not.toHaveBeenCalled();
  });
});
