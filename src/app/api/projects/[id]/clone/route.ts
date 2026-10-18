/**
 * Clones a project again after its clone failed (MVP 5.7, audit U6).
 *
 * A failed clone was a dead end: the list would not open it and nothing
 * could try it again, so the only way forward was to delete it and add the
 * address anew. What git left behind is removed first, since a clone into a
 * directory that is not empty fails.
 */

import { projectRepoDir } from "@/lib/paths";
import { handler, ok } from "@/server/api/respond";
import { requireProject, setClonePath, setCloneStatus } from "@/server/db/repositories/projects";
import { removeRepo } from "@/server/gitops/repo";
import { cloneProjectInBackground } from "@/server/projects/clone";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
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
    // With no await between the check above and this write, so a second
    // retry sent alongside this one finds it pending and is refused instead
    // of cloning into the same directory.
    setCloneStatus(db, id, "pending");

    // Derived, not read from the row: a recursive removal goes only where this
    // data directory keeps the project's clone, whatever the row says
    // (review of 5.5 to 5.7).
    const clonePath = projectRepoDir(dataDir, id);
    try {
      await removeRepo(clonePath);
    } catch (error) {
      // Left pending, the project read as cloning with nothing cloning it.
      const reason = error instanceof Error ? error.message : String(error);
      setCloneStatus(
        db,
        id,
        "failed",
        `What the last clone left could not be removed, so it was not tried again: ${reason}`,
      );
      throw error;
    }
    setClonePath(db, id, clonePath);
    void cloneProjectInBackground(db, id, project.gitUrl, clonePath);
    return ok({ project: requireProject(db, id) });
  });
}
