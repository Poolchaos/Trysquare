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
  listProjects,
  setCloneStatus,
  setClonePath,
  setDefaultBranch,
} from "@/server/db/repositories/projects";
import { cloneBare, detectDefaultBranch } from "@/server/gitops/repo";
import { created, failed, handler, ok, readJson } from "@/server/api/respond";
import { runtime as appRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addProject = z.object({
  gitUrl: z.string().min(1),
  name: z.string().trim().min(1).optional(),
});

export function GET(): Promise<Response> {
  return handler(async () => ok({ projects: listProjects(appRuntime().db) }));
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
    setCloneStatus(db, project.id, "pending");

    void cloneInBackground(db, project.id, url, clonePath);
    return created({ project: { ...project, clonePath } });
  });
}

async function cloneInBackground(
  db: ReturnType<typeof appRuntime>["db"],
  projectId: string,
  url: string,
  clonePath: string,
): Promise<void> {
  try {
    await cloneBare(url, clonePath);
    setDefaultBranch(db, projectId, await detectDefaultBranch(clonePath));
    setCloneStatus(db, projectId, "ready");
  } catch (error) {
    // Verbatim: git's stderr says what is actually wrong, and a summary of it
    // would leave the user guessing at an authentication or address problem.
    setCloneStatus(db, projectId, "failed", error instanceof Error ? error.message : String(error));
  }
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
