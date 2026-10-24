/**
 * The screenshot a design finding is about (WP-I step 4), for its card and
 * the report. Served only from that review's own screenshots folder: the
 * row keeps the name, and a name that would leave the folder is refused.
 */

import { readFile } from "node:fs/promises";
import { requireCheckFinding } from "@/server/db/repositories/check-findings";
import { handler } from "@/server/api/respond";
import { screenshotFile, screenshotNameOf } from "@/server/review/screenshots";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
    const { id } = await context.params;
    const row = requireCheckFinding(db, id);
    const notFound = (error: string) =>
      Response.json({ error, code: "ScreenshotNotFound" }, { status: 404 });
    if (row.screenshotPath === null) return notFound("This finding has no screenshot.");
    const file = screenshotFile(
      dataDir,
      row.reviewId,
      screenshotNameOf(dataDir, row.reviewId, row.screenshotPath),
    );
    if (file === null) return notFound("This screenshot is not in its review's folder.");
    try {
      const bytes = await readFile(file);
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    } catch {
      return notFound("The screenshot is gone: its review's files were removed.");
    }
  });
}
