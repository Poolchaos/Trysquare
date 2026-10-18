/**
 * Closing a review, once every finding has been decided.
 *
 * Enforced here rather than by hiding the button: the human gatekeeper is a
 * rule about the data, and a client that forgot to check, or a script calling
 * the API directly, must hit the same wall. Completing also releases the
 * worktrees, because the confirmation screen was the last thing that needed
 * them (D-12).
 */

import { worktreeRootDir } from "@/lib/paths";
import { listAwaitingDecision } from "@/server/db/repositories/findings";
import {
  appendRunNote,
  requireReview,
  statusOf,
  transitionReview,
} from "@/server/db/repositories/reviews";
import { removeReviewWorktrees } from "@/server/review/service";
import { handler, ok } from "@/server/api/respond";
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

    const undecided = listAwaitingDecision(db, id);
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

    // The review is complete either way: a checkout that will not go is a
    // cleanup to report, not a failure of the decision the person made. It
    // used to answer 500, so the screen said completing had failed (5.6,
    // audit A7). Said in the answer, for the screen to show, and kept as a
    // run note.
    let cleanup: { cleanupError: string; cleanupNote: string } | undefined;
    try {
      await removeReviewWorktrees(db, id, dataDir);
    } catch (error) {
      const cleanupError = error instanceof Error ? error.message : String(error);
      // Not "delete the review", as it once said: that throws away the
      // findings and the report to tidy a folder (review of 5.5 to 5.7). The
      // folder is a copy of code the clone still holds.
      // Named, because the checkout sits beside the bundle and the logs,
      // which are the review's evidence, and "its folder" could be read as
      // the run's (review of the D-133 fixes).
      const cleanupNote =
        `The review is complete, but its checkout could not be removed: ${cleanupError}. ` +
        "It is only a copy of the code that was reviewed: delete " +
        `${worktreeRootDir(dataDir, id)} by hand once nothing has it open.`;
      appendRunNote(db, id, { kind: "note", message: cleanupNote });
      cleanup = { cleanupError, cleanupNote };
    }

    return ok({ snapshot: manager.snapshot(id), ...cleanup });
  });
}
