/**
 * How large a request body may be (audit finding 5, D-211): every route
 * reads its body through readJson or readOptionalJson, which buffered
 * whatever arrived. Past the limit the request is refused, whether its size
 * was declared or only found while reading it.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_BODY_BYTES, readJson, readOptionalJson } from "@/server/api/respond";

const any = z.object({ text: z.string() });

/** A body streamed in pieces, with no Content-Length, as a chunked upload is. */
function streamed(bytes: number): Request {
  const piece = new Uint8Array(64 * 1024).fill(0x61);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const next = piece.subarray(0, Math.min(piece.length, bytes - sent));
      sent += next.length;
      controller.enqueue(next);
    },
  });
  return new Request("http://localhost/x", { method: "POST", body, duplex: "half" } as RequestInit);
}

async function refusal(read: Promise<unknown>): Promise<Response> {
  try {
    await read;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  throw new Error("the body was read");
}

describe("a request body", () => {
  it("is read when it is within the limit", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ text: "a protocol" }),
    });
    expect(await readJson(request, any)).toEqual({ text: "a protocol" });
  });

  it("is read at exactly the limit, and when it starts with a byte-order mark", async () => {
    // Exactly the limit, a byte short of a refusal: a check off by one
    // passed every test before.
    const atLimit = JSON.stringify({ text: "" }).length;
    const text = "a".repeat(MAX_BODY_BYTES - atLimit);
    const exact = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    expect((await readJson(exact, any)).text).toHaveLength(text.length);
    // A JSON file PowerShell 5.1 writes starts with one; request.json() took
    // it, and decoding the bytes by hand refused it (review round 11).
    const marked = new Request("http://localhost/x", {
      method: "POST",
      body: `\uFEFF${JSON.stringify({ text: "a protocol" })}`,
    });
    expect(await readJson(marked, any)).toEqual({ text: "a protocol" });
  });

  it("is refused when it says it is over the limit, before it is read", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": String(MAX_BODY_BYTES + 1) },
      body: "{}",
    });
    const refused = await refusal(readJson(request, any));
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({
      error: "The request body is over 4 MiB, the most a request may carry.",
      code: "BodyTooLarge",
    });
  });

  it("is refused when it turns out over the limit as it is read", async () => {
    for (const read of [
      readJson(streamed(MAX_BODY_BYTES + 1), any),
      readOptionalJson(streamed(MAX_BODY_BYTES + 1), any),
    ]) {
      expect((await refusal(read)).status).toBe(413);
    }
  });
});
