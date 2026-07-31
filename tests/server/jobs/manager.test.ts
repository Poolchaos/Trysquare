/**
 * The scheduler, driven end to end.
 *
 * A local tool with one account still needs a scheduler, and the parts worth
 * proving are the ones a user would notice going wrong: two reviews started at
 * once must not both run, cancel must actually stop something, and what the
 * browser is told must never contradict what the database says.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import { createProject } from "@/server/db/repositories/projects";
import { createReview, requireReview, transitionReview } from "@/server/db/repositories/reviews";
import { models } from "@/server/db/schema";
import { JobManager } from "@/server/jobs/manager";
import type { ReviewEvent } from "@/server/jobs/bus";
import {
  answerSequence,
  buildIdealStageOutputs,
  writeAnswersDir,
} from "../../helpers/ideal-answers";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";
import { makeTestDb, type TestDb } from "../db/helpers";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const PROTOCOL = importProtocol(
  readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
).ruleset;

const RULESET = { imported: PROTOCOL, name: "Example protocol", tier: "global" as const };

let fixture: SeededFixture;
let ctx: TestDb;
let db: Db;
let dataDir: string;
let manager: JobManager;
let projectId: string;

beforeAll(async () => {
  fixture = await buildFixture();
}, 180_000);

afterAll(() => fixture?.cleanup());

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-manager-"));
  manager = new JobManager();
  manager.init({ db, dataDir, claudePath: FAKE_CLI });

  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = join(dataDir, "answers");
  process.env.FAKE_CLAUDE_COUNTER = join(dataDir, "calls.txt");
  writeIdealAnswers();

  projectId = createProject(db, {
    name: "app",
    gitUrl: "git@example.com:acme/app.git",
    defaultBranch: "main",
    clonePath: fixture.appClone,
  }).id;
});

afterEach(async () => {
  await manager.drain();
  ctx.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_DIR;
  delete process.env.FAKE_CLAUDE_COUNTER;
  delete process.env.FAKE_CLAUDE_FAIL_AT;
});

function writeIdealAnswers(): void {
  const outputs = buildIdealStageOutputs({
    files: fixture.appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    manifest: {
      ...fixture.manifest,
      defects: fixture.manifest.defects.filter((defect) => defect.kind !== "cross-repo"),
    },
    worktreeRoot: fixture.referenceRoot,
    rules: PROTOCOL.rules,
  });
  // Twice over: the fake hands out answers in one sequence per directory, and
  // a test that runs two reviews needs enough for both.
  const sequence = answerSequence(outputs);
  writeAnswersDir(join(dataDir, "answers"), [...sequence, ...sequence]);
}

/** Reviews share one project, because a project is one clone of one remote. */
function seedReview(): string {
  return createReview(db, {
    projectId,
    fromBranch: "feature/rename-prefs",
    fromCommit: fixture.appHead,
    intoBranch: "main",
    intoCommit: fixture.appBase,
    mergeBaseCommit: fixture.appBase,
    model: "claude-fable-5[1m]",
    profileId: "full-context",
    engineMode: "headless",
  }).id;
}

const start = (reviewId: string) => manager.start(reviewId, { ruleset: RULESET });

describe("deciding what runs now", () => {
  it("runs the first review and makes the second wait", async () => {
    // Two at once would race for one account's rate limit and make both
    // slower, so the default is one.
    const first = seedReview();
    const second = seedReview();

    expect(start(first)).toBe("running");
    expect(start(second)).toBe("queued");
    expect(manager.queueDepth()).toBe(1);
    expect(requireReview(db, second).status).toBe("draft");

    await manager.settled(first);
    // The queued review starts on its own once the slot frees.
    await manager.settled(second);

    expect(requireReview(db, first).status).toBe("awaiting_confirmation");
    expect(requireReview(db, second).status).toBe("awaiting_confirmation");
  }, 240_000);

  it("does not start the same review twice", async () => {
    const reviewId = seedReview();
    expect(start(reviewId)).toBe("running");
    expect(start(reviewId)).toBe("already-running");
    await manager.settled(reviewId);
  }, 120_000);

  it("refuses an id that is not a review at all", () => {
    // Fails here rather than inside a promise nobody is awaiting.
    expect(() => start("not-a-review")).toThrow();
  });
});

describe("stopping a review", () => {
  it("cancels one that is running", async () => {
    const reviewId = seedReview();
    start(reviewId);
    expect(manager.cancel(reviewId)).toBe(true);

    const outcome = await manager.settled(reviewId);
    expect(outcome?.kind).toBe("cancelled");
    expect(requireReview(db, reviewId).status).toBe("cancelled");
  }, 120_000);

  it("takes a queued review out of the line without starting it", async () => {
    // Nothing was spent on it and no status was ever changed, so there is
    // nothing to unwind.
    const first = seedReview();
    const second = seedReview();
    start(first);
    start(second);

    expect(manager.cancel(second)).toBe(true);
    expect(manager.queueDepth()).toBe(0);
    expect(requireReview(db, second).status).toBe("draft");

    await manager.settled(first);
    expect(requireReview(db, second).status).toBe("draft");
  }, 240_000);

  it("says so when there is nothing to cancel", () => {
    expect(manager.cancel(seedReview())).toBe(false);
  });
});

