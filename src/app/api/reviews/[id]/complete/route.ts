/**
 * Closing a review, once every finding has been decided.
 *
 * Enforced here rather than by hiding the button: the human gatekeeper is a
 * rule about the data, and a client that forgot to check, or a script calling
 * the API directly, must hit the same wall. Completing also releases the
 * worktrees, because the confirmation screen was the last thing that needed
 * them (D-12).
 */

import { listFindingsByStatus } from "@/server/db/repositories/findings";
import { requireReview, statusOf, transitionReview } from "@/server/db/repositories/reviews";
import { removeReviewWorktrees } from "@/server/review/service";
import { failed, handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir, manager } = runtime();
    const { id } = await context.params;

    const status = statusOf(requireReview(db, id));
    if (status !== "awaiting_confirmation") {
      return Response.json(
        {
          error: `This review is ${status.replace(/_/g, " ")}, so there is nothing to complete.`,
          code: "NotAwaitingConfirmation",
        },
        { status: 409 },
      );
    }

    const undecided = listFindingsByStatus(db, id, ["verified", "open_question"]);
    if (undecided.length > 0) {
      return Response.json(
        {
          error:
            `${undecided.length} finding(s) still need a decision. A report is the record ` +
            "of what a person accepted, so every finding is confirmed or dismissed first.",
          code: "UndecidedFindings",
        },
        { status: 409 },
      );
    }

    transitionReview(db, id, "complete", { currentStage: null });

    try {
      await removeReviewWorktrees(db, id, dataDir);
    } catch (error) {
      // The review is complete either way; a stuck checkout is not a reason
      // to refuse the decision the human already made.
      return failed(error, 500);
    }

    return ok({ snapshot: manager.snapshot(id) });
  });
}
