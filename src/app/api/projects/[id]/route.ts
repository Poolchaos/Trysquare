/** One project, with its dependency links and its reviews. Or gone. */

import {
  deleteProject,
  listDependencyLinks,
  listProjects,
  requireProject,
} from "@/server/db/repositories/projects";
import { listReviewsForProject } from "@/server/db/repositories/reviews";
import { failed, handler, ok } from "@/server/api/respond";
import { dirname } from "node:path";
import { removeRepo } from "@/server/gitops/repo";
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
    });
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
    const { db } = runtime();
    const { id } = await context.params;
    const project = requireProject(db, id);

    try {
      deleteProject(db, id);
    } catch (error) {
      return failed(error, 409);
    }

    // The project's whole directory, not just the bare repo inside it.
    // Removing only the clone leaves an empty directory per deleted project,
    // accumulating quietly forever.
    if (project.clonePath) await removeRepo(dirname(project.clonePath));
    return ok({ removed: id });
  });
}
