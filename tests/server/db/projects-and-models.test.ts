import { InvalidCloneTransitionError } from "@/lib/domain/state-machines";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import {
  InvalidProjectLinkError,
  ProjectHasReviewsError,
  countReviewsReferencing,
  deleteProject,
  linkDependency,
  listDependencyLinks,
  listProjects,
  setCloneStatus,
} from "@/server/db/repositories/projects";
import { PROBE_FRESHNESS_MS, availabilityOf } from "@/lib/models/availability";
import {
  ModelAliasRejectedError,
  getModel,
  listSelectable,
  recordProbeFailure,
  recordProbeSuccess,
  registerCandidate,
} from "@/server/db/repositories/models";
import { createReview, deleteReview } from "@/server/db/repositories/reviews";
import { makeTestDb, seedProject, seedReview, type TestDb } from "./helpers";

let ctx: TestDb;
let db: Db;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => ctx.cleanup());

describe("projects", () => {
  it("keeps a clone error only while the clone is failed", () => {
    const project = seedProject(db);
    setCloneStatus(db, project.id, "failed", "Permission denied (publickey).");
    expect(listProjects(db)[0]!.cloneError).toBe("Permission denied (publickey).");

    // Through cloning rather than straight to ready, because a retry
    // re-clones and the transition guard insists on it.
    setCloneStatus(db, project.id, "cloning");
    setCloneStatus(db, project.id, "ready");
    expect(listProjects(db)[0]!.cloneError).toBeNull();
  });

  it("refuses a clone status that skips the work it claims to have done", () => {
    // Straight from failed to ready would mean a clone nobody re-attempted.
    // Nothing in the app does it; the guard is what keeps that true.
    const project = seedProject(db);
    setCloneStatus(db, project.id, "failed", "Permission denied (publickey).");
    expect(() => setCloneStatus(db, project.id, "ready")).toThrow(InvalidCloneTransitionError);
  });

  it("refuses to move a ready clone backwards", () => {
    const project = seedProject(db);
    setCloneStatus(db, project.id, "cloning");
    setCloneStatus(db, project.id, "ready");
    expect(() => setCloneStatus(db, project.id, "pending")).toThrow(InvalidCloneTransitionError);
  });

  it("refuses to delete a project that still has review history", () => {
    const project = seedProject(db);
    const review = seedReview(db, project.id);

    expect(() => deleteProject(db, project.id)).toThrow(ProjectHasReviewsError);
    expect(listProjects(db)).toHaveLength(1);

    deleteReview(db, review.id);
    deleteProject(db, project.id);
    expect(listProjects(db)).toHaveLength(0);
  });

  it("refuses to delete a dependency that a linked review still relies on", () => {
    // A shared package may never have been reviewed on its own, yet still be
    // half of somebody else's linked review. Counting only owned reviews would
    // let the delete through and fail on a raw foreign key error instead.
    const app = seedProject(db, "app");
    const core = seedProject(db, "shared-core");
    const review = createReview(db, {
      projectId: app.id,
      fromBranch: "feature/x",
      fromCommit: "a".repeat(40),
      intoBranch: "main",
      intoCommit: "b".repeat(40),
      mergeBaseCommit: "c".repeat(40),
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
      linked: {
        projectId: core.id,
        fromBranch: "feature/x",
        fromCommit: "d".repeat(40),
        intoBranch: "main",
        intoCommit: "e".repeat(40),
        mergeBaseCommit: "f".repeat(40),
      },
    });

    expect(countReviewsReferencing(db, core.id)).toBe(1);
    expect(() => deleteProject(db, core.id)).toThrow(ProjectHasReviewsError);
    expect(listProjects(db)).toHaveLength(2);

    deleteReview(db, review.id);
    deleteProject(db, core.id);
    expect(listProjects(db)).toHaveLength(1);
  });
});

