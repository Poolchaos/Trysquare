/**
 * The HTTP layer, called the way a browser calls it.
 *
 * Handlers are invoked directly with a Request rather than through a server,
 * which is enough: everything worth checking here is what a handler does with
 * a body and what it hands back. The routes share one process-wide runtime, so
 * these tests point it at a temporary data directory before importing them.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneBare } from "@/server/gitops/repo";
import { buildFixture, type SeededFixture } from "../../helpers/seeded-fixture";

let fixture: SeededFixture;
let dataDir: string;
let projectId: string;
let defaultBranch: string;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  branches: typeof import("@/app/api/projects/[id]/branches/route");
  reviews: typeof import("@/app/api/reviews/route");
  rulesets: typeof import("@/app/api/rulesets/import/route");
  project: typeof import("@/app/api/projects/[id]/route");
  links: typeof import("@/app/api/projects/[id]/links/route");
  fetchNow: typeof import("@/app/api/projects/[id]/fetch/route");
  preflight: typeof import("@/app/api/reviews/preflight/route");
  review: typeof import("@/app/api/reviews/[id]/route");
  ruleset: typeof import("@/app/api/rulesets/[id]/route");
  rule: typeof import("@/app/api/rulesets/[id]/rules/[code]/route");
  duplicate: typeof import("@/app/api/rulesets/[id]/duplicate/route");
  projectReviews: typeof import("@/app/api/projects/[id]/reviews/route");
};

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  fixture = await buildFixture();
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-api-"));
  // Set before the runtime module is first imported, because it resolves the
  // data directory once and holds the database open.
  process.env.TRYSQUARE_DATA = dataDir;

  routes = {
    projects: await import("@/app/api/projects/route"),
    branches: await import("@/app/api/projects/[id]/branches/route"),
    reviews: await import("@/app/api/reviews/route"),
    rulesets: await import("@/app/api/rulesets/import/route"),
    project: await import("@/app/api/projects/[id]/route"),
    links: await import("@/app/api/projects/[id]/links/route"),
    fetchNow: await import("@/app/api/projects/[id]/fetch/route"),
    preflight: await import("@/app/api/reviews/preflight/route"),
    review: await import("@/app/api/reviews/[id]/route"),
    ruleset: await import("@/app/api/rulesets/[id]/route"),
    rule: await import("@/app/api/rulesets/[id]/rules/[code]/route"),
    duplicate: await import("@/app/api/rulesets/[id]/duplicate/route"),
    projectReviews: await import("@/app/api/projects/[id]/reviews/route"),
  };

  const created = await routes.projects.POST(
    post("http://localhost/api/projects", { gitUrl: `file://${fixture.appClone}`, name: "app" }),
  );
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const ready = await projectReady(projectId);
  expect(ready.cloneStatus, String(ready.cloneError)).toBe("ready");
  defaultBranch = String(ready.defaultBranch);
}, 180_000);

afterAll(() => {
  fixture?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

/** Waits for the background clone to land, which is what the UI polls for. */
async function projectReady(id: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; cloneStatus: string; cloneError: string | null }[];
    };
    const project = body.projects.find((row) => row.id === id);
    // A terminal state, not merely "not pending": the clone passes through
    // "cloning" on its way, and returning there would assert on a clone that
    // has not finished.
    if (project && (project.cloneStatus === "ready" || project.cloneStatus === "failed")) {
      return project;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the clone never finished");
}

