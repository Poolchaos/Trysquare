/**
 * What happens to a review after it stops, and the settings that govern runs.
 *
 * Merged detection is tested against a branch that genuinely merged, by doing
 * the merge in the fixture repository, because a test that stubbed the git
 * answer would prove only that a boolean was passed along.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useSignedInFake } from "../../helpers/signed-in-fake";
import { runDir } from "@/lib/paths";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";

let fixture: SeededFixture;
let dataDir: string;
let projectId: string;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  reviews: typeof import("@/app/api/reviews/route");
  review: typeof import("@/app/api/reviews/[id]/route");
  settings: typeof import("@/app/api/settings/route");
  fetchNow: typeof import("@/app/api/projects/[id]/fetch/route");
};

const post = (body?: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body ?? {}) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// Creating a review asks the CLI whether it can run one (MVP 6.2).
let restoreCli: () => void;

beforeAll(async () => {
  restoreCli = useSignedInFake();
  fixture = await buildFixture();
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-lifecycle-"));
  process.env.TRYSQUARE_DATA = dataDir;

  routes = {
    projects: await import("@/app/api/projects/route"),
    reviews: await import("@/app/api/reviews/route"),
    review: await import("@/app/api/reviews/[id]/route"),
    settings: await import("@/app/api/settings/route"),
    fetchNow: await import("@/app/api/projects/[id]/fetch/route"),
  };

  const created = await routes.projects.POST(
    post({ gitUrl: `file://${fixture.appClone}`, name: "app" }),
  );
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const listed = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; cloneStatus: string }[];
    };
    if (listed.projects.find((row) => row.id === projectId)?.cloneStatus === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}, 180_000);

afterAll(async () => {
  restoreCli();
  fixture?.cleanup();
  // The runtime holds the database open, and Windows will not delete it.
  (await import("@/server/runtime")).closeRuntime();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

// Every review here is on Fable, whose findings Opus 5.5 proves again (WP-E).
beforeAll(async () => {
  const { probeSecondVerifier } = await import("../db/helpers");
  probeSecondVerifier((await import("@/server/runtime")).runtime().db);
});

async function makeReview(fromBranch = "feature/rename-prefs"): Promise<string> {
  const created = await routes.reviews.POST(
    post({
      projectId,
      fromBranch,
      intoBranch: "main",
      model: "claude-fable-5[1m]",
    }),
  );
  return ((await created.json()) as { review: { id: string } }).review.id;
}

describe("noticing that a branch has merged", () => {
  it("says nothing while the branch is still outstanding", async () => {
    const reviewId = await makeReview();
    const body = (await (
      await routes.review.GET(new Request("http://localhost"), params(reviewId))
    ).json()) as { review: { mergedDetectedAt: string | null } };
    expect(body.review.mergedDetectedAt).toBeNull();
  }, 120_000);

  it("records the merge once it has actually happened", async () => {
    // Merged for real in the fixture, so this exercises the same ancestry
    // question the app asks rather than a stubbed answer.
    const reviewId = await makeReview();
    const source = join(fixture.root, "seeded-repo");
    execFileSync("git", ["checkout", "--quiet", "main"], { cwd: source });
    execFileSync("git", ["merge", "--no-edit", "--quiet", "feature/rename-prefs"], {
      cwd: source,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    });

    // The fixture's bare clone stands in for the remote, so it has to learn
    // about the merge before the app's own clone can.
    execFileSync("git", ["fetch", "--quiet", "origin"], { cwd: fixture.appClone });

    // The app reads its own clone, which knows nothing of the merge until it
    // fetches. Detection uses the refs it has rather than reaching for the
    // network on every page open, so the merge is noticed at the next fetch,
    // which is what a person does when they open the branch list.
    const stillOutstanding = (await (
      await routes.review.GET(new Request("http://localhost"), params(reviewId))
    ).json()) as { review: { mergedDetectedAt: string | null } };
    expect(stillOutstanding.review.mergedDetectedAt).toBeNull();

    await routes.fetchNow.POST(new Request("http://localhost"), params(projectId));

    const body = (await (
      await routes.review.GET(new Request("http://localhost"), params(reviewId))
    ).json()) as { review: { mergedDetectedAt: string | null } };
    expect(body.review.mergedDetectedAt).not.toBeNull();
  }, 120_000);

  it("does not delete anything on its own", async () => {
    // A merged review is the record of how something got merged. Deciding
    // that history is disposable is not the app's call.
    const listed = (await (await routes.reviews.GET()).json()) as {
      reviews: { mergedDetectedAt: string | null }[];
    };
    expect(listed.reviews.length).toBeGreaterThan(0);
    expect(listed.reviews.some((review) => review.mergedDetectedAt !== null)).toBe(true);
  }, 120_000);
});

describe("deleting a review", () => {
  it("removes the row and the run directory", async () => {
    // Not the feature branch, which the merge test above merged into main:
    // a review of it is now a review of no change, which is refused (D-145).
    // The fixed variant is that branch and one commit more.
    const reviewId = await makeReview("rename-prefs-migrated");
    const response = await routes.review.DELETE(new Request("http://localhost"), params(reviewId));
    expect(response.status).toBe(200);

    expect(existsSync(runDir(dataDir, reviewId))).toBe(false);
    const listed = (await (await routes.reviews.GET()).json()) as { reviews: { id: string }[] };
    expect(listed.reviews.some((review) => review.id === reviewId)).toBe(false);
  }, 120_000);
});

describe("the settings that govern a run", () => {
  it("reports the defaults before anyone has set anything", async () => {
    const body = (await (await routes.settings.GET()).json()) as {
      settings: Record<string, number>;
    };
    expect(body.settings.maxConcurrentReviews).toBe(1);
    expect(body.settings.stageTimeoutMinutes).toBe(20);
    expect(body.settings.stageMaxBudgetUsd).toBe(15);
  });

  it("stores a change and reads it back", async () => {
    const response = await routes.settings.PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ stageMaxBudgetUsd: 5, stageTimeoutMinutes: 30 }),
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { settings: Record<string, number> };
    expect(body.settings.stageMaxBudgetUsd).toBe(5);
    expect(body.settings.stageTimeoutMinutes).toBe(30);
  });

  it("starts waiting reviews when the limit is raised, and only then (4.23)", async () => {
    // The manager's own test shows a waiting review starting; this is the
    // route asking it to, where the limit is changed.
    const { jobManager } = await import("@/server/jobs/manager");
    const startQueued = vi.spyOn(jobManager(), "startQueued");
    try {
      const raised = await routes.settings.PUT(
        new Request("http://localhost/x", {
          method: "PUT",
          body: JSON.stringify({ maxConcurrentReviews: 2 }),
        }),
      );
      expect(raised.status).toBe(200);
      expect(startQueued).toHaveBeenCalledTimes(1);

      await routes.settings.PUT(
        new Request("http://localhost/x", {
          method: "PUT",
          body: JSON.stringify({ stageTimeoutMinutes: 30 }),
        }),
      );
      expect(startQueued).toHaveBeenCalledTimes(1);
    } finally {
      startQueued.mockRestore();
    }
  });

  it("refuses a key that is not a setting, rather than storing a typo", async () => {
    // A settings table that accepts anything is where typos live silently.
    const response = await routes.settings.PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ stageTimeoutMinuts: 30 }),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("UnknownSetting");
  });

  it("refuses a value the setting cannot mean", async () => {
    const response = await routes.settings.PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ stageTimeoutMinutes: -5 }),
      }),
    );
    expect(response.status).toBe(400);

    // The rejected value was not written on the way to being rejected.
    const after = (await (await routes.settings.GET()).json()) as {
      settings: Record<string, number>;
    };
    expect(after.settings.stageTimeoutMinutes).toBe(30);
  });

  it("writes none of a change when any part of it is refused (D-119 review)", async () => {
    // Keys were checked and written one at a time, so the ones before a bad
    // value were stored by a request that answered 400.
    const response = await routes.settings.PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        body: JSON.stringify({ stageMaxBudgetUsd: 9, stageTimeoutMinutes: -5 }),
      }),
    );
    expect(response.status).toBe(400);

    const after = (await (await routes.settings.GET()).json()) as {
      settings: Record<string, number>;
    };
    expect(after.settings.stageMaxBudgetUsd).toBe(5);
  });
});
