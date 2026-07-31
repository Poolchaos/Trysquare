/**
 * The event bus.
 *
 * Small enough to be obvious, and load-bearing enough to be worth proving: it
 * is what stands between a browser that disconnected mid-write and a review
 * that fails because of it.
 */

import { describe, expect, it, vi } from "vitest";
import { createReviewBus, type ReviewEvent } from "@/server/jobs/bus";

const statusEvent: ReviewEvent = { kind: "status", status: "running" };

describe("telling everyone watching", () => {
  it("delivers to every listener on that review", () => {
    const bus = createReviewBus();
    const first: ReviewEvent[] = [];
    const second: ReviewEvent[] = [];
    bus.subscribe("r1", (event) => first.push(event));
    bus.subscribe("r1", (event) => second.push(event));

    bus.emit("r1", statusEvent);

    expect(first).toEqual([statusEvent]);
    expect(second).toEqual([statusEvent]);
  });

  it("keeps one review's events away from another's", () => {
    const bus = createReviewBus();
    const seen: ReviewEvent[] = [];
    bus.subscribe("r1", (event) => seen.push(event));

    bus.emit("r2", statusEvent);

    expect(seen).toEqual([]);
  });

  it("stops delivering once a listener unsubscribes", () => {
    const bus = createReviewBus();
    const seen: ReviewEvent[] = [];
    const off = bus.subscribe("r1", (event) => seen.push(event));

    off();
    bus.emit("r1", statusEvent);

    expect(seen).toEqual([]);
    expect(bus.listenerCount("r1")).toBe(0);
  });

  it("carries on when one listener throws", () => {
    // A browser that vanished mid-write must not stop the others being told,
    // and must not fail the review it was watching.
    const errors: unknown[] = [];
    const bus = createReviewBus((error) => errors.push(error));
    const seen: ReviewEvent[] = [];
    bus.subscribe("r1", () => {
      throw new Error("the socket closed");
    });
    bus.subscribe("r1", (event) => seen.push(event));

    expect(() => bus.emit("r1", statusEvent)).not.toThrow();
    expect(seen).toEqual([statusEvent]);
    expect(errors).toHaveLength(1);
  });

  it("lets a listener unsubscribe itself without skipping the next one", () => {
    // What every done-event listener does. Mutating the set mid-iteration
    // would silently drop whoever came after it.
    const bus = createReviewBus();
    const seen: string[] = [];
    const off = bus.subscribe("r1", () => {
      seen.push("first");
      off();
    });
    bus.subscribe("r1", () => seen.push("second"));

    bus.emit("r1", statusEvent);

    expect(seen).toEqual(["first", "second"]);
    expect(bus.listenerCount("r1")).toBe(1);
  });

  it("counts listeners so a leak is visible", () => {
    const bus = createReviewBus();
    const off = bus.subscribe("r1", vi.fn());
    bus.subscribe("r1", vi.fn());
    expect(bus.listenerCount("r1")).toBe(2);
    off();
    expect(bus.listenerCount("r1")).toBe(1);
  });
});