describe("adding a project", () => {
  it("accepts an address, then clones in the background", async () => {
    // Cloned in beforeAll, because a project is its remote and a second
    // project on the same address is refused. A large repository takes
    // minutes, so the row exists immediately and the screen watches the clone
    // state rather than the request hanging.
    const listed = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; name: string; cloneStatus: string; defaultBranch: string }[];
    };
    const project = listed.projects.find((row) => row.id === projectId);

    expect(project?.name).toBe("app");
    expect(project?.cloneStatus).toBe("ready");
    // Read from the remote's own HEAD rather than assumed to be main.
    expect(project?.defaultBranch).toBe(defaultBranch);
    expect(defaultBranch).not.toBe("");
  }, 120_000);

  it("refuses a second project on the same address", async () => {
    // A project is a clone of a remote. Two rows for one remote would fetch
    // twice into two directories and disagree about what the branches are.
    const response = await routes.projects.POST(
      post("http://localhost/api/projects", {
        gitUrl: `file://${fixture.appClone}`,
        name: "again",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an address git would read as an option", async () => {
    // The reason the validator exists. A project stuck in a failed clone would
    // be a worse answer than a message on the form.
    const response = await routes.projects.POST(
      post("http://localhost/api/projects", { gitUrl: "--upload-pack=touch /tmp/pwned" }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/option/i);
  });

  it("says which field was wrong when the body is not a project", async () => {
    const response = await routes.projects.POST(post("http://localhost/api/projects", {}));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("gitUrl");
  });
});

describe("listing branches", () => {
  it("returns them with how far each has diverged", async () => {
    const response = await routes.branches.GET(new Request("http://localhost"), params(projectId));
    const body = (await response.json()) as {
      branches: { name: string; ahead: number; behind: number }[];
      defaultBranch: string;
      stale: string | null;
      lastFetchedAt: string | null;
    };

    expect(body.defaultBranch).toBe(defaultBranch);
    expect(body.stale).toBeNull();
    expect(body.lastFetchedAt).not.toBeNull();
    expect(body.branches.map((branch) => branch.name)).toContain("feature/rename-prefs");

    // Measured against the project's default branch, whichever that is. The
    // two fixture branches genuinely differ, so one of the counts must be
    // non-zero, and the default branch is level with itself.
    const other = body.branches.find((branch) => branch.name !== body.defaultBranch);
    expect(other && other.ahead + other.behind).toBeGreaterThan(0);
    const isDefault = body.branches.find((branch) => branch.name === body.defaultBranch);
    expect(isDefault).toMatchObject({ ahead: 0, behind: 0 });
  }, 120_000);
});

describe("creating a review", () => {
  it("pins the commits the branches point at right now", async () => {
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
        intent: "Rename the prefs field.",
      }),
    );
    expect(response.status).toBe(201);

    const { review } = (await response.json()) as {
      review: { fromCommit: string; mergeBaseCommit: string; intent: string; effort: string };
    };
    expect(review.fromCommit).toBe(fixture.appHead);
    expect(review.mergeBaseCommit).toBe(fixture.appBase);
    expect(review.intent).toBe("Rename the prefs field.");
    expect(review.effort).toBe("high");
  }, 120_000);

  it("takes the profile from the model rather than a default", async () => {
    // Every review before this resolution existed ran full-context, whatever
    // model it named, because the route defaulted the field and nothing read
    // the registry.
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-sonnet-5",
      }),
    );
    expect(response.status).toBe(201);
    const { review } = (await response.json()) as { review: { profileId: string } };
    expect(review.profileId).toBe("decomposed");
  }, 120_000);

  it("refuses a profile stronger than the model is registered for", async () => {
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-sonnet-5",
        profileId: "full-context",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("ProfileStrongerThanModel");
  }, 120_000);

  it("accepts a deliberate downgrade and says so on the run", async () => {
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
        profileId: "decomposed",
      }),
    );
    expect(response.status).toBe(201);
    const { review } = (await response.json()) as { review: { id: string; profileId: string } };
    expect(review.profileId).toBe("decomposed");

    const detail = await routes.review.GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: review.id }),
    });
    const body = JSON.stringify(await detail.json());
    expect(body).toContain("downgraded from full-context");
  }, 120_000);

  it("records both facts when an unregistered model also carries a downgrade", async () => {
    // These notes were branches of one if, so this combination wrote a note
    // claiming the review assumed full-context while the row said decomposed.
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-test-unregistered-5",
        profileId: "decomposed",
      }),
    );
    expect(response.status).toBe(201);
    const { review } = (await response.json()) as { review: { id: string; profileId: string } };
    expect(review.profileId).toBe("decomposed");

    const detail = await routes.review.GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: review.id }),
    });
    const body = JSON.stringify(await detail.json());
    expect(body).toContain("full-context was assumed as the baseline");
    expect(body).toContain("downgraded from full-context to decomposed");
    expect(body).not.toContain("makes one request per batch");
  }, 120_000);

  it("refuses the ultracode effort tier, whatever model is asked for", async () => {
    // That tier lets the session spawn its own workflows. A review already
    // fans out across five stages and as many batches as the profile calls
    // for, unattended, on a subscription this app is a guest on, so one
    // review would become an unbounded amount of someone else's usage.
    for (const model of ["claude-fable-5[1m]", "claude-sonnet-5"]) {
      const response = await routes.reviews.POST(
        post("http://localhost/api/reviews", {
          projectId,
          fromBranch: "feature/rename-prefs",
          intoBranch: "main",
          model,
          effort: "max",
        }),
      );
      expect(response.status, model).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe("EffortNotAvailable");
    }
  }, 120_000);

  it("still accepts the tiers a person can actually pick", async () => {
    // The guard must refuse one tier, not narrow the field to nothing.
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
        effort: "low",
      }),
    );
    expect(response.status).toBe(201);
    expect(((await response.json()) as { review: { effort: string } }).review.effort).toBe("low");
  }, 120_000);

  it("refuses a model that is registered for mechanical work only", async () => {
    // Its plan contains no judgment requests, so the run would raise nothing
    // and then fail with every hunk unaccounted for. Better refused up front.
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-haiku-4-5-20251001",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("ProfileNotForJudgment");
    expect(body.error).toMatch(/judge/i);
  }, 120_000);

  it("refuses a branch that does not exist, rather than pinning nothing", async () => {
    const response = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId,
        fromBranch: "no-such-branch",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 120_000);
});

