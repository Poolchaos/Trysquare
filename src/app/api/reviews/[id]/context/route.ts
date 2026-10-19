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

import { lstat, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod";
import { formatHunkHeader, hunkForLine, parseUnifiedDiff } from "@/lib/git/diff";
import { bundleDir, insideRoot, worktreeRootDir } from "@/lib/paths";
import { listFindings } from "@/server/db/repositories/findings";
import { requireReview, statusOf } from "@/server/db/repositories/reviews";
import { failed, handler, notFound, ok } from "@/server/api/respond";
import { realPath } from "@/server/real-path";
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

    const { hunk, deleted, renamedTo } = await hunkFor(
      bundleDir(dataDir, id),
      cited.repo,
      path,
      line,
    );

    // Contained like every other path a model named: an S4 finding path is
    // not reconciled against the change set, so it could point anywhere. One
    // that climbs out is refused before any read: not found, never "could
    // not be read". A file the change renamed, cited by its old name, is read
    // from its new one, the one the checkout has (D-141).
    const root = worktreeRootDir(dataDir, id);
    let target: string;
    try {
      target = insideRoot(root, renamedTo ?? path);
    } catch {
      return notFound(`${path} in the review's checkout`);
    }
    const empty = { path, start: 0, end: 0, total: 0, lines: [], hunk };
    let contents: string;
    try {
      // Read from where it really is, and only inside the checkout: a link
      // the change committed passes the text check and led the read wherever
      // it pointed (D-142). Resolved once and read from there, so what is
      // checked is what is read (D-143).
      const [realTarget, realRoot] = await Promise.all([realPath(target), realPath(root)]);
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
        // A link the change made shows its hunk, which says where it points;
        // where it points is never read (D-143).
        if (hunk) return ok({ ...empty, outside: true });
        return notFound(`${path} in the review's checkout`);
      }
      contents = await readFile(realTarget, "utf8");
    } catch (error) {
      // A file the change deleted has no copy in the checkout, and its hunk is
      // the only view of it there is. Any other file that could not be read
      // is said as that, with its hunk if it has one: every failed read used
      // to be answered as a deletion (D-140), and one with no hunk, busy or
      // refused, as a file not found (D-141). Not found is kept for a file
      // that is not there and is not in the change.
      if (deleted) return ok({ ...empty, deleted: true });
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      // A link the change made to something not there: its hunk says where it
      // points, and there is nothing to read or try again (D-144). Only when
      // what it points at is missing: a link to a directory, or to a file
      // busy or refused, was called a link to nothing (D-145).
      if (
        hunk &&
        (code === "ENOENT" || code === "ELOOP") &&
        (await lstat(target).then(
          (stat) => stat.isSymbolicLink(),
          () => false,
        ))
      ) {
        return ok({ ...empty, brokenLink: true });
      }
      if (hunk || (code !== "ENOENT" && code !== "ENOTDIR")) {
        return ok({ ...empty, readError: error instanceof Error ? error.message : String(error) });
      }
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
      ...(renamedTo ? { renamedTo } : {}),
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
): Promise<{ hunk: HunkView | null; deleted: boolean; renamedTo?: string }> {
  const patchName = repo === "linked" ? "diff-linked.patch" : "diff.patch";
  let patch: string;
  try {
    patch = await readFile(join(bundle, patchName), "utf8");
  } catch {
    return { hunk: null, deleted: false };
  }

  const [slug, ...rest] = qualifiedPath.split("/");
  const withoutSlug = rest.join("/");
  // The file itself first, then a file renamed from it. A copy carries the
  // path it was copied from too, and git lists entries by the path they go
  // to, so a copy can come first, and matching either path took it for the
  // file (D-142, D-143).
  const files = parseUnifiedDiff(patch);
  const file =
    files.find((candidate) => candidate.path === withoutSlug) ??
    files.find(
      (candidate) => candidate.changeType === "renamed" && candidate.oldPath === withoutSlug,
    );
  if (!file) return { hunk: null, deleted: false };

  const hunk = hunkForLine(file, line);
  return {
    hunk: hunk ? { header: formatHunkHeader(hunk), lines: hunk.lines } : null,
    deleted: file.changeType === "deleted",
    ...(file.path !== withoutSlug ? { renamedTo: `${slug}/${file.path}` } : {}),
  };
}