describe("rule codes", () => {
  it("rejects two rules sharing a code within one ruleset", async () => {
    const { rulesets, rules } = await import("@/server/db/schema");
    const now = new Date().toISOString();
    db.insert(rulesets)
      .values({
        id: "rs1",
        name: "Global",
        tier: "global",
        description: "",
        sourceDoc: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const rule = (id: string) => ({
      id,
      rulesetId: "rs1",
      code: "5b",
      title: "Manual cast after a database read",
      severity: "WARNING",
      tags: "[]",
      ruleText: "text",
      violationExample: null,
      correctPattern: null,
      detection: null,
      notes: null,
      sweepPatterns: "[]",
      enabled: true,
      sortOrder: 1,
    });

    db.insert(rules).values(rule("r1")).run();
    // A duplicate code would make findings.ruleCode ambiguous and would run
    // that rule's sweep patterns twice.
    expect(() => db.insert(rules).values(rule("r2")).run()).toThrow(/UNIQUE constraint failed/);

    // The same code in a different ruleset is legitimate.
    db.insert(rulesets)
      .values({
        id: "rs2",
        name: "React",
        tier: "tech",
        description: "",
        sourceDoc: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(() =>
      db
        .insert(rules)
        .values({ ...rule("r3"), rulesetId: "rs2" })
        .run(),
    ).not.toThrow();
  });
});

describe("dependency links", () => {
  it("links a consumer to a package it consumes", () => {
    const app = seedProject(db, "app");
    const core = seedProject(db, "shared-core");
    linkDependency(db, {
      projectId: app.id,
      dependencyProjectId: core.id,
      packageName: "@acme/shared-core",
    });

    const links = listDependencyLinks(db, app.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.packageName).toBe("@acme/shared-core");
    // The link is directional: the dependency does not gain a link.
    expect(listDependencyLinks(db, core.id)).toHaveLength(0);
  });

  it("rejects a project depending on itself", () => {
    const app = seedProject(db, "app");
    expect(() =>
      linkDependency(db, {
        projectId: app.id,
        dependencyProjectId: app.id,
        packageName: "@acme/self",
      }),
    ).toThrow(InvalidProjectLinkError);
  });

  it("rejects a duplicate link rather than creating two", () => {
    const app = seedProject(db, "app");
    const core = seedProject(db, "shared-core");
    const input = {
      projectId: app.id,
      dependencyProjectId: core.id,
      packageName: "@acme/shared-core",
    };
    linkDependency(db, input);
    expect(() => linkDependency(db, input)).toThrow(InvalidProjectLinkError);
    expect(listDependencyLinks(db, app.id)).toHaveLength(1);
  });
});

describe("model registry", () => {
  const fable = {
    id: "claude-fable-5[1m]",
    family: "fable",
    displayName: "Fable 5 (1M)",
    profileId: "full-context" as const,
    recommended: true,
  };

  it("refuses to store a short alias, which would silently downgrade a review", () => {
    for (const alias of ["opus", "sonnet", "haiku", "fable", "Opus"]) {
      expect(() =>
        registerCandidate(db, {
          id: alias,
          family: "x",
          displayName: alias,
          profileId: "chunked",
        }),
      ).toThrow(ModelAliasRejectedError);
    }
  });

  it("treats a never-probed model as unknown, not as working", () => {
    const row = registerCandidate(db, fable);
    expect(row.available).toBeNull();
    expect(availabilityOf(row)).toBe("unknown");
    expect(listSelectable(db)).toHaveLength(0);
  });

  it("becomes selectable only after a successful probe", () => {
    registerCandidate(db, fable);
    recordProbeSuccess(db, fable.id, { resolvedId: fable.id, contextWindow: 1_000_000 });

    const selectable = listSelectable(db);
    expect(selectable).toHaveLength(1);
    expect(selectable[0]!.contextWindow).toBe(1_000_000);
  });

  it("keeps the failure reason so the picker can explain why it is disabled", () => {
    registerCandidate(db, fable);
    // Prove the probe result is what changes the state: it is available first.
    recordProbeSuccess(db, fable.id, { resolvedId: fable.id, contextWindow: 200_000 });
    expect(listSelectable(db)).toHaveLength(1);

    recordProbeFailure(db, fable.id, "model not available on this account");

    const stored = getModel(db, fable.id);
    expect(stored?.available).toBe(false);
    expect(stored?.lastError).toBe("model not available on this account");
    expect(stored?.lastProbedAt).not.toBeNull();
    expect(availabilityOf(stored!)).toBe("unavailable");
    expect(listSelectable(db)).toHaveLength(0);
  });

  it("treats a probe older than a day as stale rather than trusted", () => {
    registerCandidate(db, fable);
    recordProbeSuccess(db, fable.id, { resolvedId: fable.id, contextWindow: 200_000 });

    const later = Date.now() + PROBE_FRESHNESS_MS + 1000;
    expect(listSelectable(db, later)).toHaveLength(0);
  });
});
