/**
 * What a project's own checks found, as kept (WP-I, step 3; D-197).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteCheckFindingsForReview,
  listCheckFindings,
  recordFailedCommand,
} from "@/server/db/repositories/check-findings";
import { createProject } from "@/server/db/repositories/projects";
import { createReview } from "@/server/db/repositories/reviews";
import { makeTestDb, type TestDb } from "./helpers";

let ctx: TestDb;
let reviewId: string;

beforeEach(() => {
  ctx = makeTestDb();
  const project = createProject(ctx.db, {
    name: "app",
    gitUrl: "git@example.com:acme/app.git",
    defaultBranch: "main",
    clonePath: "/clones/app.git",
  });
  reviewId = createReview(ctx.db, {
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
});
afterEach(() => ctx.cleanup());

const failed = {
  step: "e2e" as const,
  command: "npm run e2e",
  exitCode: null,
  timedOut: true,
  logPath: "/runs/x/checks/logs/e2e.log",
  tail: "waiting for the server...",
};

describe("a failed command, as a finding", () => {
  it("says a time limit apart from a failure", () => {
    const row = recordFailedCommand(ctx.db, reviewId, failed);
    expect(row).toMatchObject({
      kind: "test",
      issue: "The e2e tests did not finish within their time limit on this branch.",
      verificationNote: "Stopped at its time limit, by the app.",
      status: "verified",
    });
    const install = recordFailedCommand(ctx.db, reviewId, {
      ...failed,
      step: "install",
      exitCode: 1,
      timedOut: false,
    });
    expect(install.issue).toBe("The install fails on this branch.");
  });

  it("is listed by its review, and goes when cleared", () => {
    recordFailedCommand(ctx.db, reviewId, failed);
    recordFailedCommand(ctx.db, reviewId, { ...failed, step: "tests" });
    expect(listCheckFindings(ctx.db, reviewId).map((row) => row.step)).toEqual(["e2e", "tests"]);
    deleteCheckFindingsForReview(ctx.db, reviewId);
    expect(listCheckFindings(ctx.db, reviewId)).toEqual([]);
  });
});
