/**
 * The confirmation loop, walked through the API the way the screen walks it.
 *
 * This is the app's founding requirement: nothing is reported until a person
 * has said so. The rules are enforced on the server, so these tests call the
 * server, and a review is run end to end first because a confirmation queue
 * with hand-written findings would prove nothing about the real one.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleDir, worktreeRootDir } from "@/lib/paths";
import {
  answerSequence,
  buildIdealStageOutputs,
  writeAnswersDir,
} from "../../helpers/ideal-answers";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";

let fixture: SeededFixture;
let dataDir: string;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  reviews: typeof import("@/app/api/reviews/route");
  review: typeof import("@/app/api/reviews/[id]/route");
  start: typeof import("@/app/api/reviews/[id]/start/route");
  complete: typeof import("@/app/api/reviews/[id]/complete/route");
  fileContext: typeof import("@/app/api/reviews/[id]/context/route");
  confirm: typeof import("@/app/api/findings/[id]/confirm/route");
  dismiss: typeof import("@/app/api/findings/[id]/dismiss/route");
  rulesets: typeof import("@/app/api/rulesets/import/route");
  report: typeof import("@/app/api/reviews/[id]/report/route");
  exportReport: typeof import("@/app/api/reviews/[id]/export/route");
};

let reviewId: string;

const post = (body?: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body ?? {}) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

interface Finding {
  id: string;
  filePath: string;
  lineStart: number;
  status: string;
  dismissReason: string | null;
}

async function snapshot(): Promise<{ review: { status: string }; findings: Finding[] }> {
  const response = await routes.review.GET(new Request("http://localhost"), params(reviewId));
  return (await response.json()) as { review: { status: string }; findings: Finding[] };
}

beforeAll(async () => {
  fixture = await buildFixture();
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-confirm-"));
  process.env.TRYSQUARE_DATA = dataDir;
  // The fake, so this suite spends nothing. Resolved from this file rather
  // than the fixture's temp directory.
  process.env.TRYSQUARE_CLAUDE_PATH = fileURLToPath(
    new URL("../../fixtures/fake-claude.mjs", import.meta.url),
  );
  process.env.FAKE_CLAUDE_SCENARIO = "script";
  process.env.FAKE_CLAUDE_DIR = join(dataDir, "answers");
  process.env.FAKE_CLAUDE_COUNTER = join(dataDir, "calls.txt");

  routes = {
    projects: await import("@/app/api/projects/route"),
    reviews: await import("@/app/api/reviews/route"),
    review: await import("@/app/api/reviews/[id]/route"),
    start: await import("@/app/api/reviews/[id]/start/route"),
    complete: await import("@/app/api/reviews/[id]/complete/route"),
    fileContext: await import("@/app/api/reviews/[id]/context/route"),
    confirm: await import("@/app/api/findings/[id]/confirm/route"),
    dismiss: await import("@/app/api/findings/[id]/dismiss/route"),
    rulesets: await import("@/app/api/rulesets/import/route"),
    report: await import("@/app/api/reviews/[id]/report/route"),
    exportReport: await import("@/app/api/reviews/[id]/export/route"),
  };

  // A project, its rules, and a review of the seeded branch pair.
  const createdProject = await routes.projects.POST(
    post({ gitUrl: `file://${fixture.appClone}`, name: "app" }),
  );
  const { project } = (await createdProject.json()) as { project: { id: string } };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const listed = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; cloneStatus: string }[];
    };
    if (listed.projects.find((row) => row.id === project.id)?.cloneStatus === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const protocol = readFileSync(
    new URL("../../fixtures/example-protocol.md", import.meta.url),
    "utf8",
  );
  const importedRuleset = await routes.rulesets.POST(
    post({ name: "Example protocol", tier: "global", markdown: protocol }),
  );
  const { rulesetId } = (await importedRuleset.json()) as { rulesetId: string };

  const { ruleset } = await import("@/lib/rulesets/import").then((module) => ({
    ruleset: module.importProtocol(protocol).ruleset,
  }));
  writeAnswersDir(
    join(dataDir, "answers"),
    answerSequence(
      buildIdealStageOutputs({
        files: fixture.appFiles.map((file) => ({ repo: "primary" as const, slug: "app", file })),
        manifest: {
          ...fixture.manifest,
          defects: fixture.manifest.defects.filter((defect) => defect.kind !== "cross-repo"),
        },
        worktreeRoot: fixture.referenceRoot,
        rules: ruleset.rules,
      }),
    ),
  );

  const createdReview = await routes.reviews.POST(
    post({
      projectId: project.id,
      fromBranch: "feature/rename-prefs",
      intoBranch: "main",
      model: "claude-fable-5[1m]",
    }),
  );
  reviewId = ((await createdReview.json()) as { review: { id: string } }).review.id;

  await routes.start.POST(post({ rulesetId }), params(reviewId));
  const { jobManager } = await import("@/server/jobs/manager");
  await jobManager().settled(reviewId);
}, 240_000);

afterAll(() => {
  fixture?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
  delete process.env.TRYSQUARE_CLAUDE_PATH;
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_DIR;
  delete process.env.FAKE_CLAUDE_COUNTER;
});

describe("a review waiting on a person", () => {
  it("stops at awaiting confirmation with findings to decide", async () => {
    const state = await snapshot();
    expect(state.review.status).toBe("awaiting_confirmation");
    expect(
      state.findings.filter((finding) => finding.status === "verified").length,
    ).toBeGreaterThan(0);
  }, 120_000);

  it("refuses to complete while anything is undecided, and says how many", async () => {
    // Enforced on the server, not by hiding a button: a script calling the
    // API directly meets the same wall the screen does.
    const response = await routes.complete.POST(post(), params(reviewId));
    expect(response.status).toBe(409);

    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("UndecidedFindings");
    expect(body.error).toMatch(/\d+ finding\(s\) still need a decision/);
  }, 120_000);
});

describe("reading the code a finding is about", () => {
  it("returns the lines around the one that was cited", async () => {
    const [finding] = (await snapshot()).findings;
    const response = await routes.fileContext.GET(
      new Request(
        `http://localhost/x?path=${encodeURIComponent(finding!.filePath)}&line=${finding!.lineStart}`,
      ),
      params(reviewId),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      lines: { number: number; text: string }[];
      start: number;
    };
    expect(body.lines.length).toBeGreaterThan(0);
    expect(body.lines.some((line) => line.number === finding!.lineStart)).toBe(true);
  }, 120_000);

  it("refuses a file this review never raised a finding in", async () => {
    // Otherwise the endpoint is a way to read any file on the machine.
    //
    // The path has to be one that genuinely exists in the checkout. An absent
    // file would 404 from the failed read whether the guard were there or not,
    // and this test would pass while proving nothing: format.ts is a fixture
    // file the reviewer deliberately finds nothing in.
    const clean = `app/${fixture.manifest.cleanFiles[0]}`;
    expect(existsSync(join(worktreeRootDir(dataDir, reviewId), clean))).toBe(true);
    expect((await snapshot()).findings.some((finding) => finding.filePath === clean)).toBe(false);

    const response = await routes.fileContext.GET(
      new Request(`http://localhost/x?path=${encodeURIComponent(clean)}&line=1`),
      params(reviewId),
    );
    expect(response.status).toBe(404);
  }, 120_000);
});

describe("deciding, then closing the review", () => {
  it("takes a confirmation without a reason and a dismissal with one", async () => {
    const findings = (await snapshot()).findings.filter(
      (finding) => finding.status === "verified" || finding.status === "open_question",
    );
    expect(findings.length).toBeGreaterThan(1);

    const refused = await routes.dismiss.POST(post({ reason: "   " }), params(findings[0]!.id));
    expect(refused.status).toBe(400);

    const dismissed = await routes.dismiss.POST(
      post({ reason: "Deliberate: the wrapper already guards this." }),
      params(findings[0]!.id),
    );
    expect(dismissed.status).toBe(200);

    for (const finding of findings.slice(1)) {
      const confirmed = await routes.confirm.POST(post(), params(finding.id));
      expect(confirmed.status).toBe(200);
    }

    const after = await snapshot();
    expect(after.findings.filter((f) => f.status === "confirmed").length).toBe(findings.length - 1);
    const dismissedRow = after.findings.find((f) => f.id === findings[0]!.id);
    expect(dismissedRow?.status).toBe("dismissed");
    expect(dismissedRow?.dismissReason).toContain("Deliberate");
  }, 120_000);

  it("completes once every finding is decided, and releases the checkout", async () => {
    // The confirmation screen was the last thing that needed the worktree.
    // The bundle and the logs stay: they are the evidence for the report.
    expect(existsSync(worktreeRootDir(dataDir, reviewId))).toBe(true);

    const response = await routes.complete.POST(post(), params(reviewId));
    expect(response.status).toBe(200);

    expect((await snapshot()).review.status).toBe("complete");
    expect(existsSync(worktreeRootDir(dataDir, reviewId))).toBe(false);
    expect(existsSync(join(bundleDir(dataDir, reviewId), "inventory.json"))).toBe(true);
  }, 120_000);

  it("has nothing left to complete once it is complete", async () => {
    const response = await routes.complete.POST(post(), params(reviewId));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("NotAwaitingConfirmation");
  }, 120_000);

  it("stops serving file context once the checkout is gone", async () => {
    const response = await routes.fileContext.GET(
      new Request("http://localhost/x?path=app/src/orders/save.ts&line=4"),
      params(reviewId),
    );
    expect(response.status).toBe(404);
  }, 120_000);
});

describe("the report a completed review produces", () => {
  it("names what was found, what was examined, and what was dismissed", async () => {
    // Built from a review that actually ran, so the counts are the pipeline's
    // own rather than numbers a fixture asserted into place.
    const response = await routes.report.GET(new Request("http://localhost"), params(reviewId));
    expect(response.status).toBe(200);

    const { markdown } = (await response.json()) as { markdown: string };
    expect(markdown).toContain("# Review: app feature/rename-prefs into main");
    expect(markdown).toContain("confirmed finding(s)");
    expect(markdown).toContain("## What was examined");
    expect(markdown).toContain("hunk(s) were read");
    expect(markdown).toContain("## Dismissed");
    expect(markdown).toContain("Deliberate: the wrapper already guards this.");
    expect(markdown).toContain("Ruleset: Example protocol version 1");
    expect(markdown).not.toContain(String.fromCharCode(8212));
  }, 120_000);

  it("writes an export that outlives the review's working files", async () => {
    // Deleting a review removes its worktrees, bundle and logs. The report is
    // the thing the review was for, so it lives outside all of that.
    const response = await routes.exportReport.POST(
      new Request("http://localhost", { method: "POST" }),
      params(reviewId),
    );
    expect(response.status).toBe(200);

    const { path } = (await response.json()) as { path: string };
    expect(path).toContain("exports");
    expect(path).toMatch(/app--feature-rename-prefs--into--main--\d{4}-\d{2}-\d{2}\.md$/);
    expect(existsSync(path)).toBe(true);
    expect(path.startsWith(join(dataDir, "runs"))).toBe(false);

    const written = readFileSync(path, "utf8");
    expect(written).toContain("# Review: app");
  }, 120_000);
});
