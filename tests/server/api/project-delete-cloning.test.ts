/**
 * Deleting a project while its clone still runs. The clone writes into the
 * project's directory as the delete removes it, so the removal can fail
 * part way: Windows CI run 39134600720 answered 500 with "ENOTEMPTY:
 * directory not empty, rmdir '...repo.git'", the row already gone. The
 * clone, finding its project gone when it ends, removes the directory
 * itself, so that failure is not the person's to see.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { removeRepo } = vi.hoisted(() => ({
  removeRepo: vi.fn(async (_dir: string): Promise<void> => {
    throw Object.assign(new Error("ENOTEMPTY: directory not empty, rmdir 'repo.git'"), {
      code: "ENOTEMPTY",
    });
  }),
}));

vi.mock("@/server/gitops/repo", async (original) => ({
  ...(await original<typeof import("@/server/gitops/repo")>()),
  removeRepo,
}));

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-delete-cloning-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function projectIn(status: "pending" | "ready", name: string) {
  const { db } = (await import("@/server/runtime")).runtime();
  const { createProject, setCloneStatus } = await import("@/server/db/repositories/projects");
  const project = createProject(db, {
    name,
    gitUrl: `git@example.com:acme/${name}.git`,
    defaultBranch: "main",
    clonePath: join(dataDir, "projects", name, "repo.git"),
  });
  if (status === "ready") {
    setCloneStatus(db, project.id, "cloning");
    setCloneStatus(db, project.id, "ready");
  }
  return { db, id: project.id };
}

async function remove(id: string): Promise<Response> {
  const { DELETE } = await import("@/app/api/projects/[id]/route");
  return DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

describe("deleting a project whose files will not all go", () => {
  it("answers that it is deleted while its clone still runs, which removes them after", async () => {
    const { db, id } = await projectIn("pending", "cloning-still");
    expect((await remove(id)).status).toBe(200);
    const { getProject } = await import("@/server/db/repositories/projects");
    expect(getProject(db, id)).toBeUndefined();
  });

  it("says the removal failed when no clone is running to finish it", async () => {
    const { id } = await projectIn("ready", "cloned-long-ago");
    const response = await remove(id);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain("ENOTEMPTY");
  });
});
