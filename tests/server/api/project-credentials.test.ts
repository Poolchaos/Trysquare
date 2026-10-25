/**
 * A project added before credentials in its address were refused (audit
 * finding 2, D-208): the row keeps them, since git still fetches with them,
 * but no response carries them, nor the clone error git's message wrote.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "ghp_SECRET0123456789";
let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-project-credentials-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("a project whose address carries a token", () => {
  it("is served without it, in its address and in its clone error", async () => {
    const { db } = (await import("@/server/runtime")).runtime();
    const { createProject, setCloneStatus } = await import("@/server/db/repositories/projects");
    const { GitCommandError } = await import("@/server/gitops/run");
    const url = `https://user:${TOKEN}@github.com/acme/app.git`;
    const project = createProject(db, {
      name: "app",
      gitUrl: url,
      defaultBranch: "main",
      clonePath: join(dataDir, "projects", "app", "repo.git"),
    });
    // The message git's failure is stored as, built the way a clone builds it.
    const failure = new GitCommandError(
      ["clone", "--bare", "--", url, "repo.git"],
      128,
      `fatal: unable to access '${url}/': The requested URL returned error: 403`,
      false,
    );
    setCloneStatus(db, project.id, "cloning");
    setCloneStatus(db, project.id, "failed", failure.message);

    const list = await (await import("@/app/api/projects/route")).GET();
    const one = await (
      await import("@/app/api/projects/[id]/route")
    ).GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: project.id }) });
    for (const response of [list, one]) {
      const body = await response.text();
      expect(body).not.toContain(TOKEN);
      expect(body).toContain("https://***@github.com/acme/app.git");
    }
    expect(failure.message).not.toContain(TOKEN);
  });
});
