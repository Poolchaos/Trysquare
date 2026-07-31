/**
 * The HTTP layer, called the way a browser calls it.
 *
 * Handlers are invoked directly with a Request rather than through a server,
 * which is enough: everything worth checking here is what a handler does with
 * a body and what it hands back. The routes share one process-wide runtime, so
 * these tests point it at a temporary data directory before importing them.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";

let fixture: SeededFixture;
let dataDir: string;
let projectId: string;
let defaultBranch: string;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  branches: typeof import("@/app/api/projects/[id]/branches/route");
  reviews: typeof import("@/app/api/reviews/route");
  rulesets: typeof import("@/app/api/rulesets/import/route");
};

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  fixture = await buildFixture();
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-api-"));
  // Set before the runtime module is first imported, because it resolves the
  // data directory once and holds the database open.
  process.env.TRYSQUARE_DATA = dataDir;

  routes = {
    projects: await import("@/app/api/projects/route"),
    branches: await import("@/app/api/projects/[id]/branches/route"),
    reviews: await import("@/app/api/reviews/route"),
    rulesets: await import("@/app/api/rulesets/import/route"),
  };

  const created = await routes.projects.POST(
    post("http://localhost/api/projects", { gitUrl: `file://${fixture.appClone}`, name: "app" }),
  );
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const ready = await projectReady(projectId);
  expect(ready.cloneStatus, String(ready.cloneError)).toBe("ready");
  defaultBranch = String(ready.defaultBranch);
}, 180_000);

afterAll(() => {
  fixture?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

/** Waits for the background clone to land, which is what the UI polls for. */
async function projectReady(id: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; cloneStatus: string; cloneError: string | null }[];
    };
    const project = body.projects.find((row) => row.id === id);
    if (project && project.cloneStatus !== "pending") return project;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the clone never finished");
}

describe("adding a project", () => {
  it("accepts an address, then clones in the background", async () => {
    // Cloned in beforeAll, because a project is its remote and a second
    // project on the same address is refused. A large repository takes
    // minutes, so the row exists immediately and the screen watches the clone
    // state rather than the request hanging.
    const listed = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; name: string; cloneStatus: string; defaultBranch: string }[];
    };
    const project = listed.projects.find((row) => row.id === projectId);

    expect(project?.name).toBe("app");
    expect(project?.cloneStatus).toBe("ready");
    // Read from the remote's own HEAD rather than assumed to be main.
    expect(project?.defaultBranch).toBe(defaultBranch);
    expect(defaultBranch).not.toBe("");
  }, 120_000);

  it("refuses a second project on the same address", async () => {
    // A project is a clone of a remote. Two rows for one remote would fetch
    // twice into two directories and disagree about what the branches are.
    const response = await routes.projects.POST(
      post("http://localhost/api/projects", {
        gitUrl: `file://${fixture.appClone}`,
        name: "again",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an address git would read as an option", async () => {
    // The reason the validator exists. A project stuck in a failed clone would
    // be a worse answer than a message on the form.
    const response = await routes.projects.POST(
      post("http://localhost/api/projects", { gitUrl: "--upload-pack=touch /tmp/pwned" }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/option/i);
  });

  it("says which field was wrong when the body is not a project", async () => {
    const response = await routes.projects.POST(post("http://localhost/api/projects", {}));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("gitUrl");
  });
});

describe("listing branches", () => {
  it("returns them with how far each has diverged", async () => {
    const response = await routes.branches.GET(new Request("http://localhost"), params(projectId));
    const body = (await response.json()) as {
      branches: { name: string; ahead: number; behind: number }[];
      defaultBranch: string;
      stale: string | null;
      lastFetchedAt: string | null;
    };

    expect(body.defaultBranch).toBe(defaultBranch);
    expect(body.stale).toBeNull();
    expect(body.lastFetchedAt).not.toBeNull();
    expect(body.branches.map((branch) => branch.name)).toContain("feature/rename-prefs");

    // Measured against the project's default branch, whichever that is. The
    // two fixture branches genuinely differ, so one of the counts must be
    // non-zero, and the default branch is level with itself.
    const other = body.branches.find((branch) => branch.name !== body.defaultBranch);
    expect(other && other.ahead + other.behind).toBeGreaterThan(0);
    const isDefault = body.branches.find((branch) => branch.name === body.defaultBranch);
    expect(isDefault).toMatchObject({ ahead: 0, behind: 0 });
  }, 120_000);
});

describe("creating a review", () => {
  it("pins the commits the branches point at right now", async () => {
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
        intent: "Rename the prefs field.",
      }),
    );
    expect(response.status).toBe(201);

    const { review } = (await response.json()) as {
      review: { fromCommit: string; mergeBaseCommit: string; intent: string; effort: string };
    };
    expect(review.fromCommit).toBe(fixture.appHead);
    expect(review.mergeBaseCommit).toBe(fixture.appBase);
    expect(review.intent).toBe("Rename the prefs field.");
    expect(review.effort).toBe("high");
  }, 120_000);

  it("refuses a branch that does not exist, rather than pinning nothing", async () => {
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "no-such-branch",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120_000);
});

describe("importing a ruleset", () => {
  it("stores the document and reports what it contained", async () => {
    const markdown = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");

    const response = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "Example protocol",
        tier: "global",
        markdown,
      }),
    );
    expect(response.status).toBe(201);

    const body = (await response.json()) as { rules: number; directives: number; version: number };
    expect(body.rules).toBeGreaterThan(0);
    expect(body.directives).toBeGreaterThan(0);
  });

  it("refuses a document that produced no rules", async () => {
    // A review judged against nothing comes back clean, and reads exactly like
    // a review that found nothing wrong.
    const response = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "Broken",
        tier: "global",
        markdown: "# Not a protocol\n\nNothing here parses as a rule.\n",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
