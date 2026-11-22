/**
 * My branches (WP-L, D-69, D-243): which emails count as the person's, and
 * which branches that makes theirs.
 *
 * Against real repositories and the real git binary, with a global config of
 * the test's own standing in for the person's: whose commit a branch ends on
 * is git's answer, and a stubbed one would prove only that a boolean was
 * passed along.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const ME = { name: "Me", email: "me@example.invalid" };
const COLLEAGUE = { name: "Colleague", email: "colleague@example.invalid" };

let root: string;
let dataDir: string;
let projectId: string;
let previousGlobal: string | undefined;
let routes: {
  projects: typeof import("@/app/api/projects/route");
  branches: typeof import("@/app/api/projects/[id]/branches/route");
  settings: typeof import("@/app/api/settings/route");
};

function commit(
  cwd: string,
  message: string,
  author: { name: string; email: string },
  committer = author,
): void {
  execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", message], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: committer.name,
      GIT_COMMITTER_EMAIL: committer.email,
    },
  });
}

function globalConfig(name: string, text: string): void {
  const path = join(root, name);
  writeFileSync(path, text);
  process.env.GIT_CONFIG_GLOBAL = path;
}

const asMe = () => globalConfig("me.gitconfig", `[user]\n\temail = ${ME.email}\n`);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-identities-"));
  dataDir = join(root, "data");
  previousGlobal = process.env.GIT_CONFIG_GLOBAL;
  asMe();

  const origin = join(root, "origin");
  execFileSync("git", ["init", "--quiet", "-b", "main", origin]);
  commit(origin, "baseline", ME);
  execFileSync("git", ["checkout", "--quiet", "-b", "feature/mine"], { cwd: origin });
  commit(origin, "my work", ME);
  // Authored by a colleague and committed by me, as a rebase or a cherry-pick
  // of their work leaves it: the author is whose branch it is.
  execFileSync("git", ["checkout", "--quiet", "-b", "feature/theirs", "main"], { cwd: origin });
  commit(origin, "their work", COLLEAGUE, ME);
  execFileSync("git", ["checkout", "--quiet", "main"], { cwd: origin });

  process.env.TRYSQUARE_DATA = dataDir;
  routes = {
    projects: await import("@/app/api/projects/route"),
    branches: await import("@/app/api/projects/[id]/branches/route"),
    settings: await import("@/app/api/settings/route"),
  };

  const created = await routes.projects.POST(
    new Request("http://local/api/projects", {
      method: "POST",
      body: JSON.stringify({ gitUrl: `file://${origin}`, name: "app" }),
    }),
  );
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const listed = (await (await routes.projects.GET()).json()) as {
      projects: { id: string; cloneStatus: string }[];
    };
    if (listed.projects.find((row) => row.id === projectId)?.cloneStatus === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}, 120_000);

afterEach(async () => {
  asMe();
  await save({ identities: [] });
});

afterAll(async () => {
  // The runtime holds the database open, and Windows will not delete it.
  (await import("@/server/runtime")).closeRuntime();
  rmSync(root, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
  if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
});

function save(body: object): Promise<Response> {
  return routes.settings.PUT(
    new Request("http://local/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  );
}

async function settings(): Promise<{
  settings: { identities: string[] };
  environment: { gitEmail: string | null; gitEmailProblem: string | null };
}> {
  return (await routes.settings.GET()).json();
}

async function branches(): Promise<{
  identities: string[];
  mine: Record<string, boolean>;
}> {
  const response = await routes.branches.GET(new Request("http://local/x"), {
    params: Promise.resolve({ id: projectId }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    identities: string[];
    branches: { name: string; mine: boolean }[];
  };
  return {
    identities: body.identities,
    mine: Object.fromEntries(body.branches.map((branch) => [branch.name, branch.mine])),
  };
}

describe("the emails that count as mine", () => {
  it("are git's own user.email until any is kept", async () => {
    const read = await settings();
    expect(read.settings.identities).toEqual([]);
    expect(read.environment.gitEmail).toBe(ME.email);
    expect(read.environment.gitEmailProblem).toBeNull();
  });

  it("are the ones kept, once any is", async () => {
    const saved = await save({ identities: ["Work@Example.invalid", "work@example.invalid"] });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { settings: { identities: string[] } }).settings).toMatchObject(
      { identities: ["Work@Example.invalid"] },
    );
    expect((await settings()).settings.identities).toEqual(["Work@Example.invalid"]);
  });

  it("are refused with the reason when one is a name with its email", async () => {
    const refused = await save({ identities: ["Me <me@example.invalid>"] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: "The list of emails holds < or >: enter the email alone, without a name",
      code: "Invalid",
    });
    expect((await settings()).settings.identities).toEqual([]);
  });

  it("say so when git has no email set, rather than failing", async () => {
    globalConfig("nameless.gitconfig", "[user]\n\tname = Me\n");
    const read = await settings();
    expect(read.environment.gitEmail).toBeNull();
    expect(read.environment.gitEmailProblem).toBeNull();
  });

  it("give git's own words when its config cannot be read, and the settings all the same", async () => {
    globalConfig("broken.gitconfig", "[user\n");
    const response = await routes.settings.GET();
    expect(response.status).toBe(200);
    const read = (await response.json()) as Awaited<ReturnType<typeof settings>>;
    expect(read.environment.gitEmail).toBeNull();
    expect(read.environment.gitEmailProblem).toContain("bad config line 1");
    expect(read.settings.identities).toEqual([]);
  });
});

describe("which branches are mine", () => {
  it("are those whose newest commit I authored, by git's own email", async () => {
    expect(await branches()).toEqual({
      identities: [ME.email],
      mine: { main: true, "feature/mine": true, "feature/theirs": false },
    });
  });

  it("follow the emails kept in Settings, whatever their case", async () => {
    await save({ identities: ["COLLEAGUE@example.invalid"] });
    expect(await branches()).toEqual({
      identities: ["COLLEAGUE@example.invalid"],
      mine: { main: false, "feature/mine": false, "feature/theirs": true },
    });
  });

  it("are none when no email counts as mine", async () => {
    globalConfig("nameless.gitconfig", "[user]\n\tname = Me\n");
    expect(await branches()).toEqual({
      identities: [],
      mine: { main: false, "feature/mine": false, "feature/theirs": false },
    });
  });
});

describe("whose branch a review was of, on the scoreboard (D-297)", () => {
  interface Row {
    id: string;
    author: { name: string; email: string } | null;
    mine: boolean;
  }

  /** A review in the store, with the author git gives for the branch's newest commit. */
  async function reviewOf(branch: string, keepAuthor = true): Promise<string> {
    const { runtime } = await import("@/server/runtime");
    const { createReview } = await import("@/server/db/repositories/reviews");
    const { requireClonedProject } = await import("@/server/db/repositories/projects");
    const { commitAuthor, resolveBranch } = await import("@/server/gitops/repo");
    const { db } = runtime();
    const clone = requireClonedProject(db, projectId).clonePath;
    const tip = await resolveBranch(clone, branch);
    return createReview(db, {
      projectId,
      fromBranch: branch,
      fromCommit: tip,
      intoBranch: "main",
      intoCommit: tip,
      mergeBaseCommit: tip,
      ...(keepAuthor ? { fromAuthor: await commitAuthor(clone, tip) } : {}),
      model: "claude-fable-5[1m]",
      profileId: "full-context",
      engineMode: "headless",
    }).id;
  }

  async function board(): Promise<{ rows: Map<string, Row>; identitiesProblem: string | null }> {
    const { GET } = await import("@/app/api/scoreboard/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recent: Row[]; identitiesProblem: string | null };
    return {
      rows: new Map(body.recent.map((row) => [row.id, row])),
      identitiesProblem: body.identitiesProblem,
    };
  }

  it("is mine where I authored its newest commit, and names the author where I did not", async () => {
    const mine = await reviewOf("feature/mine");
    // Authored by a colleague and committed by me: theirs.
    const theirs = await reviewOf("feature/theirs");
    const { rows, identitiesProblem } = await board();
    expect(rows.get(mine)).toMatchObject({ author: ME, mine: true });
    expect(rows.get(theirs)).toMatchObject({ author: COLLEAGUE, mine: false });
    expect(identitiesProblem).toBeNull();
  });

  it("follows the emails kept in Settings", async () => {
    const theirs = await reviewOf("feature/theirs");
    await save({ identities: [COLLEAGUE.email] });
    expect((await board()).rows.get(theirs)).toMatchObject({ author: COLLEAGUE, mine: true });
  });

  it("has no author for a review made before one was kept", async () => {
    const old = await reviewOf("feature/mine", false);
    expect((await board()).rows.get(old)).toMatchObject({ author: null, mine: false });
  });

  it("says git's own words when its config cannot be read, and the board all the same", async () => {
    const mine = await reviewOf("feature/mine");
    globalConfig("broken.gitconfig", "[user\n");
    const { rows, identitiesProblem } = await board();
    expect(identitiesProblem).toContain("bad config line 1");
    expect(rows.get(mine)).toMatchObject({ author: ME, mine: false });
  });
});
