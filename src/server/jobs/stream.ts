/**
 * A review's progress as a server-sent event stream.
 *
 * Separated from the route handler so it can be tested by calling it with a
 * Request, rather than by standing up a server. The route is then a two-line
 * wrapper, which is about as much as a route should be.
 *
 * The first frame is the whole truth, read from the database, so a browser
 * that connects late or reconnects after a restart is never missing the part
 * that happened while it was away. Everything after it is a change to that
 * picture.
 */

import type { ReviewEvent, ReviewListener } from "./bus";

/**
 * The part of the manager a stream needs.
 *
 * Narrow on purpose: the stream reads a picture and listens for changes, and
 * nothing here should be able to start or cancel a review.
 */
export interface ReviewWatcher {
  snapshot: (reviewId: string) => unknown;
  subscribe: (reviewId: string, listener: ReviewListener) => () => void;
}

/** Proxies and browsers close a stream that says nothing for long enough. */
const HEARTBEAT_MS = 15_000;

export interface StreamOptions {
  heartbeatMs?: number;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function reviewEventStream(
  manager: ReviewWatcher,
  reviewId: string,
  request: { signal: AbortSignal },
  options: StreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (text: string): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The client went away between the check and the write. Nothing to
          // report: a closed browser tab is not a fault of the review.
          open = false;
        }
      };

      const close = (): void => {
        if (!open) return;
        open = false;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      send(frame("snapshot", manager.snapshot(reviewId)));

      unsubscribe = manager.subscribe(reviewId, (event: ReviewEvent) => {
        send(frame("update", event));
        // The run is over and nothing further will be emitted for it. Holding
        // the connection open would leave the browser waiting on a stream that
        // has nothing left to say.
        if (event.kind === "done") close();
      });

      heartbeat = setInterval(() => send(": heartbeat\n\n"), options.heartbeatMs ?? HEARTBEAT_MS);
      // Node keeps the process alive for a pending timer; a heartbeat should
      // not be a reason for the server to refuse to exit.
      heartbeat.unref?.();

      if (request.signal.aborted) close();
      else request.signal.addEventListener("abort", close, { once: true });
    },

    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells a proxy not to buffer, which would defeat the whole point.
      "X-Accel-Buffering": "no",
    },
  });
}
