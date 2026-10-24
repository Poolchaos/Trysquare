/** One project, with its dependency links and its reviews. Or gone. */

import { z } from "zod";
import {
  CloneNotReadyError,
  type ProjectHasReviewsError,
  deleteProject,
  listDependencyLinks,
  listProjects,
  renameProject,
  requireProject,
  setDefaultBranch,
} from "@/server/db/repositories/projects";
import { listBranches } from "@/server/gitops/repo";
import { listReviewsForProject } from "@/server/db/repositories/reviews";
import { getProjectChecks } from "@/server/db/repositories/project-checks";
import { failed, handler, isNamed, ok, readJson } from "@/server/api/respond";
import { removeProjectFiles } from "@/server/projects/clone";
import { runtime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const links = listDependencyLinks(db, id);
    const byId = new Map(listProjects(db).map((project) => [project.id, project.name]));

    return ok({
      project: requireProject(db, id),
      links: links.map((link) => ({
        ...link,
        dependencyName: byId.get(link.dependencyProjectId) ?? "a project that is gone",
      })),
      // Offered as link candidates, so the form is a choice rather than an id
      // someone has to find.
      linkable: listProjects(db)
        .filter(
          (candidate) =>
            candidate.id !== id &&
            candidate.cloneStatus === "ready" &&
            !links.some((link) => link.dependencyProjectId === candidate.id),
        )
        .map((candidate) => ({ id: candidate.id, name: candidate.name })),
      reviews: listReviewsForProject(db, id),
      checks: getProjectChecks(db, id),
    });
  });
}

const edit = z
  .object({
    name: z.string().trim().min(1).optional(),
    defaultBranch: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.defaultBranch !== undefined, {
    message: "Say what to change: a name, a default branch, or both.",
  });

/**
 * Renames a project, or sets the branch a review compares against by
 * default, which the clone guessed from the remote's HEAD and could guess
 * wrong; the data model always called both editable, with no way to edit
 * either (D-51). A default branch must be one the clone has, so its clone
 * must be ready; a review's own branches are its own, so none changes.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db } = runtime();
    const { id } = await context.params;
    const project = requireProject(db, id);
    const body = await readJson(request, edit);

    if (body.defaultBranch !== undefined) {
      if (project.cloneStatus !== "ready") throw new CloneNotReadyError(id, project.cloneStatus);
      const branches = await listBranches(project.clonePath);
      if (!branches.some((branch) => branch.name === body.defaultBranch)) {
        return Response.json(
          {
            error: `This project's clone has no branch named "${body.defaultBranch}".`,
            code: "BranchNotFound",
          },
          { status: 400 },
        );
      }
      setDefaultBranch(db, id, body.defaultBranch);
    }
    if (body.name !== undefined) renameProject(db, id, body.name);
    return ok({ project: requireProject(db, id) });
  });
}

/**
 * Removes a project and the clone it owns.
 *
 * The row and the clone must not outlive each other in either direction: a
 * clone with no row is disk nobody can account for, and a row with no clone is
 * a project every screen offers and nothing can use. Refused while reviews
 * reference it, because deleting those silently would discard the history the
 * reviews are for.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = runtime();
    const { id } = await context.params;
    const project = requireProject(db, id);

    try {
      deleteProject(db, id);
    } catch (error) {
      if (isNamed<ProjectHasReviewsError>(error, "ProjectHasReviewsError")) {
        // The count travels as a field, so the screen can offer the remedy
        // (delete those reviews first) with the real number on the button.
        return Response.json(
          { error: error.message, code: error.name, reviewCount: error.reviewCount },
          { status: 409 },
        );
      }
      return failed(error, 409);
    }

    // The project's whole directory, not just the bare repo inside it.
    // Removing only the clone leaves an empty directory per deleted project,
    // accumulating quietly forever.
    await removeProjectFiles(dataDir, project);
    return ok({ removed: id });
  });
}
