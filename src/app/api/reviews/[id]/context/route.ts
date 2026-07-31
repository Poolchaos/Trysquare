/**
 * The lines around a finding, read from the review's own worktree.
 *
 * Two guards, both about not becoming a file server. The path must be one a
 * finding in this review actually cites, so a caller cannot walk the disk by
 * asking for something else. And the review must be awaiting confirmation,
 * which is the only status whose worktree is guaranteed to still exist
 * (D-12); afterwards the checkout is gone and the quoted code stored on each
 * finding is the record.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreeRootDir } from "@/lib/paths";
import { listFindings } from "@/server/db/repositories/findings";
import { requireReview, statusOf } from "@/server/db/repositories/reviews";
import { handler, notFound, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** Enough to see the shape of the function a finding sits in. */
const RADIUS = 20;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
    const { id } = await context.params;
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const line = Number.parseInt(url.searchParams.get("line") ?? "", 10);

    const status = statusOf(requireReview(db, id));
    if (status !== "awaiting_confirmation") {
      return notFound(
        `File context for a review that is ${status.replace(/_/g, " ")}. ` +
          "The checkout only exists while the findings are being decided",
      );
    }

    const cited = listFindings(db, id).some((finding) => finding.filePath === path);
    if (!cited) return notFound("A file this review did not raise a finding in");

    let contents: string;
    try {
      contents = await readFile(join(worktreeRootDir(dataDir, id), path), "utf8");
    } catch {
      return notFound(`${path} in the review's checkout`);
    }

    const all = contents.split("\n");
    const centre = Number.isFinite(line) ? line : 1;
    const start = Math.max(1, centre - RADIUS);
    const end = Math.min(all.length, centre + RADIUS);

    return ok({
      path,
      start,
      end,
      total: all.length,
      lines: all.slice(start - 1, end).map((text, index) => ({ number: start + index, text })),
    });
  });
}
