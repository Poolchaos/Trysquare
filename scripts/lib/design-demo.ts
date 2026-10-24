/**
 * The design fixture reviewed end to end (WP-I step 6): built, added as a
 * project with its own checks on, reviewed through the job manager as the
 * app reviews, and each screenshot scored against the key. One function,
 * so the test that proves it on the fake engine and the demo that runs it
 * on a real model (WP-J) run the same thing.
 */

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { DESIGN_BATCH } from "@/lib/review/design";
import { dbPath, projectRepoDir } from "@/lib/paths";
import { importProtocol } from "@/lib/rulesets/import";
import type { Db } from "@/server/db/client";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { listCheckFindings } from "@/server/db/repositories/check-findings";
import { setProjectChecks } from "@/server/db/repositories/project-checks";
import { createProject, setClonePath, setCloneStatus } from "@/server/db/repositories/projects";
import { createReview } from "@/server/db/repositories/reviews";
import { cloneBare, diffText, mergeBase, resolveBranch } from "@/server/gitops/repo";
import type { ReviewEvent } from "@/server/jobs/bus";
import { JobManager } from "@/server/jobs/manager";
import { scoreDesign, type DesignManifest, type DesignScore } from "./design-score";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures");

/** What the fake's first grader says of each planted defect. */
const FAKE_SAYS = {
  overflow: { grade: "D", whatIsOff: "The order table runs off the right edge of the screen." },
  contrast: { grade: "C", whatIsOff: "The order line is light grey on white and hard to read." },
  clipped: { grade: "D", whatIsOff: "The button's label is cut off after its first line." },
} as const;

export interface DesignRun {
  db: Db;
  reviewId: string;
  outcome: string;
  manifest: DesignManifest;
  score: DesignScore;
}

export async function reviewDesignFixture(options: {
  dataDir: string;
  model: string;
  /** A @playwright/test install, which the fixture's e2e is handed. */
  playwright: string;
  fake: boolean;
  /**
   * Given the database before anything is reviewed: the CLI to review with,
   * the fake's for a fake run, or null to stop having sent nothing.
   */
  prepare: (db: Db) => Promise<{ claudePath?: string } | null>;
  onEvent?: (event: ReviewEvent) => void;
}): Promise<DesignRun | null> {
  const { dataDir } = options;
  const fixtureRoot = join(dataDir, "fixture");
  await mkdir(fixtureRoot, { recursive: true });
  const fixture = (await import(
    pathToFileURL(join(FIXTURES, "build-design-fixture.mjs")).href
  )) as {
    DESIGN_BRANCH: string;
    DESIGN_SCREENSHOT_DIR: string;
    DESIGN_STANDARD_PATH: string;
    buildDesignFixture: (root: string) => { dir: string; manifest: DesignManifest };
  };
  const built = fixture.buildDesignFixture(fixtureRoot);

  const db = createDb(dbPath(dataDir));
  runMigrations(db);
  const ready = await options.prepare(db);
  if (ready === null) {
    db.$client.close();
    return null;
  }
  const manager = new JobManager();
  manager.init({ db, dataDir, ...ready });

  const project = createProject(db, {
    name: "storefront",
    gitUrl: `file://${built.dir}`,
    defaultBranch: "main",
    clonePath: "",
  });
  const clonePath = projectRepoDir(dataDir, project.id);
  await cloneBare(built.dir, clonePath);
  setClonePath(db, project.id, clonePath);
  setCloneStatus(db, project.id, "cloning");
  setCloneStatus(db, project.id, "ready");
  setProjectChecks(db, project.id, {
    enabled: true,
    installCommand: null,
    testCommand: null,
    e2eCommand: `"${process.execPath}" e2e/shoot.mjs "${options.playwright}"`,
    screenshotDir: fixture.DESIGN_SCREENSHOT_DIR,
    designStandardPath: fixture.DESIGN_STANDARD_PATH,
  });

  const branch = fixture.DESIGN_BRANCH;
  const fromCommit = await resolveBranch(clonePath, branch);
  const base = await mergeBase(clonePath, "main", branch);
  const reviewId = createReview(db, {
    projectId: project.id,
    fromBranch: branch,
    fromCommit,
    intoBranch: "main",
    intoCommit: await resolveBranch(clonePath, "main"),
    mergeBaseCommit: base,
    model: options.model,
    profileId: "full-context",
    engineMode: "headless",
    intent: "Add the checkout, receipt, profile and confirmation screens.",
  }).id;

  const rules = importProtocol(readFileSync(join(FIXTURES, "example-protocol.md"), "utf8")).ruleset;
  if (options.fake) {
    await writeFakeAnswers({
      dataDir,
      clonePath,
      base,
      head: fromCommit,
      manifest: built.manifest,
      rules: rules.rules,
    });
  }

  if (options.onEvent) manager.subscribe(reviewId, options.onEvent);
  manager.start(reviewId, {
    ruleset: { imported: rules, name: "Example protocol", tier: "global" },
  });
  const outcome = await manager.settled(reviewId);

  return {
    db,
    reviewId,
    outcome: outcome?.kind ?? "failed",
    manifest: built.manifest,
    score: scoreDesign(listCheckFindings(db, reviewId), built.manifest.screens),
  };
}

