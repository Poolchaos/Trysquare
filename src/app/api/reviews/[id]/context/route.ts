/**
 * Where a finding sits: the lines around it in the file, and the hunk of the
 * change that produced it.
 *
 * Both halves answer the same question and are fetched together, because a
 * person deciding a finding is comparing them: the diff says what changed,
 * the file says what it changed into. Splitting them into two routes would
 * mean two round trips per finding on a screen driven by a key repeat.
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
import { z } from "zod";
import { formatHunkHeader, hunkForLine, parseUnifiedDiff } from "@/lib/git/diff";
import { bundleDir, worktreeRootDir } from "@/lib/paths";
import { listFindings } from "@/server/db/repositories/findings";
import { requireReview, statusOf } from "@/server/db/repositories/reviews";
import { failed, handler, notFound, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** Enough to see the shape of the function a finding sits in. */
const RADIUS = 20;

const querySchema = z.object({
  path: z.string().min(1, "path is required"),
  // Coerced from the query string, but still required to be a real line
  // number: a citation at line zero or line "abc" is a bug worth surfacing,
  // not something to round to the top of the file.
  line: z.coerce.number().int().positive("line must be a positive integer"),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
    const { id } = await context.params;
    const url = new URL(request.url);
    // The only route that reads query parameters. Coercing them by hand turns
    // a non-numeric line into NaN and silently answers about line one, which
    // is a different question than the one asked.
    const query = querySchema.safeParse({
      path: url.searchParams.get("path"),
      line: url.searchParams.get("line"),
    });
    if (!query.success) {
      return failed(new Error(query.error.issues.map((issue) => issue.message).join("; ")));
    }
    const { path, line } = query.data;

    const status = statusOf(requireReview(db, id));
    if (status !== "awaiting_confirmation") {
      return notFound(
        `File context for a review that is ${status.replace(/_/g, " ")}. ` +
          "The checkout only exists while the findings are being decided",
      );
    }

    const cited = listFindings(db, id).find((finding) => finding.filePath === path);
    if (!cited) return notFound("A file this review did not raise a finding in");

    const hunk = await hunkFor(bundleDir(dataDir, id), cited.repo, path, line);

    let contents: string;
    try {
      contents = await readFile(join(worktreeRootDir(dataDir, id), path), "utf8");
    } catch {
      // A deleted file has no worktree copy, and its hunk is the only view of
      // it there is. Answering with the hunk alone beats a 404 that reads as
      // "no such finding".
      if (hunk) return ok({ path, start: 0, end: 0, total: 0, lines: [], hunk });
      return notFound(`${path} in the review's checkout`);
    }

    const all = contents.split("\n");
    const centre = line;
    const start = Math.max(1, centre - RADIUS);
    const end = Math.min(all.length, centre + RADIUS);

    return ok({
      path,
      start,
      end,
      total: all.length,
      lines: all.slice(start - 1, end).map((text, index) => ({ number: start + index, text })),
      hunk,
    });
  });
}

export interface HunkView {
  header: string;
  lines: string[];
}

/**
 * The hunk of the change that contains a cited line.
 *
 * Read from the bundle's patch, which survives the worktree by design: it is
 * the evidence a finding is explained from after the fact. Paths in the
 * ledger and on findings are qualified by repository slug, while the patch
 * holds the repository's own paths, so the slug comes off before matching.
 */
async function hunkFor(
  bundle: string,
  repo: string,
  qualifiedPath: string,
  line: number,
): Promise<HunkView | null> {
  const patchName = repo === "linked" ? "diff-linked.patch" : "diff.patch";
  let patch: string;
  try {
    patch = await readFile(join(bundle, patchName), "utf8");
  } catch {
    return null;
  }

  const withoutSlug = qualifiedPath.split("/").slice(1).join("/");
  const file = parseUnifiedDiff(patch).find(
    (candidate) => candidate.path === withoutSlug || candidate.oldPath === withoutSlug,
  );
  if (!file) return null;

  const hunk = hunkForLine(file, line);
  return hunk ? { header: formatHunkHeader(hunk), lines: hunk.lines } : null;
}