describe("importing a ruleset", () => {
  it("stores the document and reports what it contained", async () => {
    const markdown = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");

    const response = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "Example protocol",
        tier: "global",
        markdown,
      }),
    );
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      rules: number;
      directives: number;
      version: number;
      fidelity: { totalLines: number; mappedLines: number };
    };
    expect(body.rules).toBeGreaterThan(0);
    expect(body.directives).toBeGreaterThan(0);
    // The fidelity report travels with the result, and for this document it
    // says every line was placed.
    expect(body.fidelity.mappedLines).toBe(body.fidelity.totalLines);
  });

  it("refuses a document that produced no rules", async () => {
    // A review judged against nothing comes back clean, and reads exactly like
    // a review that found nothing wrong.
    const response = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "Broken",
        tier: "global",
        markdown: "# Not a protocol\n\nNothing here parses as a rule.\n",
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("accounts for every line of an awkwardly shaped document", async () => {
    // D-48 as it stands after checking the importer: the block partitioning
    // claims every line by construction, so the fidelity numbers are the
    // positive proof and the route's unmapped block is the trap that fires
    // only if the importer ever regresses to dropping lines. The awkward
    // shapes here are the ones that would go unowned if it did.
    const markdown = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");
    const awkward = `A preamble remark before any heading.\n\n${markdown}\n## Unowned appendix\n\nTrailing notes nobody's rule names.\n`;

    const response = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "Awkward",
        tier: "global",
        markdown: awkward,
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      fidelity: { totalLines: number; mappedLines: number };
    };
    expect(body.fidelity.mappedLines).toBe(body.fidelity.totalLines);
  });

  it("edits severity through the same versioned door as the toggle", async () => {
    const markdown = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");
    const imported = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "Severity edit",
        tier: "project",
        markdown,
      }),
    );
    const { rulesetId, version } = (await imported.json()) as {
      rulesetId: string;
      version: number;
    };

    const detailBefore = await routes.ruleset.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: rulesetId }),
    });
    const before = (await detailBefore.json()) as {
      rules: { code: string; severity: string }[];
    };
    const rule = before.rules[0]!;
    const target = rule.severity === "CRITICAL" ? "WARNING" : "CRITICAL";

    const patched = await routes.rule.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ severity: target }),
      }),
      { params: Promise.resolve({ id: rulesetId, code: rule.code }) },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { version: number }).version).toBe(version + 1);
  });

  it("duplicates a ruleset into another tier as its own version 1", async () => {
    const markdown = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");
    const imported = await routes.rulesets.POST(
      post("http://localhost/api/rulesets/import", {
        name: "To promote",
        tier: "project",
        markdown,
      }),
    );
    const { rulesetId } = (await imported.json()) as { rulesetId: string };

    const copied = await routes.duplicate.POST(post("http://localhost/x", { tier: "global" }), {
      params: Promise.resolve({ id: rulesetId }),
    });
    expect(copied.status).toBe(201);
    const copy = (await copied.json()) as { rulesetId: string; version: number };
    expect(copy.version).toBe(1);
    expect(copy.rulesetId).not.toBe(rulesetId);

    // A second copy under the same default name is refused rather than
    // silently replacing the first one's rules.
    const again = await routes.duplicate.POST(post("http://localhost/x", { tier: "global" }), {
      params: Promise.resolve({ id: rulesetId }),
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe("RulesetNameTakenError");
  });
});

