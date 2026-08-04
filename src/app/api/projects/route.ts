/**
 * The projects this app knows about, and adding one.
 *
 * Cloning happens in the background: a large repository takes minutes and a
 * request that waited for it would time out somewhere unhelpful. The row is
 * created immediately with a pending clone state, and the projects screen
 * shows that state until it resolves.
 */

import { z } from "zod";
import { repoSlug, validateGitUrl } from "@/lib/git/url";
import { projectRepoDir } from "@/lib/paths";
import {
  createProject,
  listDependencyLinks,
  listProjects,
  setClonePath,
} from "@/server/db/repositories/projects";
import { listReviewsForProject } from "@/server/db/repositories/reviews";
import { cloneProjectInBackground } from "@/server/projects/clone";
import { created, failed, handler, readJson, ok } from "@/server/api/respond";
import { runtime as appRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addProject = z.object({
  gitUrl: z.string().min(1),
  name: z.string().trim().min(1).optional(),
});

export function GET(): Promise<Response> {
  return handler(async () => {
    const { db } = appRuntime();
    const projects = listProjects(db);
    const nameOf = new Map(projects.map((project) => [project.id, project.name]));

    // The list is where someone decides which project to open, and that
    // decision is made on how much history it has and how fresh its refs are.
    // Both were already a query away and the row said neither.
    return ok({
      projects: projects.map((project) => ({
        ...project,
        reviewCount: listReviewsForProject(db, project.id).length,
        dependencies: listDependencyLinks(db, project.id).map((link) => ({
          id: link.dependencyProjectId,
          name: nameOf.get(link.dependencyProjectId) ?? "a project that is gone",
          packageName: link.packageName,
        })),
      })),
    });
  });
}

export function POST(request: Request): Promise<Response> {
  return handler(async () => {
    const { db, dataDir } = appRuntime();
    const body = await readJson(request, addProject);

    // Validated before the row exists, so a bad address is an error the user
    // sees on the form rather than a project stuck in a failed clone.
    let url: string;
    try {
      url = validateGitUrl(body.gitUrl);
    } catch (error) {
      return failed(error, 400);
    }
    const name = body.name ?? nameFromUrl(url);

    const project = createProject(db, {
      name,
      gitUrl: url,
      defaultBranch: "main",
      clonePath: "",
    });
    const clonePath = projectRepoDir(dataDir, project.id);
    setClonePath(db, project.id, clonePath);

    void cloneProjectInBackground(db, project.id, url, clonePath);
    return created({ project: { ...project, clonePath } });
  });
}

/** A readable name from the address, which is what a person would have typed. */
function nameFromUrl(url: string): string {
  const last =
    url
      .replace(/\.git$/, "")
      .split(/[/:]/)
      .filter(Boolean)
      .pop() ?? "project";
  return repoSlug(last);
}
