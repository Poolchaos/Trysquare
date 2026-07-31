/**
 * The event stream a browser watches a review through.
 *
 * Tested by calling the handler with a Request rather than by standing up a
 * server, because everything worth checking here is about what the stream
 * says and when it stops saying it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { createProject } from "@/server/db/repositories/projects";
import { createReview } from "@/server/db/repositories/reviews";
import { createReviewBus } from "@/server/jobs/bus";
import { JobManager } from "@/server/jobs/manager";
import { reviewEventStream } from "@/server/jobs/stream";
import { makeTestDb, type TestDb } from "../db/helpers";

let ctx: TestDb;
let db: Db;
let dataDir: string;
let manager: JobManager;
let bus: ReturnType<typeof createReviewBus>;
/** The manager's picture, with a bus the test can drive directly. */
let watcher: { snapshot: (id: string) => unknown; subscribe: typeof bus.subscribe };
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-stream-"));
  manager = new JobManager();
  manager.init({ db, dataDir });
  bus = createReviewBus();
  watcher = { snapshot: (id) => manager.snapshot(id), subscribe: bus.subscribe };

  const project = createProject(db, {
    name: "app",
    gitUrl: "git@example.com:acme/app.git",
    defaultBranch: "main",
    clonePath: join(dataDir, "app.git"),
  });
  reviewId = createReview(db, {
    projectId: project.id,
    fromBranch: "feature/x",
    fromCommit: "a".repeat(40),
    intoBranch: "main",
    intoCommit: "b".repeat(40),
    mergeBaseCommit: "c".repeat(40),
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  }).id;
});

afterEach(() => {
  ctx.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Reads whatever the stream has produced so far, without waiting for the end. */
async function readAvailable(response: Response, frames: number): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < frames; i += 1) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  void reader.cancel();
  return text;
}

function open(signal = new AbortController().signal) {
  return reviewEventStream(watcher, reviewId, { signal }, { heartbeatMs: 20 });
}

describe("opening the stream", () => {
  it("announces itself as an event stream that must not be buffered", () => {
    const response = open();
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
    // A proxy that buffers would defeat the whole point of streaming.
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("opens with the whole picture, so a late arrival misses nothing", async () => {
    const text = await readAvailable(open(), 1);

    expect(text.startsWith("event: snapshot\n")).toBe(true);
    const payload = JSON.parse(text.slice(text.indexOf("data: ") + 6, text.indexOf("\n\n")));
    expect(payload.review.id).toBe(reviewId);
    expect(payload.stages).toEqual([]);
    expect(payload.running).toBe(false);
  });

  it("sends what happens next as updates", async () => {
    const response = open();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // the snapshot

    const events = [
      { kind: "status", status: "running" } as const,
      { kind: "done", outcome: "completed" } as const,
    ];
    for (const event of events) bus.emit(reviewId, event);

    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain("event: update");
    expect(text).toContain('"status":"running"');
    void reader.cancel();
  });
});

describe("closing the stream", () => {
  it("stops when the review is over, rather than holding the tab open", async () => {
    const response = open();
    const reader = response.body!.getReader();
    await reader.read();

    bus.emit(reviewId, { kind: "done", outcome: "completed" });

    // The done frame, then the end.
    await reader.read();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it("lets go when the browser goes away", async () => {
    const controller = new AbortController();
    const response = open(controller.signal);
    const reader = response.body!.getReader();
    await reader.read();

    expect(bus.listenerCount(reviewId)).toBe(1);
    controller.abort();

    expect(bus.listenerCount(reviewId)).toBe(0);
    void reader.cancel();
  });

  it("subscribes to nothing when the request was already abandoned", async () => {
    // A browser that gave up before the handler ran. Without this the stream
    // would sit subscribed to a review nobody is watching.
    const controller = new AbortController();
    controller.abort();

    const response = open(controller.signal);
    await readAvailable(response, 1);

    expect(bus.listenerCount(reviewId)).toBe(0);
  });

  it("unsubscribes when the reader cancels", async () => {
    const response = open();
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(bus.listenerCount(reviewId)).toBe(0);
  });
});

describe("keeping the connection alive", () => {
  it("sends a comment line so a proxy does not close a quiet stream", async () => {
    const response = open();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    const { value } = await reader.read();
    expect(decoder.decode(value)).toContain(": heartbeat");
    void reader.cancel();
  });
});
