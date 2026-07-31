/**
 * Writes the report to a file.
 *
 * Exports live outside the run directory on purpose: deleting a review removes
 * its worktrees, bundle and logs, and the report it produced should outlive
 * all of that. It is the thing the review was for.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoSlug } from "@/lib/git/url";
import { exportsDir } from "@/lib/paths";
import { exportFileName, renderReport } from "@/lib/review/report";
import { requireProject } from "@/server/db/repositories/projects";
import { requireReview, statusOf } from "@/server/db/repositories/reviews";
import { buildReportInput } from "@/server/review/report-input";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
    const { id } = await context.params;

    const review = requireReview(db, id);
    const status = statusOf(review);
    if (status !== "complete") {
      return Response.json(
        {
          error: `This review is ${status.replace(/_/g, " ")}, so there is no report to export.`,
          code: "NotComplete",
        },
        { status: 409 },
      );
    }

    const markdown = renderReport(buildReportInput(db, id));
    const name = exportFileName({
      projectSlug: repoSlug(requireProject(db, review.projectId).name),
      fromBranch: review.fromBranch,
      intoBranch: review.intoBranch,
      at: review.completedAt ?? review.createdAt,
    });

    const directory = exportsDir(dataDir);
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(path, markdown, "utf8");

    return ok({ path, markdown });
  });
}
