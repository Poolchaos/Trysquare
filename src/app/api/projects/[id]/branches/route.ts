/**
 * The branches a project has, fetched before they are listed.
 *
 * Fetching first is the point (D-29): a picker showing yesterday's refs would
 * let someone review a branch tip that has already moved. When the remote is
 * unreachable the cached refs are still listed, marked stale, because browsing
 * offline is reasonable even though starting a review that way is not.
 */

import { detectDefaultBranch, divergence, fetchAll, listBranches } from "@/server/gitops/repo";
import { recordFetch, requireProject } from "@/server/db/repositories/projects";
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
    const project = requireProject(db, id);

    let stale: string | null = null;
    try {
      await fetchAll(project.clonePath);
      recordFetch(db, project.id);
    } catch (error) {
      stale = error instanceof Error ? error.message : String(error);
    }

    const branches = await listBranches(project.clonePath);
    const into = project.defaultBranch || (await detectDefaultBranch(project.clonePath));

    // Ahead and behind are what tell someone whether a branch is worth
    // reviewing yet, and they are cheap to compute while we are here.
    const withDivergence = await Promise.all(
      branches.map(async (branch) => ({
        ...branch,
        ...(branch.name === into
          ? { ahead: 0, behind: 0 }
          : await divergence(project.clonePath, branch.name, into)),
      })),
    );

    return ok({
      branches: withDivergence,
      defaultBranch: into,
      lastFetchedAt: requireProject(db, id).lastFetchedAt,
      stale,
    });
  });
}
