/**
 * Clones a project again after its clone failed (MVP 5.7, audit U6).
 *
 * A failed clone was a dead end: the list would not open it and nothing
 * could try it again, so the only way forward was to delete it and add the
 * address anew. What git left behind is removed first, since a clone into a
 * directory that is not empty fails.
 */

import { handler, ok } from "@/server/api/respond";
import { requireProject, setCloneStatus } from "@/server/db/repositories/projects";
import { removeRepo } from "@/server/gitops/repo";
import { cloneProjectInBackground } from "@/server/projects/clone";
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
    // Only a failed clone: one queued or under way would get a second clone
    // beside it, and one that worked has nothing to try again.
    if (project.cloneStatus !== "failed") {
      throw Response.json(
        {
          error: `This project's clone is ${project.cloneStatus}, not failed, so there is nothing to retry.`,
          code: "CloneNotFailed",
        },
        { status: 409 },
      );
    }
    setCloneStatus(db, id, "pending");
    await removeRepo(project.clonePath);
    void cloneProjectInBackground(db, id, project.gitUrl, project.clonePath);
    return ok({ project: requireProject(db, id) });
  });
}
