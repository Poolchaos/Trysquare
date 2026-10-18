/**
 * A project whose clone failed, and an address added twice (MVP 5.7, audit
 * A2 and U6). A failed clone was a dead end: the list would not open it,
 * nothing could retry it, and adding the address again hit the unique index
 * as a 500 carrying SQLite's own words.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir: string;
let root: string;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  project: typeof import("@/app/api/projects/[id]/route");
  clone: typeof import("@/app/api/projects/[id]/clone/route");
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-clone-api-"));
  root = mkdtempSync(join(tmpdir(), "trysquare-clone-src-"));
  // Set before the runtime module is first imported, because it resolves the
  // data directory once and holds the database open.
  process.env.TRYSQUARE_DATA = dataDir;
  routes = {
    projects: await import("@/app/api/projects/route"),
    project: await import("@/app/api/projects/[id]/route"),
    clone: await import("@/app/api/projects/[id]/clone/route"),
  };
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function settled(id: string): Promise<{ cloneStatus: string; cloneError: string | null }> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await routes.project.GET(new Request("http://localhost/x"), params(id));
    const { project } = (await response.json()) as {
      project: { cloneStatus: string; cloneError: string | null };
    };
    if (project.cloneStatus === "ready" || project.cloneStatus === "failed") return project;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The clone of ${id} never settled.`);
}

describe("an address added twice", () => {
  it("is a 409 naming the project it already is", async () => {
    const url = pathToFileURL(join(root, "twice")).href;
    const first = await routes.projects.POST(post({ gitUrl: url, name: "twice" }));
    expect(first.status).toBe(201);
    const { project } = (await first.json()) as { project: { id: string } };

    const second = await routes.projects.POST(post({ gitUrl: url }));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { code: string; projectId: string; error: string };
    expect(body.code).toBe("DuplicateProject");
    expect(body.projectId).toBe(project.id);
    expect(body.error).toContain("twice");
  });
});

describe("a clone that failed", () => {
  it("can be tried again, and succeeds once the address answers", async () => {
    const origin = join(root, "later");
    const created = await routes.projects.POST(
      post({ gitUrl: pathToFileURL(origin).href, name: "later" }),
    );
    const { project } = (await created.json()) as { project: { id: string } };
    expect((await settled(project.id)).cloneStatus).toBe("failed");

    // The repository arrives, as one does once an address is corrected.
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    writeFileSync(join(origin, "a.ts"), "export const a = 1;\n");
    execFileSync("git", ["add", "a.ts"], { cwd: origin });
    execFileSync(
      "git",
      ["-c", "user.email=t@e.invalid", "-c", "user.name=T", "commit", "-qm", "init"],
      { cwd: origin },
    );

    const retried = await routes.clone.POST(new Request("http://localhost/x"), params(project.id));
    expect(retried.status).toBe(200);
    expect(await settled(project.id)).toEqual(
      expect.objectContaining({ cloneStatus: "ready", cloneError: null }),
    );

    // Only a failed clone is tried again: one that worked is a 409.
    const again = await routes.clone.POST(new Request("http://localhost/x"), params(project.id));
    expect(again.status).toBe(409);
  }, 60_000);
});
