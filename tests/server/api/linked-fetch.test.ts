/**
 * Creating a review of a linked pair fetches both clones before either is
 * pinned (D-181 item 7). It fetched the primary, then the dependency, though
 * the two are separate clones and the fetch queue serialises only one
 * clone's fetches. In a file of its own: fetchAll is mocked for all of it.
 * An interactive review, which starts no CLI, so nothing here asks one.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const pending = vi.hoisted(
  () => new Map<string, { resolve: () => void; reject: (error: Error) => void }>(),
);
const { fetchAll } = vi.hoisted(() => ({
  fetchAll: vi.fn(
    (dir: string) =>
      new Promise<void>((resolve, reject) => {
        pending.set(dir, { resolve, reject });
      }),
  ),
}));

vi.mock("@/server/gitops/repo", async (original) => ({
  ...(await original<typeof import("@/server/gitops/repo")>()),
  fetchAll,
}));

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-linked-fetch-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function linkedPair(name: string) {
  const { db } = (await import("@/server/runtime")).runtime();
  // A Mode B review's second verifier is held to a probe too (D-185).
  (await import("../db/helpers")).probeSecondVerifier(db);
  const { createProject, linkDependency, setCloneStatus } =
    await import("@/server/db/repositories/projects");
  const make = (suffix: string) => {
    const made = createProject(db, {
      name: `${name}-${suffix}`,
      gitUrl: `git@example.com:acme/${name}-${suffix}.git`,
      defaultBranch: "main",
      clonePath: join(dataDir, `${name}-${suffix}.git`),
    });
    setCloneStatus(db, made.id, "cloning");
    setCloneStatus(db, made.id, "ready");
    return made;
  };
  const primary = make("app");
  const dependency = make("core");
  linkDependency(db, {
    projectId: primary.id,
    dependencyProjectId: dependency.id,
    packageName: `@acme/${name}-core`,
  });
  const branches = { fromBranch: "feature/x", intoBranch: "main" };
  const { POST } = await import("@/app/api/reviews/route");
  const answer = POST(
    new Request("http://localhost/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        projectId: primary.id,
        ...branches,
        model: "claude-fable-5[1m]",
        engineMode: "interactive",
        linked: { projectId: dependency.id, ...branches },
      }),
    }),
  );
  const fetchedAt = async () => {
    const { requireProject } = await import("@/server/db/repositories/projects");
    return [primary, dependency].map((side) => requireProject(db, side.id).lastFetchedAt);
  };
  return { primary, dependency, answer, fetchedAt };
}

it("fetches both sides at once, and a failed primary is the one said", async () => {
  fetchAll.mockClear();
  const { primary, dependency, answer, fetchedAt } = await linkedPair("both");
  await vi.waitFor(() => expect(fetchAll).toHaveBeenCalledTimes(2), { timeout: 15_000 });
  pending.get(dependency.clonePath)!.reject(new Error("the core fetch failed"));
  pending.get(primary.clonePath)!.reject(new Error("the app fetch failed"));
  const response = await answer;
  expect(response.status).toBe(500);
  expect(((await response.json()) as { error: string }).error).toBe("the app fetch failed");
  expect(await fetchedAt()).toEqual([null, null]);
});

it("answers only once both have finished, recording the one that did", async () => {
  fetchAll.mockClear();
  const { primary, dependency, answer, fetchedAt } = await linkedPair("settled");
  await vi.waitFor(() => expect(fetchAll).toHaveBeenCalledTimes(2), { timeout: 15_000 });
  pending.get(dependency.clonePath)!.reject(new Error("the core fetch failed"));
  const first = await Promise.race([
    answer.then(() => "answered"),
    new Promise((resolve) => setTimeout(() => resolve("waiting"), 100)),
  ]);
  expect(first).toBe("waiting");
  pending.get(primary.clonePath)!.resolve();
  const response = await answer;
  expect(response.status).toBe(500);
  expect(((await response.json()) as { error: string }).error).toBe("the core fetch failed");
  const [primaryAt, dependencyAt] = await fetchedAt();
  expect(primaryAt).not.toBeNull();
  expect(dependencyAt).toBeNull();
});
