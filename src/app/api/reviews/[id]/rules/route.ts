/**
 * The rules this review was judged against, as it was judged against them.
 *
 * Read from the review's frozen snapshot rather than the live ruleset, so a
 * rule edited since the run does not change what a finding is shown to have
 * broken. That is the same reason the snapshot exists at all (02).
 *
 * The verbatim markdown is what the confirmation screen expands: a person
 * deciding whether a finding is real is really deciding whether the rule says
 * what the engine claims it says, and a parsed summary cannot answer that.
 */

import { readReviewSnapshot } from "@/server/db/repositories/rulesets";
import { handler, ok } from "@/server/api/respond";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { id } = await context.params;
    const snapshot = readReviewSnapshot(runtime().db, id);

    return ok({
      rules: snapshot.rules.map((rule) => ({
        code: rule.code,
        title: rule.title,
        severity: rule.severity,
        group: rule.group,
        raw: rule.raw,
      })),
    });
  });
}
