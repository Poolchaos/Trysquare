/**
 * A project whose clone failed, and an address added twice (MVP 5.7, audit
 * A2 and U6). A failed clone was a dead end: the list would not open it,
 * nothing could retry it, and adding the address again hit the unique index
 * as a 500 carrying SQLite's own words.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  branches: typeof import("@/app/api/projects/[id]/branches/route");
  fetch: typeof import("@/app/api/projects/[id]/fetch/route");
  reviews: typeof import("@/app/api/reviews/route");
  preflight: typeof import("@/app/api/reviews/preflight/route");
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
    branches: await import("@/app/api/projects/[id]/branches/route"),
    fetch: await import("@/app/api/projects/[id]/fetch/route"),
    reviews: await import("@/app/api/reviews/route"),
    preflight: await import("@/app/api/reviews/preflight/route"),
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

    // Another spelling of the same address is the same repository.
    const respelled = await routes.projects.POST(post({ gitUrl: `${url}/` }));
    expect(respelled.status).toBe(409);

    // Its clone, of an address with nothing behind it, runs on after the
    // answer; awaited, so it cannot still be writing when the database closes.
    expect((await settled(project.id)).cloneStatus).toBe("failed");
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
    // Without it, git on Windows warns that the file's LF will become CRLF.
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: origin });
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

describe("a clone that is not ready", () => {
  it("is neither fetched into nor listed, while queued or once failed", async () => {
    const { runtime } = await import("@/server/runtime");
    const { createProject, setCloneStatus } = await import("@/server/db/repositories/projects");
    const { db } = runtime();
    // Made directly, so no background clone races the answers below.
    const queued = createProject(db, {
      name: "queued",
      gitUrl: pathToFileURL(join(root, "queued")).href,
      defaultBranch: "main",
      clonePath: join(root, "queued.git"),
    });
    // Starting a review, and previewing one, fetch into the clone as well
    // (review of the D-133 fixes).
    const pair = { projectId: queued.id, fromBranch: "feature/x", intoBranch: "main" };
    const answers = async () => [
      await routes.branches.GET(new Request("http://localhost/x"), params(queued.id)),
      await routes.fetch.POST(
        new Request("http://localhost/x", { method: "POST" }),
        params(queued.id),
      ),
      await routes.reviews.POST(post({ ...pair, model: "claude-fable-5[1m]" })),
      await routes.preflight.POST(post({ ...pair, rulesetId: "R", model: "claude-fable-5[1m]" })),
    ];

    // The project page asked for both every second while a clone ran, and
    // each ran git fetch inside the clone still being written.
    for (const answer of await answers()) {
      expect(answer.status).toBe(409);
      expect(await answer.json()).toEqual({
        code: "CloneNotReadyError",
        error: expect.stringContaining("still being cloned") as unknown,
      });
    }

    setCloneStatus(db, queued.id, "failed", "fatal: nothing there");
    for (const answer of await answers()) {
      expect(answer.status).toBe(409);
      expect(((await answer.json()) as { error: string }).error).toContain("clone failed");
    }
  });
});

describe("deleting a project", () => {
  it("removes its own directory, never one its row names", async () => {
    // A row is data, and the recursive removal went to the parent of whatever
    // path it named, outside the data directory if that is where it pointed
    // (review of the D-133 fixes).
    const outside = mkdtempSync(join(tmpdir(), "trysquare-not-ours-"));
    const { runtime } = await import("@/server/runtime");
    const { createProject } = await import("@/server/db/repositories/projects");
    const project = createProject(runtime().db, {
      name: "planted",
      gitUrl: "git@example.com:acme/planted.git",
      defaultBranch: "main",
      clonePath: join(outside, "repo.git"),
    });
    const own = join(dataDir, "projects", project.id);
    mkdirSync(own, { recursive: true });

    expect(
      (
        await routes.project.DELETE(
          new Request("http://localhost/x", { method: "DELETE" }),
          params(project.id),
        )
      ).status,
    ).toBe(200);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(own)).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("a review with a linked dependency that cannot be used", () => {
  // Refused before any fetch: creating a review fetched the primary from the
  // network, and recorded that fetch, before it read the dependency, and no
  // test covered a dependency that was not cloned yet (review of the D-134
  // fixes). The primary is ready, with no clone on disk, so a fetch would fail.
  it("is refused for what is wrong with the dependency, before any fetch", async () => {
    const { db } = (await import("@/server/runtime")).runtime();
    const { createProject, linkDependency, requireProject, setCloneStatus } =
      await import("@/server/db/repositories/projects");
    const make = (name: string, ready: boolean) => {
      const made = createProject(db, {
        name,
        gitUrl: `git@example.com:acme/${name}.git`,
        defaultBranch: "main",
        clonePath: join(root, `${name}.git`),
      });
      if (ready) {
        setCloneStatus(db, made.id, "cloning");
        setCloneStatus(db, made.id, "ready");
      }
      return made;
    };
    const primary = make("consumer", true);
    const queued = make("queued-core", false);
    const unlinked = make("unlinked-core", true);
    linkDependency(db, {
      projectId: primary.id,
      dependencyProjectId: queued.id,
      packageName: "@acme/queued-core",
    });

    const branches = { fromBranch: "feature/x", intoBranch: "main" };
    const create = (dependencyId: string) =>
      routes.reviews.POST(
        post({
          projectId: primary.id,
          ...branches,
          model: "claude-fable-5[1m]",
          linked: { projectId: dependencyId, ...branches },
        }),
      );
    const preview = (dependencyId: string) =>
      routes.preflight.POST(
        post({
          projectId: primary.id,
          ...branches,
          rulesetId: "R",
          model: "claude-fable-5[1m]",
          linked: { projectId: dependencyId, ...branches },
        }),
      );
    const codeOf = async (response: Response) =>
      [response.status, ((await response.json()) as { code: string }).code] as const;

    expect(await codeOf(await create(queued.id))).toEqual([409, "CloneNotReadyError"]);
    expect(await codeOf(await preview(queued.id))).toEqual([409, "CloneNotReadyError"]);
    expect(await codeOf(await create("NOPE"))).toEqual([404, "ProjectNotFoundError"]);
    expect(await codeOf(await create(unlinked.id))).toEqual([400, "NotLinked"]);
    // Nothing was fetched on the primary's behalf for any of them.
    expect(requireProject(db, primary.id).lastFetchedAt).toBeNull();
  });
});