/**
 * The fake's answers: the code stages clean, since the screens are the
 * point, then each screenshot graded by the key, the planted ones C or D
 * and agreed on by the second grader. Proves the plumbing, never a grade.
 */
async function writeFakeAnswers(input: {
  dataDir: string;
  clonePath: string;
  base: string;
  head: string;
  manifest: DesignManifest;
  rules: unknown;
}): Promise<void> {
  const helpers = (await import(
    pathToFileURL(join(REPO_ROOT, "tests", "helpers", "ideal-answers.ts")).href
  )) as {
    buildIdealStageOutputs: (input: unknown) => unknown;
    answerSequence: (outputs: unknown) => unknown[];
    writeAnswersDir: (dir: string, answers: readonly unknown[]) => string;
  };
  const reference = join(input.dataDir, "reference");
  const { addWorktree } = await import("@/server/gitops/worktree");
  await addWorktree(input.clonePath, join(reference, "storefront"), input.head);
  const files = parseUnifiedDiff(await diffText(input.clonePath, input.base, input.head));
  const code = helpers.answerSequence(
    helpers.buildIdealStageOutputs({
      files: files.map((file) => ({ repo: "primary", slug: "storefront", file })),
      manifest: { defects: [], cleanFiles: [] },
      worktreeRoot: reference,
      rules: input.rules,
    }),
  );

  const graded = (screens: DesignManifest["screens"]) => ({
    grades: screens.map((screen) => ({
      screenshot: screen.screenshot,
      opened: true,
      ...(screen.defect === null ? { grade: "A", whatIsOff: "" } : FAKE_SAYS[screen.defect]),
    })),
  });
  const batches = (screens: DesignManifest["screens"]) =>
    Array.from({ length: Math.ceil(screens.length / DESIGN_BATCH) }, (_, index) =>
      graded(screens.slice(index * DESIGN_BATCH, (index + 1) * DESIGN_BATCH)),
    );
  const planted = input.manifest.screens.filter((screen) => screen.defect !== null);

  // S1 to S4, S4b, then S5 (nothing proven, so no S5b), then S5c.
  const [s1, s2, s3, s4, s5, ...rest] = code;
  if (rest.length !== 0) throw new Error("The clean code answers proved something.");
  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = join(input.dataDir, "answers");
  process.env.FAKE_CLAUDE_COUNTER = join(input.dataDir, "calls.txt");
  helpers.writeAnswersDir(join(input.dataDir, "answers"), [
    s1,
    s2,
    s3,
    s4,
    ...batches(input.manifest.screens),
    s5,
    ...batches(planted),
  ]);
}
