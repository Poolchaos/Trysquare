/**
 * The screenshot a design finding is about (WP-I step 4), for its card and
 * the report. Served only from that review's own checks folder: the path is
 * the row's, and a row that named anywhere else would not be served.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { checksDir } from "@/lib/paths";
import { requireCheckFinding } from "@/server/db/repositories/check-findings";
import { handler } from "@/server/api/respond";
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
    const folder = resolve(checksDir(dataDir, row.reviewId), "screenshots");
    const inside = relative(folder, resolve(row.screenshotPath));
    if (
      inside === "" ||
      // Another drive on Windows: relative answers with an absolute path.
      isAbsolute(inside) ||
      inside.startsWith("..") ||
      resolve(folder, inside) !== resolve(row.screenshotPath)
    ) {
      return notFound("This screenshot is not in its review's folder.");
    }
    try {
      const bytes = await readFile(resolve(folder, inside));
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    } catch {
      return notFound("The screenshot is gone: its review's files were removed.");
    }
  });
}
