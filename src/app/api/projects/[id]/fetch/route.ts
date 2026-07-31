/**
 * Fetch a project's refs now, rather than waiting for a branch list to do it.
 *
 * Useful when a branch was pushed a moment ago and the picker has not been
 * opened since. Git's own message is returned verbatim on failure: an
 * authentication problem and an unreachable host need different answers from
 * the person reading it.
 */

import { recordFetch, requireProject } from "@/server/db/repositories/projects";
import { failed, handler, ok } from "@/server/api/respond";
import { fetchAll } from "@/server/gitops/repo";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const project = requireProject(db, id);

    try {
      await fetchAll(project.clonePath);
    } catch (error) {
      return failed(error, 502);
    }

    recordFetch(db, project.id);
    return ok({ lastFetchedAt: requireProject(db, id).lastFetchedAt });
  });
}
