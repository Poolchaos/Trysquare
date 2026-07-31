/**
 * Asking the CLI whether one model is actually usable.
 *
 * Only ever from an explicit click (D-31). A probe is a real call that spends
 * a fraction of a cent, and an app that probed on a timer would spend the
 * user's usage while they were not looking. The prompt and toolset are minimal
 * so the cost is as small as a real call can be.
 */

import {
  recordProbeFailure,
  recordProbeSuccess,
  requireModel,
} from "@/server/db/repositories/models";
import { probeModel } from "@/server/engine/probe";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const model = requireModel(db, id);

    const claudePath = process.env.TRYSQUARE_CLAUDE_PATH;
    const outcome = await probeModel(model.id, claudePath === undefined ? {} : { claudePath });

    if (outcome.status === "available") {
      recordProbeSuccess(db, model.id, {
        resolvedId: outcome.resolvedId,
        contextWindow: outcome.contextWindow,
      });
    } else {
      // Indeterminate is recorded as a failure with its own message rather
      // than left as unknown: "we asked and could not tell" is more useful
      // than "we never asked".
      recordProbeFailure(db, model.id, outcome.error);
    }

    return ok({ outcome, model: requireModel(db, model.id) });
  });
}
