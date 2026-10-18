/**
 * What an unknown id and an illegal step answer (MVP 5.6, audit A1; 4.20).
 *
 * Every error that was not a Response became a 500, so a review, project,
 * ruleset or finding that does not exist, and a second decision on one
 * finding, read as the server failing rather than as the request being
 * wrong.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir: string;
let routes: {
  review: typeof import("@/app/api/reviews/[id]/route");
  events: typeof import("@/app/api/reviews/[id]/events/route");
  project: typeof import("@/app/api/projects/[id]/route");
  ruleset: typeof import("@/app/api/rulesets/[id]/route");
  confirm: typeof import("@/app/api/findings/[id]/confirm/route");
  start: typeof import("@/app/api/reviews/[id]/start/route");
  links: typeof import("@/app/api/projects/[id]/links/route");
  link: typeof import("@/app/api/projects/[id]/links/[linkId]/route");
  rule: typeof import("@/app/api/rulesets/[id]/rules/[code]/route");
  preflight: typeof import("@/app/api/reviews/preflight/route");
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = () => new Request("http://localhost/x");
const post = () => new Request("http://localhost/x", { method: "POST", body: "{}" });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-status-"));
  // Set before the runtime module is first imported, because it resolves the
  // data directory once and holds the database open.
  process.env.TRYSQUARE_DATA = dataDir;
  routes = {
    review: await import("@/app/api/reviews/[id]/route"),
    events: await import("@/app/api/reviews/[id]/events/route"),
    project: await import("@/app/api/projects/[id]/route"),
    ruleset: await import("@/app/api/rulesets/[id]/route"),
    confirm: await import("@/app/api/findings/[id]/confirm/route"),
    start: await import("@/app/api/reviews/[id]/start/route"),
    links: await import("@/app/api/projects/[id]/links/route"),
    link: await import("@/app/api/projects/[id]/links/[linkId]/route"),
    rule: await import("@/app/api/rulesets/[id]/rules/[code]/route"),
    preflight: await import("@/app/api/reviews/preflight/route"),
  };
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function codeOf(response: Response): Promise<string> {
  return ((await response.json()) as { code: string }).code;
}

describe("an id that names nothing", () => {
  it("is a 404 naming what was not found, for every kind of thing", async () => {
    const answers = [
      await routes.review.GET(get(), params("NOPE")),
      await routes.project.GET(get(), params("NOPE")),
      await routes.ruleset.GET(get(), params("NOPE")),
      await routes.confirm.POST(post(), params("NOPE")),
    ];
    expect(answers.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(await codeOf(answers[0]!)).toBe("ReviewNotFoundError");
  });

  it("is a 404 from the routes that caught their own errors too", async () => {
    // Each caught what it did not expect and answered in its own words: a
    // 409, a 400, or an empty list for a project that does not exist (review
    // of 5.5 to 5.7).
    const { runtime } = await import("@/server/runtime");
    const { saveImportedRuleset } = await import("@/server/db/repositories/rulesets");
    const { importProtocol } = await import("@/lib/rulesets/import");
    const source = readFileSync(
      new URL("../../fixtures/example-protocol.md", import.meta.url),
      "utf8",
    );
    const { rulesetId } = saveImportedRuleset(runtime().db, {
      name: "Example protocol",
      tier: "global",
      imported: importProtocol(source).ruleset,
    });
    const patch = () =>
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
    const rule = (id: string, code: string) => ({ params: Promise.resolve({ id, code }) });
    const link = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ dependencyProjectId: "ALSO-NOPE", packageName: "@acme/core" }),
    });

    const answers = [
      await routes.review.DELETE(get(), params("NOPE")),
      await routes.start.POST(post(), params("NOPE")),
      await routes.links.GET(get(), params("NOPE")),
      await routes.links.POST(link, params("NOPE")),
      await routes.rule.PATCH(patch(), rule("NOPE", "R1")),
      await routes.rule.PATCH(patch(), rule(rulesetId, "NO-SUCH-RULE")),
    ];
    expect(answers.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(await codeOf(answers[5]!)).toBe("RuleNotFoundError");
  });

  it("is a 404 for a preview's unknown dependency, not git's 400", async () => {
    // Looked up inside the catch that answers 400 for what git refuses
    // (review of the D-133 fixes).
    const { runtime } = await import("@/server/runtime");
    const { db } = runtime();
    const { createProject, setCloneStatus } = await import("@/server/db/repositories/projects");
    const { saveImportedRuleset } = await import("@/server/db/repositories/rulesets");
    const { importProtocol } = await import("@/lib/rulesets/import");
    const source = readFileSync(
      new URL("../../fixtures/example-protocol.md", import.meta.url),
      "utf8",
    );
    const { rulesetId } = saveImportedRuleset(db, {
      name: "Preview protocol",
      tier: "global",
      imported: importProtocol(source).ruleset,
    });
    const project = createProject(db, {
      name: "previewed",
      gitUrl: "git@example.com:acme/previewed.git",
      defaultBranch: "main",
      clonePath: join(dataDir, "previewed.git"),
    });
    setCloneStatus(db, project.id, "cloning");
    setCloneStatus(db, project.id, "ready");

    const branches = { fromBranch: "feature/x", intoBranch: "main" };
    const response = await routes.preflight.POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          ...branches,
          rulesetId,
          model: "claude-fable-5[1m]",
          linked: { projectId: "NOPE", ...branches },
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("ProjectNotFoundError");
  });

  it("is a 404 for a review's event stream too, not a broken stream (4.20)", async () => {
    const response = await routes.events.GET(get(), params("NOPE"));
    expect(response.status).toBe(404);
  });
});

describe("a step the state machine does not allow", () => {
  it("is a 409: a second decision on one finding", async () => {
    const { runtime } = await import("@/server/runtime");
    const { db } = runtime();
    const { createProject } = await import("@/server/db/repositories/projects");
    const { createReview, transitionReview } = await import("@/server/db/repositories/reviews");
    const { createCandidate, markVerified } = await import("@/server/db/repositories/findings");
    const project = createProject(db, {
      name: "app",
      gitUrl: "git@example.com:acme/app.git",
      defaultBranch: "main",
      clonePath: join(dataDir, "app.git"),
    });
    const review = createReview(db, {
      projectId: project.id,
      fromBranch: "feature/x",
      fromCommit: "a".repeat(40),
      intoBranch: "main",
      intoCommit: "b".repeat(40),
      mergeBaseCommit: "c".repeat(40),
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    });
    const finding = createCandidate(db, {
      reviewId: review.id,
      repo: "primary",
      filePath: "app/a.ts",
      lineStart: 1,
      lineEnd: 1,
      severity: "WARNING",
      issue: "An issue.",
      comment: "A comment.",
      mechanism: "A mechanism.",
    });
    markVerified(db, finding.id, { quotedCode: "x", lineStart: 1, lineEnd: 1 });
    for (const status of ["running", "verifying", "awaiting_confirmation"] as const) {
      transitionReview(db, review.id, status);
    }

    expect((await routes.confirm.POST(post(), params(finding.id))).status).toBe(200);
    const again = await routes.confirm.POST(post(), params(finding.id));
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("IllegalTransitionError");
  });
});

describe("a dependency link removed by its address", () => {
  it("is removed only under its own project, and an unknown one is a 404", async () => {
    // The project in the path was never read: any link id was removed under
    // any project's address, and one that named nothing answered 200 (5.9,
    // audit A4).
    const { db } = (await import("@/server/runtime")).runtime();
    const { createProject, linkDependency, listDependencyLinks } =
      await import("@/server/db/repositories/projects");
    const make = (name: string) =>
      createProject(db, {
        name,
        gitUrl: `git@example.com:acme/${name}.git`,
        defaultBranch: "main",
        clonePath: join(dataDir, `${name}.git`),
      });
    const consumer = make("link-consumer");
    const core = make("link-core");
    const stranger = make("link-stranger");
    const link = linkDependency(db, {
      projectId: consumer.id,
      dependencyProjectId: core.id,
      packageName: "@acme/core",
    });
    const remove = (projectId: string, linkId: string) =>
      routes.link.DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
        params: Promise.resolve({ id: projectId, linkId }),
      });

    const elsewhere = await remove(stranger.id, link.id);
    expect(elsewhere.status).toBe(404);
    expect(await codeOf(elsewhere)).toBe("LinkNotFoundError");
    expect(listDependencyLinks(db, consumer.id)).toHaveLength(1);
    expect((await remove(consumer.id, "NOPE")).status).toBe(404);
    expect((await remove("NOPE", link.id)).status).toBe(404);

    expect((await remove(consumer.id, link.id)).status).toBe(200);
    expect(listDependencyLinks(db, consumer.id)).toHaveLength(0);
    expect((await remove(consumer.id, link.id)).status).toBe(404);
  });
});