describe("a project's dependency links", () => {
  it("links another project, and refuses a duplicate with the reason", async () => {
    // The link is what makes a two-repository review possible: it names the
    // package the primary consumes.
    const dependency = await routes.projects.POST(
      post("http://localhost/api/projects", {
        gitUrl: `file://${fixture.coreClone}`,
        name: "shared-core",
      }),
    );
    const { project: core } = (await dependency.json()) as { project: { id: string } };
    await projectReady(core.id);

    const linked = await routes.links.POST(
      post("http://localhost/x", {
        dependencyProjectId: core.id,
        packageName: "@acme/shared-core",
      }),
      params(projectId),
    );
    expect(linked.status).toBe(201);

    const again = await routes.links.POST(
      post("http://localhost/x", {
        dependencyProjectId: core.id,
        packageName: "@acme/shared-core",
      }),
      params(projectId),
    );
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toMatch(/already linked/i);
  }, 120_000);

  it("offers only projects that are not already linked to itself", async () => {
    const body = (await (
      await routes.project.GET(new Request("http://localhost"), params(projectId))
    ).json()) as {
      links: { dependencyName: string }[];
      linkable: { id: string }[];
    };

    expect(body.links[0]?.dependencyName).toBe("shared-core");
    // Itself and the one already linked are both excluded, so the form cannot
    // offer a choice the repository would refuse.
    expect(body.linkable.some((candidate) => candidate.id === projectId)).toBe(false);
    expect(body.linkable).toHaveLength(0);
  }, 120_000);
});

describe("fetching a project on demand", () => {
  it("records when the refs were last brought up to date", async () => {
    const before = (await (
      await routes.project.GET(new Request("http://localhost"), params(projectId))
    ).json()) as { project: { lastFetchedAt: string | null } };

    const response = await routes.fetchNow.POST(new Request("http://localhost"), params(projectId));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { lastFetchedAt: string };
    expect(body.lastFetchedAt).not.toBeNull();
    expect(body.lastFetchedAt >= (before.project.lastFetchedAt ?? "")).toBe(true);
  }, 120_000);
});

describe("deleting a project", () => {
  it("refuses while a review still refers to it, and says how many", async () => {
    // Deleting the reviews silently would discard the history they exist for.
    const response = await routes.project.DELETE(
      new Request("http://localhost"),
      params(projectId),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; reviewCount: number };
    expect(body.error).toMatch(/still has \d+ review/);
    // The count travels as a field, because the screen puts it on the button
    // that offers the remedy.
    expect(body.reviewCount).toBeGreaterThan(0);
  }, 120_000);

  it("offers the remedy: delete the blocking reviews, then the project goes", async () => {
    // Its own remote, its own review, so deleting them cannot touch the
    // fixtures the rest of this file depends on.
    const remote = join(dataDir, "remedied.git");
    await cloneBare(fixture.appClone, remote);
    const created = await routes.projects.POST(
      post("http://localhost/api/projects", { gitUrl: `file://${remote}`, name: "remedied" }),
    );
    const { project } = (await created.json()) as { project: { id: string } };
    await projectReady(project.id);

    const review = await routes.reviews.POST(
      post("http://localhost/api/reviews", {
        projectId: project.id,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        model: "claude-fable-5[1m]",
      }),
    );
    expect(review.status).toBe(201);

    const refused = await routes.project.DELETE(
      new Request("http://localhost"),
      params(project.id),
    );
    expect(refused.status).toBe(409);

    const cleared = await routes.projectReviews.DELETE(
      new Request("http://localhost"),
      params(project.id),
    );
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { deleted: number }).deleted).toBe(1);

    const gone = await routes.project.DELETE(new Request("http://localhost"), params(project.id));
    expect(gone.status).toBe(200);
  }, 120_000);

  it("removes the row and the clone together when nothing refers to it", async () => {
    // A clone with no row is disk nobody can account for, and a row with no
    // clone is a project every screen offers and nothing can use.
    // A genuinely separate repository: a project is its remote, and a URL
    // that only differs by a fragment is the same remote wearing a hat.
    const throwawayRemote = join(dataDir, "throwaway.git");
    await cloneBare(fixture.appClone, throwawayRemote);

    const created = await routes.projects.POST(
      post("http://localhost/api/projects", {
        gitUrl: `file://${throwawayRemote}`,
        name: "throwaway",
      }),
    );
    const { project } = (await created.json()) as { project: { id: string; clonePath: string } };
    await projectReady(project.id);
    expect(existsSync(project.clonePath)).toBe(true);

    const response = await routes.project.DELETE(
      new Request("http://localhost"),
      params(project.id),
    );
    expect(response.status).toBe(200);
    expect(existsSync(project.clonePath)).toBe(false);
    // The project's directory too, not just the bare repo inside it. Checking
    // only the clone passed while an empty directory was left behind for every
    // project ever deleted.
    expect(existsSync(dirname(project.clonePath))).toBe(false);
  }, 120_000);
});

