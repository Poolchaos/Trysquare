/**
 * The report for a completed review.
 *
 * Only for a completed one: a report is the record of what a person accepted,
 * so a review still waiting on decisions has nothing to report yet.
 */

import { renderReport } from "@/lib/review/report";
import { requireReview, statusOf } from "@/server/db/repositories/reviews";
import { buildReportInput } from "@/server/review/report-input";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;

    const status = statusOf(requireReview(db, id));
    if (status !== "complete") {
      return Response.json(
        {
          error:
            `This review is ${status.replace(/_/g, " ")}. A report is the record of what a ` +
            "person accepted, so it exists once every finding has been decided.",
          code: "NotComplete",
        },
        { status: 409 },
      );
    }

    return ok({ markdown: renderReport(buildReportInput(db, id)) });
  });
}
