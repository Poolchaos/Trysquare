/**
 * Deleting one ruleset (RA-1): its rules go, the default goes with it, and
 * it is refused while a review in line is about to start on it.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-ruleset-delete-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function imported(name: string): Promise<string> {
  const { POST } = await import("@/app/api/rulesets/import/route");
  const made = await POST(
    new Request("http://local/api/rulesets/import", {
      method: "POST",
      body: JSON.stringify({ name, tier: "global", markdown: EXAMPLE }),
    }),
  );
  expect(made.status).toBe(201);
  return (await listed()).rulesets.find((row) => row.name === name)!.id;
}

async function listed(): Promise<{
  rulesets: { id: string; name: string }[];
  defaultRulesetId: string | null;
}> {
  const { GET } = await import("@/app/api/rulesets/route");
  return (await GET()).json();
}

async function remove(id: string): Promise<Response> {
  const { DELETE } = await import("@/app/api/rulesets/[id]/route");
  return DELETE(new Request("http://local/x", { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

describe("deleting one ruleset", () => {
  it("removes it and leaves the others", async () => {
    const first = await imported("Example protocol");
    const second = await imported("Second protocol");

    const gone = await remove(first);
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ deleted: first });
    expect((await listed()).rulesets.map((row) => row.id)).toEqual([second]);

    const again = await remove(first);
    expect(again.status).toBe(404);
    expect(((await again.json()) as { code: string }).code).toBe("RulesetNotFoundError");
  });

  it("takes the default with it, so new reviews start with none chosen", async () => {
    const [only] = (await listed()).rulesets;
    const { PUT } = await import("@/app/api/rulesets/[id]/default/route");
    await PUT(new Request("http://local/x", { method: "PUT" }), {
      params: Promise.resolve({ id: only!.id }),
    });
    expect((await listed()).defaultRulesetId).toBe(only!.id);

    expect((await remove(only!.id)).status).toBe(200);
    expect(await listed()).toEqual({ rulesets: [], defaultRulesetId: null });
  });

  it("is refused while a review in line is about to start on it", async () => {
    // One in line reads the ruleset as it starts: deleted meanwhile, that
    // start would find nothing to run with.
    const id = await imported("Example protocol");
    const { runtime } = await import("@/server/runtime");
    const inLine = vi.spyOn(runtime().manager, "startsOn");
    inLine.mockImplementation((ruleset) => ruleset.id === id);
    try {
      const refused = await remove(id);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        error:
          'A review waiting for a place will start on "Example protocol" and has not taken its copy of the rules yet. Delete the ruleset once that review has started, or take the review out of the line first.',
        code: "RulesetAwaited",
      });
      expect((await listed()).rulesets.map((row) => row.id)).toEqual([id]);
    } finally {
      inLine.mockRestore();
    }
    expect((await remove(id)).status).toBe(200);
  });
});
