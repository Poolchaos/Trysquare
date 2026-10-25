/**
 * What a retried clone removes first (review of 5.5 to 5.7). A removal that
 * failed left the project pending with nothing cloning it, and the removal
 * itself, recursive, went wherever the row's path pointed.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { removeRepo, cloneInBackground } = vi.hoisted(() => ({
  removeRepo: vi.fn<(dir: string) => Promise<void>>(async () => undefined),
  cloneInBackground: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("@/server/gitops/repo", async (original) => ({
  ...(await original<typeof import("@/server/gitops/repo")>()),
  removeRepo,
}));
vi.mock("@/server/projects/clone", () => ({ cloneProjectInBackground: cloneInBackground }));

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-retry-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function failedProject(name: string, clonePath: string) {
  const { db } = (await import("@/server/runtime")).runtime();
  const { createProject, setCloneStatus } = await import("@/server/db/repositories/projects");
  const project = createProject(db, {
    name,
    gitUrl: `git@example.com:acme/${name}.git`,
    defaultBranch: "main",
    clonePath,
  });
  setCloneStatus(db, project.id, "failed", "fatal: Could not read from remote repository.");
  return { db, id: project.id };
}

async function retry(id: string): Promise<Response> {
  const { POST } = await import("@/app/api/projects/[id]/clone/route");
  return POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("retrying a failed clone", () => {
  it("fails again, saying why, when what the last clone left will not go", async () => {
    removeRepo.mockRejectedValueOnce(new Error("EBUSY: resource busy or locked, rmdir 'repo.git'"));
    const { db, id } = await failedProject("busy", join(dataDir, "projects", "x", "repo.git"));

    expect((await retry(id)).status).toBe(500);
    const { requireProject } = await import("@/server/db/repositories/projects");
    const project = requireProject(db, id);
    expect(project.cloneStatus).toBe("failed");
    expect(project.cloneError).toContain("could not be removed");
    expect(project.cloneError).toContain("EBUSY");
    expect(cloneInBackground).not.toHaveBeenCalled();
  });

  it("removes and clones into the project's own directory, whatever its row says", async () => {
    const elsewhere = join(tmpdir(), "not-trysquare", "repo.git");
    const { db, id } = await failedProject("moved", elsewhere);

    expect((await retry(id)).status).toBe(200);
    const own = join(dataDir, "projects", id, "repo.git");
    expect(removeRepo.mock.calls.at(-1)).toEqual([own]);
    expect(cloneInBackground).toHaveBeenCalledWith(db, id, "git@example.com:acme/moved.git", own);
    const { requireProject } = await import("@/server/db/repositories/projects");
    expect(requireProject(db, id).clonePath).toBe(own);
  });
});
