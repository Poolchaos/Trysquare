/**
 * The design fixture reviewed end to end on the fake engine (WP-I step 6):
 * its own e2e photographs its screens in the review's throwaway copy, every
 * one is graded, the planted ones are graded again, and the score against
 * the key comes out whole. The fake's grades follow the key, so this proves
 * the plumbing a real run (WP-J) is scored by, not any model's eye.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listForReview } from "@/server/db/repositories/stage-executions";
import { readRunNotes, requireReview } from "@/server/db/repositories/reviews";
import { reviewDesignFixture, type DesignRun } from "../../scripts/lib/design-demo";

const FAKE = ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_DIR", "FAKE_CLAUDE_COUNTER"] as const;

let dataDir: string;
let run: DesignRun | null;
const before = Object.fromEntries(FAKE.map((name) => [name, process.env[name]]));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-design-demo-"));
  run = await reviewDesignFixture({
    dataDir,
    model: "claude-opus-5-5",
    prepare: async () => ({
      claudePath: join(import.meta.dirname, "..", "fixtures", "fake-claude.mjs"),
    }),
    playwright: dirname(createRequire(import.meta.url).resolve("@playwright/test/package.json")),
    fake: true,
  });
}, 180_000);

afterAll(() => {
  run?.db.$client.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("the design fixture, reviewed on the fake engine", () => {
  it("leaves the environment as it found it", () => {
    // The fake's answers are found through the environment, set for the
    // review alone: left set, a later run in this process read them
    // (review round 9).
    expect(Object.fromEntries(FAKE.map((name) => [name, process.env[name]]))).toEqual(before);
  });

  it("reaches a person, every planted screen found and no clean one failed", () => {
    expect(run!.outcome).toBe("completed");
    const planted = run!.manifest.screens.filter((screen) => screen.defect !== null);
    expect(run!.score.found.map((hit) => hit.screenshot)).toEqual(
      planted.map((screen) => screen.screenshot),
    );
    expect(run!.score.missed).toEqual([]);
    expect(run!.score.falsePositives).toEqual([]);
    expect(run!.score.cleanOpen).toEqual([]);
  });

  it("grades all twelve screens in two requests, and the five planted again in one", () => {
    const stages = listForReview(run!.db, run!.reviewId).map((row) => row.stage);
    expect(stages.filter((stage) => stage === "s4b_design_grading")).toHaveLength(2);
    expect(stages.filter((stage) => stage === "s5c_design_second")).toHaveLength(1);
    expect(
      readRunNotes(requireReview(run!.db, run!.reviewId)).map((note) => note.message),
    ).toContain("The e2e saved 12 screenshot(s) to grade.");
  });
});
