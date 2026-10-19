/**
 * Bodies that are there but wrong (MVP 5.8, audits A3 and A8). A setting
 * named after something every object has crashed the route, a confirm's
 * malformed comment was taken as no comment, and a start's malformed ruleset
 * as no ruleset.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir: string;
let routes: {
  settings: typeof import("@/app/api/settings/route");
  confirm: typeof import("@/app/api/findings/[id]/confirm/route");
  start: typeof import("@/app/api/reviews/[id]/start/route");
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: string) => new Request("http://localhost/x", { method: "POST", body });

async function answer(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { code?: string }).code ?? ""];
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-bodies-"));
  // Set before the runtime module is first imported, because it resolves the
  // data directory once and holds the database open.
  process.env.TRYSQUARE_DATA = dataDir;
  routes = {
    settings: await import("@/app/api/settings/route"),
    confirm: await import("@/app/api/findings/[id]/confirm/route"),
    start: await import("@/app/api/reviews/[id]/start/route"),
  };
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("a setting named after something every object has", () => {
  it("is refused as no setting, not a crash", async () => {
    // Looked up on the catalogue as a plain object, "constructor" found
    // Object's own constructor, which has no schema to parse with.
    for (const key of ["constructor", "toString", "hasOwnProperty"]) {
      const response = await routes.settings.PUT(
        new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ [key]: 1 }) }),
      );
      expect(await answer(response), key).toEqual([400, "UnknownSetting"]);
    }
    // Sent as text, as a client would: zod's record dropped this key, and the
    // route answered 200 having written nothing (D-136).
    const proto = await routes.settings.PUT(
      new Request("http://localhost/x", { method: "PUT", body: '{"__proto__":1}' }),
    );
    expect(await answer(proto)).toEqual([400, "UnknownSetting"]);
  });
});

describe("a confirm or a start whose body is there but wrong", () => {
  it("is refused, not read as no body, and an empty body still means none", async () => {
    const { db } = (await import("@/server/runtime")).runtime();
    const { createProject } = await import("@/server/db/repositories/projects");
    const { createReview, transitionReview } = await import("@/server/db/repositories/reviews");
    const { createCandidate, markVerified, requireFinding } =
      await import("@/server/db/repositories/findings");
    const project = createProject(db, {
      name: "app",
      gitUrl: "git@example.com:acme/app.git",
      defaultBranch: "main",
      clonePath: join(dataDir, "app.git"),
    });
    const branches = {
      fromBranch: "feature/x",
      fromCommit: "a".repeat(40),
      intoBranch: "main",
      intoCommit: "b".repeat(40),
      mergeBaseCommit: "c".repeat(40),
    };
    const unstarted = createReview(db, {
      projectId: project.id,
      ...branches,
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    });
    const deciding = createReview(db, {
      projectId: project.id,
      ...branches,
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    });
    const finding = createCandidate(db, {
      reviewId: deciding.id,
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
      transitionReview(db, deciding.id, status);
    }

    expect(
      await answer(await routes.confirm.POST(post('{"comment":5}'), params(finding.id))),
    ).toEqual([400, "Invalid"]);
    expect(await answer(await routes.confirm.POST(post("not json"), params(finding.id)))).toEqual([
      400,
      "BadBody",
    ]);
    // Neither decided anything.
    expect(requireFinding(db, finding.id).status).toBe("verified");

    expect(
      await answer(await routes.start.POST(post('{"rulesetId":5}'), params(unstarted.id))),
    ).toEqual([400, "Invalid"]);
    expect(await answer(await routes.start.POST(post("not json"), params(unstarted.id)))).toEqual([
      400,
      "BadBody",
    ]);

    // A bare POST is still the keyboard's confirm.
    expect((await routes.confirm.POST(post(), params(finding.id))).status).toBe(200);
    expect(requireFinding(db, finding.id).status).toBe("confirmed");
  });
});

describe("a branch compared against itself", () => {
  it("is refused by the create and the pre-flight, on either side of a review", async () => {
    // One branch against itself is an empty change, and a review of nothing
    // reads as clean. The screen kept the primary pair apart but not the
    // dependency's, and neither route refused either (D-144). Refused before
    // anything is looked up, so no project is needed.
    const create = (await import("@/app/api/reviews/route")).POST;
    const preflight = (await import("@/app/api/reviews/preflight/route")).POST;
    const base = {
      projectId: "P",
      fromBranch: "feature",
      intoBranch: "main",
      model: "claude-fable-5[1m]",
      rulesetId: "R",
    };
    const sent = [
      { ...base, linked: { projectId: "D", fromBranch: "main", intoBranch: "main" } },
      { ...base, intoBranch: "feature" },
    ];
    for (const route of [create, preflight]) {
      for (const pair of sent) {
        const response = await route(post(JSON.stringify(pair)));
        const body = (await response.json()) as { code: string; error: string };
        expect(response.status, body.error).toBe(400);
        expect(body.code).toBe("Invalid");
        expect(body.error).toMatch(/intoBranch: .*against itself/);
      }
    }
  });
});

describe("a start that names a ruleset for a review already frozen with one", () => {
  it("is refused, not answered with the ruleset ignored", async () => {
    // A review carries the ruleset frozen onto it, and one sent with its
    // start was dropped without a word (D-138). A completed review, so
    // nothing could start even on the code before.
    const { db } = (await import("@/server/runtime")).runtime();
    const { createProject } = await import("@/server/db/repositories/projects");
    const { createReview, transitionReview } = await import("@/server/db/repositories/reviews");
    const { saveImportedRuleset, writeReviewSnapshot } =
      await import("@/server/db/repositories/rulesets");
    const { importProtocol } = await import("@/lib/rulesets/import");
    const { readFileSync } = await import("node:fs");
    const { rulesetId } = saveImportedRuleset(db, {
      name: "Frozen protocol",
      tier: "global",
      imported: importProtocol(
        readFileSync(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
      ).ruleset,
    });
    const project = createProject(db, {
      name: "frozen",
      gitUrl: "git@example.com:acme/frozen.git",
      defaultBranch: "main",
      clonePath: join(dataDir, "frozen.git"),
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
    writeReviewSnapshot(db, review.id, rulesetId);
    for (const status of ["running", "verifying", "awaiting_confirmation", "complete"] as const) {
      transitionReview(db, review.id, status);
    }

    const response = await routes.start.POST(
      post(JSON.stringify({ rulesetId })),
      params(review.id),
    );
    expect(await answer(response)).toEqual([409, "RulesetFrozen"]);
  });
});
