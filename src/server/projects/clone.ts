/**
 * The background half of adding a project.
 *
 * Nothing awaits this: the add-project request returns as soon as the row
 * exists, and this settles the clone behind it. That is why it must never
 * reject. A rejection from a promise nobody holds is an unhandled rejection,
 * which under Node's default policy takes the whole server down, and the one
 * sure way to get one here is the user deleting the project while its clone
 * still runs: every status write after that throws ProjectNotFoundError,
 * including the write in the catch block that was reporting the first throw.
 */

import { dirname } from "node:path";
import { projectDir } from "@/lib/paths";
import type { Db } from "../db/client";
import {
  ProjectNotFoundError,
  setCloneStatus,
  setDefaultBranch,
  type Project,
} from "../db/repositories/projects";
import { cloneBare, detectDefaultBranch, removeRepo } from "../gitops/repo";

export async function cloneProjectInBackground(
  db: Db,
  projectId: string,
  url: string,
  clonePath: string,
): Promise<void> {
  try {
    setCloneStatus(db, projectId, "cloning");
    await cloneBare(url, clonePath);
    setDefaultBranch(db, projectId, await detectDefaultBranch(clonePath));
    setCloneStatus(db, projectId, "ready");
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      // Deleted while the clone ran. There is no row to report to, but the
      // clone may have finished writing after the delete route removed the
      // directory, and a project that no longer exists must not keep a repo
      // on disk.
      await removeRepo(dirname(clonePath)).catch(() => undefined);
      return;
    }

    try {
      // Verbatim: git's stderr says what is actually wrong, and a summary of
      // it would leave the user guessing at an authentication or address
      // problem.
      setCloneStatus(
        db,
        projectId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    } catch (writeError) {
      if (writeError instanceof ProjectNotFoundError) {
        await removeRepo(dirname(clonePath)).catch(() => undefined);
        return;
      }
      // The failure could not even be recorded. Stderr is the last resort for
      // a task nothing awaits; swallowing it would hide a real bug.
      console.error("Recording a clone failure failed:", writeError);
    }
  }
}

/**
 * Removes what a deleted project kept on disk.
 *
 * A clone still running writes into the directory as it is removed, so the
 * removal can fail part way: Windows CI run 39134600720 answered a delete
 * with "ENOTEMPTY: directory not empty", the row already gone. That clone,
 * finding its project gone when it ends, removes the directory itself
 * (above), so the failure is not one. With no clone running, it is.
 */
export async function removeProjectFiles(dataDir: string, project: Project): Promise<void> {
  try {
    await removeRepo(projectDir(dataDir, project.id));
  } catch (error) {
    if (project.cloneStatus !== "pending" && project.cloneStatus !== "cloning") throw error;
  }
}