describe("what a watcher is told", () => {
  it("announces nothing the database does not already say", async () => {
    // The ordering the whole design rests on. If an event arrived before the
    // row it describes, the UI would show a stage as started while the
    // database still said otherwise, and a page reload would undo it.
    const reviewId = seedReview();
    const disagreements: string[] = [];

    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "status") {
        const actual = requireReview(db, reviewId).status;
        if (actual !== event.status) disagreements.push(`${event.status} vs ${actual}`);
      }
      if (event.kind === "stage" && event.phase === "started") {
        const stages = manager.snapshot(reviewId).stages;
        // A started stage may have no row yet, but the review must already be
        // past draft, which is what the listener could act on.
        if (requireReview(db, reviewId).status === "draft") disagreements.push("still draft");
        void stages;
      }
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(disagreements).toEqual([]);
  }, 120_000);

  it("reports the statuses in the order they happened, ending in done", async () => {
    const reviewId = seedReview();
    const seen: string[] = [];
    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "status") seen.push(event.status);
      if (event.kind === "done") seen.push(`done:${event.outcome}`);
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(seen).toEqual(["running", "verifying", "awaiting_confirmation", "done:completed"]);
  }, 120_000);

  it("names every stage as it starts", async () => {
    const reviewId = seedReview();
    const stages: string[] = [];
    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "stage" && event.phase === "started") stages.push(event.stage);
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(stages).toEqual([
      "s1_risk",
      "s2_comprehension",
      "s3_adversarial",
      "s4_deletions",
      "s5_verification",
    ]);
  }, 120_000);

  it("passes on the run notes the review recorded", async () => {
    const reviewId = seedReview();
    const notes: string[] = [];
    manager.subscribe(reviewId, (event: ReviewEvent) => {
      if (event.kind === "note") notes.push(event.note.message);
    });

    start(reviewId);
    await manager.settled(reviewId);

    expect(notes.some((note) => note.includes("candidate(s)"))).toBe(true);
  }, 120_000);

  it("tells a watcher when a review could not even start", async () => {
    // No ruleset to freeze. prepareAndRun throws rather than returning an
    // outcome, and a watcher still has to learn that it is over.
    const reviewId = seedReview();
    const seen: ReviewEvent[] = [];
    manager.subscribe(reviewId, (event) => seen.push(event));

    manager.start(reviewId);
    await manager.settled(reviewId);

    const done = seen.find((event) => event.kind === "done");
    expect(done).toMatchObject({ kind: "done", outcome: "failed" });
    expect(requireReview(db, reviewId).status).toBe("draft");
  }, 120_000);

  it("stops telling a listener that unsubscribed", async () => {
    const reviewId = seedReview();
    const seen: ReviewEvent[] = [];
    const off = manager.subscribe(reviewId, (event) => seen.push(event));
    off();

    start(reviewId);
    await manager.settled(reviewId);

    expect(seen).toEqual([]);
    expect(manager.listenerCount(reviewId)).toBe(0);
  }, 120_000);
});

describe("the picture a page loads with", () => {
  it("carries the review, its stages, its usage and its findings", async () => {
    const reviewId = seedReview();
    start(reviewId);
    await manager.settled(reviewId);

    const snapshot = manager.snapshot(reviewId);
    expect(snapshot.review.id).toBe(reviewId);
    expect(snapshot.stages).toHaveLength(5);
    expect(snapshot.usage.inputTokens).toBe(500);
    expect(snapshot.findings.verified).toBeGreaterThan(0);
    expect(snapshot.running).toBe(false);
  }, 120_000);

  it("says a review is running while it is", async () => {
    const reviewId = seedReview();
    start(reviewId);
    expect(manager.snapshot(reviewId).running).toBe(true);
    await manager.settled(reviewId);
    expect(manager.snapshot(reviewId).running).toBe(false);
  }, 120_000);
});

describe("coming back from a restart", () => {
  it("marks a review the last process left running as interrupted", async () => {
    // Nothing survived the restart that could be running it, and until this
    // happens the review can neither be started nor cancelled.
    const reviewId = seedReview();
    transitionReview(db, reviewId, "running");

    const fresh = new JobManager();
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });

    expect(requireReview(db, reviewId).status).toBe("interrupted");
  });

  it("registers the models the app knows how to offer", () => {
    const fresh = new JobManager();
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });
    // Registering is conflict-free, so a second start is not a second set.
    fresh.init({ db, dataDir, claudePath: FAKE_CLI });

    const rows = db.select().from(models).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("resumes a review that was interrupted, keeping what it had", async () => {
    const reviewId = seedReview();
    process.env.FAKE_CLAUDE_FAIL_AT = "3";
    start(reviewId);
    await manager.settled(reviewId);
    expect(requireReview(db, reviewId).status).toBe("paused_limit");

    delete process.env.FAKE_CLAUDE_FAIL_AT;
    writeFileSync(join(dataDir, "calls.txt"), "2");
    const replayed: string[] = [];
    manager.subscribe(reviewId, (event) => {
      if (event.kind === "stage" && event.phase === "replayed") replayed.push(event.stage);
    });

    manager.resume(reviewId, { ruleset: RULESET });
    await manager.settled(reviewId);

    expect(replayed).toEqual(["s1_risk", "s2_comprehension"]);
    expect(requireReview(db, reviewId).status).toBe("awaiting_confirmation");
  }, 240_000);
});

describe("the run directory", () => {
  it("keeps the evidence a completed review produced", async () => {
    const reviewId = seedReview();
    start(reviewId);
    await manager.settled(reviewId);

    expect(existsSync(join(dataDir, "runs", reviewId, "bundle", "inventory.json"))).toBe(true);
  }, 120_000);
});