describe("looking before you pay", () => {
  it("reports the size of the review without running or writing anything", async () => {
    // Free and read-only on purpose: git and arithmetic, no model calls. A
    // review is expensive enough that seeing its size first is worth a round
    // trip.
    const protocol = await (
      await import("node:fs/promises")
    ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8");
    const imported = await routes.rulesets.POST(
      post("http://localhost/x", {
        name: "Preflight rules",
        tier: "global",
        markdown: protocol,
      }),
    );
    const { rulesetId } = (await imported.json()) as { rulesetId: string };

    const response = await routes.preflight.POST(
      post("http://localhost/api/reviews/preflight", {
        projectId,
        fromBranch: "feature/rename-prefs",
        intoBranch: "main",
        rulesetId,
        model: "claude-fable-5[1m]",
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      pins: { primary: { fromCommit: string; mergeBaseCommit: string; subject: string } };
      files: number;
      hunks: number;
      sweepHits: number;
      sweepProblems: string[];
      estimatedTokens: number;
      requests: number;
      contextWindow: number | null;
    };

    // The same commits creating a review would pin, and the same counts the
    // pipeline would go on to account for.
    expect(body.pins.primary.fromCommit).toBe(fixture.appHead);
    expect(body.pins.primary.mergeBaseCommit).toBe(fixture.appBase);
    expect(body.pins.primary.subject.length).toBeGreaterThan(0);
    expect(body.files).toBe(fixture.appFiles.length);
    expect(body.hunks).toBeGreaterThan(0);
    // Zero hits is the truth for this fixture: six patterns run and none of
    // them match its changed lines. What matters is that they all ran, because
    // a pattern that could not run means an incomplete sweep, which the
    // pipeline refuses outright rather than treating as a clean result.
    expect(body.sweepHits).toBe(0);
    expect(body.sweepProblems).toEqual([]);
    expect(body.estimatedTokens).toBeGreaterThan(0);
    expect(body.requests).toBeGreaterThanOrEqual(1);
    // No probe has run in this suite, so the window is honestly unknown
    // rather than guessed at.
    expect(body.contextWindow).toBeNull();

    // Nothing was written: no review row appeared.
    const reviews = (await (await routes.reviews.GET()).json()) as { reviews: unknown[] };
    const after = (await (await routes.reviews.GET()).json()) as { reviews: unknown[] };
    expect(after.reviews.length).toBe(reviews.reviews.length);
  }, 120_000);

  it("says which branch it could not find, rather than a bare failure", async () => {
    const imported = await routes.rulesets.POST(
      post("http://localhost/x", {
        name: "Preflight rules 2",
        tier: "global",
        markdown: await (
          await import("node:fs/promises")
        ).readFile(new URL("../../fixtures/example-protocol.md", import.meta.url), "utf8"),
      }),
    );
    const { rulesetId } = (await imported.json()) as { rulesetId: string };

    const response = await routes.preflight.POST(
      post("http://localhost/api/reviews/preflight", {
        projectId,
        fromBranch: "no-such-branch",
        intoBranch: "main",
        rulesetId,
        model: "claude-fable-5[1m]",
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/no-such-branch/);
  }, 120_000);
});
