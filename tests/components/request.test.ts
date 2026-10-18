/**
 * A screen's request never throws past its message (review of 5.1 to 5.4).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "@/components/request";

afterEach(() => vi.unstubAllGlobals());

function answering(response: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  );
}

describe("a screen's request", () => {
  it("says a dropped request failed, and why", async () => {
    answering(new TypeError("Failed to fetch"));
    expect(await send("/x", {}, "The review could not be deleted")).toEqual({
      ok: false,
      status: null,
      error: "The review could not be deleted: Failed to fetch",
      body: {},
    });
  });

  it("says an error page that is not JSON failed, in its own words", async () => {
    answering(new Response("<html>Server error</html>", { status: 500 }));
    const sent = await send("/x", {}, "The report could not be exported");
    expect(sent.ok).toBe(false);
    expect(sent.ok === false && sent.error).toBe("The report could not be exported.");
  });

  it("passes the server's own refusal through, with the rest of its body", async () => {
    answering(
      Response.json(
        { error: "In use.", code: "ProjectHasReviewsError", reviewCount: 2 },
        { status: 409 },
      ),
    );
    const sent = await send("/x", {}, "The project could not be deleted");
    expect(sent).toEqual({
      ok: false,
      status: 409,
      error: "In use.",
      body: { error: "In use.", code: "ProjectHasReviewsError", reviewCount: 2 },
    });
  });

  it("hands back the body of an answer that worked", async () => {
    answering(Response.json({ path: "/out/report.md" }));
    expect(await send<{ path: string }>("/x", {}, "Failed")).toEqual({
      ok: true,
      status: 200,
      body: { path: "/out/report.md" },
    });
  });
});
