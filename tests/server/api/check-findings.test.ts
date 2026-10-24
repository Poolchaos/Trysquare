/**
 * Deciding what a project's own checks found (WP-I, step 3b; D-197): as a
 * code finding is decided, and counted before a review completes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-check-findings-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

let made = 0;
/** A review waiting on a person, with one failing test found. */
async function aFailedTest(options: { waiting?: boolean } = {}) {
  const { db } = (await import("@/server/runtime")).runtime();
  const { createProject } = await import("@/server/db/repositories/projects");
  const { createReview, transitionReview } = await import("@/server/db/repositories/reviews");
  const { recordFailedCommand } = await import("@/server/db/repositories/check-findings");
  made += 1;
  const project = createProject(db, {
    name: `app-${made}`,
    gitUrl: `git@example.com:acme/app-${made}.git`,
    defaultBranch: "main",
    clonePath: join(dataDir, "projects", `app-${made}`, "repo.git"),
  });
  const reviewId = createReview(db, {
    projectId: project.id,
    fromBranch: "feature",
    fromCommit: "a".repeat(40),
    intoBranch: "main",
    intoCommit: "b".repeat(40),
    mergeBaseCommit: "b".repeat(40),
    model: "claude-opus-5-5",
    profileId: "full-context",
    engineMode: "headless",
  }).id;
  if (options.waiting !== false) {
    transitionReview(db, reviewId, "running");
    transitionReview(db, reviewId, "verifying");
    transitionReview(db, reviewId, "awaiting_confirmation");
  }
  const row = recordFailedCommand(db, reviewId, {
    step: "tests",
    command: "npm test",
    exitCode: 1,
    timedOut: false,
    logPath: join(dataDir, "tests.log"),
    tail: "1 failing",
  });
  return { db, reviewId, id: row.id };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function confirm(id: string) {
  const { POST } = await import("@/app/api/check-findings/[id]/confirm/route");
  return POST(post(), params(id));
}
async function dismiss(id: string, reason: string) {
  const { POST } = await import("@/app/api/check-findings/[id]/dismiss/route");
  return POST(post({ reason }), params(id));
}
async function complete(reviewId: string) {
  const { POST } = await import("@/app/api/reviews/[id]/complete/route");
  return POST(post(), params(reviewId));
}

describe("what a project's own checks found", () => {
  it("is confirmed by a person, and then is decided", async () => {
    const { id } = await aFailedTest();
    const response = await confirm(id);
    expect(response.status).toBe(200);
    expect((await response.json()).checkFinding).toMatchObject({ status: "confirmed" });
    // Final, as a code finding's decision is.
    expect((await confirm(id)).status).toBe(409);
  });

  it("is dismissed only with a reason, which is kept", async () => {
    const { id } = await aFailedTest();
    expect((await dismiss(id, "   ")).status).toBe(400);
    const response = await dismiss(id, "A known flaky test, tracked elsewhere.");
    expect(response.status).toBe(200);
    expect((await response.json()).checkFinding).toMatchObject({
      status: "dismissed",
      dismissReason: "A known flaky test, tracked elsewhere.",
      dismissedFrom: "verified",
    });
  });

  it("is decided only while its review waits on a person", async () => {
    const { id } = await aFailedTest({ waiting: false });
    const response = await confirm(id);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("decided only while it awaits confirmation");
  });

  it("answers an id that names nothing with a 404 naming it", async () => {
    const response = await confirm("01NOTHING0000000000000000");
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("CheckFindingNotFoundError");
  });

  it("keeps a review from completing until it is decided", async () => {
    const { reviewId, id } = await aFailedTest();
    const refused = await complete(reviewId);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("1 finding(s) still need a decision");
    await confirm(id);
    expect((await complete(reviewId)).status).toBe(200);
  });
});

describe("a design finding's screenshot (WP-I step 4)", () => {
  async function aDesignFinding(screenshotPath: (reviewDir: string) => string) {
    const { db, reviewId } = await aFailedTest();
    const { recordDesignCandidate } = await import("@/server/db/repositories/check-findings");
    const { checksDir } = await import("@/lib/paths");
    const path = screenshotPath(checksDir(dataDir, reviewId));
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "PNGBYTES");
    return recordDesignCandidate(db, reviewId, {
      name: "home.png",
      screenshotPath: path,
      grade: "D",
      whatIsOff: "Clipped.",
    });
  }
  async function shot(id: string) {
    const { GET } = await import("@/app/api/check-findings/[id]/screenshot/route");
    return GET(new Request("http://localhost/x"), params(id));
  }

  it("is served from its review's own folder", async () => {
    const row = await aDesignFinding((checks) => join(checks, "screenshots", "home.png"));
    const response = await shot(row.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("PNGBYTES");
  });

  it("is not served from anywhere else, whatever the row says", async () => {
    const row = await aDesignFinding((checks) => join(checks, "..", "elsewhere.png"));
    const response = await shot(row.id);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("This screenshot is not in its review's folder.");
  });

  it("says when a finding has none", async () => {
    const { id } = await aFailedTest();
    expect((await shot(id)).status).toBe(404);
  });
});
