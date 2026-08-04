/**
 * The settings screen's two destructive answers: where everything is, and
 * deleting all of it.
 *
 * Its own data directory and its own file, because the wipe genuinely empties
 * the database it runs against and would take another suite's fixtures with
 * it. What is proven here is that the wipe removes what it claims, keeps what
 * it claims, and refuses when a review is still running.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cloneBare } from "@/server/gitops/repo";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";

let fixture: SeededFixture;
let dataDir: string;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  reviews: typeof import("@/app/api/reviews/route");
  rulesets: typeof import("@/app/api/rulesets/import/route");
  system: typeof import("@/app/api/system/route");
  wipe: typeof import("@/app/api/system/data/route");
};

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });

/**
 * Waits for the background clone, which a review cannot be created without.
 * Left out once and the suite raced it: fast enough alone, not under load.
 */
async function cloneSettled(id: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const listed = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; cloneStatus: string }[];
    };
    const row = listed.projects.find((entry) => entry.id === id);
    if (row && (row.cloneStatus === "ready" || row.cloneStatus === "failed")) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the clone never finished");
}

beforeAll(async () => {
  fixture = await buildFixture();
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-danger-"));
  process.env.TRYSQUARE_DATA = dataDir;

  routes = {
    projects: await import("@/app/api/projects/route"),
    reviews: await import("@/app/api/reviews/route"),
    rulesets: await import("@/app/api/rulesets/import/route"),
    system: await import("@/app/api/system/route"),
    wipe: await import("@/app/api/system/data/route"),
  };
}, 180_000);

afterAll(() => {
  fixture?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

it("names the data directory and counts what is in it", async () => {
  const response = await routes.system.GET();
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    dataDir: string;
    exportsDir: string;
    counts: { projects: number; reviews: number; rulesets: number };
  };
  // The real path, not a default someone would have to guess at.
  expect(body.dataDir).toBe(dataDir);
  expect(body.exportsDir.startsWith(dataDir)).toBe(true);
  expect(body.counts).toEqual({ projects: 0, reviews: 0, rulesets: 0 });
}, 120_000);

it("refuses while a review is running, rather than orphaning its process", async () => {
  // A running review owns a CLI process and a checked-out worktree. Deleting
  // its row from under it leaves both behind with nothing pointing at them.
  const remote = join(dataDir, "busy.git");
  await cloneBare(fixture.appClone, remote);
  const created = await routes.projects.POST(
    post("http://localhost/api/projects", { gitUrl: `file://${remote}`, name: "busy" }),
  );
  const { project } = (await created.json()) as { project: { id: string } };
  await cloneSettled(project.id);

  const review = await routes.reviews.POST(
    post("http://localhost/api/reviews", {
      projectId: project.id,
      fromBranch: "feature/rename-prefs",
      intoBranch: "main",
      model: "claude-fable-5[1m]",
    }),
  );
  expect(review.status, await review.clone().text()).toBe(201);
  const { review: row } = (await review.json()) as { review: { id: string } };

  const { runtime } = await import("@/server/runtime");
  const { transitionReview } = await import("@/server/db/repositories/reviews");
  transitionReview(runtime().db, row.id, "running");

  const refused = await routes.wipe.DELETE();
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe("ReviewStillRunning");

  // Left exactly as it was: a refusal that half-deleted would be worse than
  // either answer.
  const after = (await (await routes.system.GET()).json()) as {
    counts: { projects: number; reviews: number };
  };
  expect(after.counts.projects).toBe(1);
  expect(after.counts.reviews).toBe(1);

  transitionReview(runtime().db, row.id, "cancelled");
  await routes.wipe.DELETE();
}, 240_000);

it("deletes every project, review and ruleset, and the clone on disk with them", async () => {
  const remote = join(dataDir, "doomed.git");
  await cloneBare(fixture.appClone, remote);
  const created = await routes.projects.POST(
    post("http://localhost/api/projects", { gitUrl: `file://${remote}`, name: "doomed" }),
  );
  const { project } = (await created.json()) as { project: { id: string; clonePath: string } };

  await cloneSettled(project.id);
  expect(existsSync(project.clonePath)).toBe(true);

  const markdown = await (
    await import("node:fs/promises")
  ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");
  await routes.rulesets.POST(
    post("http://localhost/api/rulesets/import", {
      name: "Doomed protocol",
      tier: "global",
      markdown,
    }),
  );
  await routes.reviews.POST(
    post("http://localhost/api/reviews", {
      projectId: project.id,
      fromBranch: "feature/rename-prefs",
      intoBranch: "main",
      model: "claude-fable-5[1m]",
    }),
  );

  const before = (await (await routes.system.GET()).json()) as {
    counts: { projects: number; reviews: number; rulesets: number };
  };
  expect(before.counts).toEqual({ projects: 1, reviews: 1, rulesets: 1 });

  const wiped = await routes.wipe.DELETE();
  expect(wiped.status).toBe(200);
  const body = (await wiped.json()) as {
    deleted: { projects: number; reviews: number; rulesets: number };
    kept: { exports: string };
  };
  expect(body.deleted).toEqual({ projects: 1, reviews: 1, rulesets: 1 });

  // Rows and disk both, which is the whole reason it walks the delete paths
  // rather than truncating tables: a raw delete leaves the clone behind.
  const after = (await (await routes.system.GET()).json()) as {
    counts: { projects: number; reviews: number; rulesets: number };
  };
  expect(after.counts).toEqual({ projects: 0, reviews: 0, rulesets: 0 });
  expect(existsSync(project.clonePath)).toBe(false);
  expect(existsSync(dirname(project.clonePath))).toBe(false);
  // Exports are kept: a report is the thing the review was for.
  expect(body.kept.exports.startsWith(dataDir)).toBe(true);
}, 240_000);
