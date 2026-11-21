/**
 * Removing a rule in the app (RA-4): the rule goes from the ruleset and from
 * its document, the blocks after it move up to where it started, and a
 * review already run keeps the rule it ran with.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";
import { seedProject, seedReview } from "../db/helpers";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);

let dataDir: string;
let id: string;

interface Detail {
  ruleset: { version: number };
  rules: { code: string; raw: string }[];
}

async function detail(rulesetId = id): Promise<Detail> {
  const { GET } = await import("@/app/api/rulesets/[id]/route");
  return (
    await GET(new Request("http://local/x"), { params: Promise.resolve({ id: rulesetId }) })
  ).json();
}

async function remove(code: string, version: string | null, rulesetId = id): Promise<Response> {
  const { DELETE } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
  return DELETE(
    new Request(`http://local/x${version === null ? "" : `?version=${version}`}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: rulesetId, code }) },
  );
}

async function imported(name: string, markdown: string): Promise<string> {
  const { POST } = await import("@/app/api/rulesets/import/route");
  const made = await POST(
    new Request("http://local/api/rulesets/import", {
      method: "POST",
      body: JSON.stringify({ name, tier: "global", markdown }),
    }),
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { rulesetId: string }).rulesetId;
}

/** The document an export writes, and whether importing it would change what is stored. */
async function exported(rulesetId: string, name: string) {
  const { GET } = await import("@/app/api/rulesets/[id]/export/route");
  const document = await (
    await GET(new Request("http://local/x"), { params: Promise.resolve({ id: rulesetId }) })
  ).text();
  const { runtime } = await import("@/server/runtime");
  const { rulesetAnImportWouldReplace } = await import("@/server/db/repositories/rulesets");
  const read = importProtocol(document);
  return {
    document,
    read,
    differs: rulesetAnImportWouldReplace(runtime().db, name, read.ruleset) !== undefined,
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-rule-remove-"));
  process.env.TRYSQUARE_DATA = dataDir;
  id = await imported("Example protocol", EXAMPLE);
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("removing a rule", () => {
  it("takes it from the ruleset and its document, a past review keeping the rule it ran with", async () => {
    const { runtime } = await import("@/server/runtime");
    const { readReviewSnapshot, writeReviewSnapshot } =
      await import("@/server/db/repositories/rulesets");
    const { db } = runtime();
    const reviewId = seedReview(db, seedProject(db).id).id;
    writeReviewSnapshot(db, reviewId, id);

    const before = await detail();
    const gone = before.rules.find((rule) => rule.code === "4")!;
    const removed = await remove("4", String(before.ruleset.version));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ version: before.ruleset.version + 1 });

    const after = await detail();
    expect(after.ruleset.version).toBe(before.ruleset.version + 1);
    // Every other rule as it was, in its place.
    expect(after.rules).toEqual(before.rules.filter((rule) => rule.code !== "4"));

    // The document an export writes no longer holds it, loses no other
    // line, and is what is stored: importing it would change nothing.
    const out = await exported(id, "Example protocol");
    expect(out.document).not.toContain(gone.raw);
    expect(out.document.split("\n").length).toBe(
      EXAMPLE.split("\n").length - gone.raw.split("\n").length,
    );
    expect(out.read.coverage.unmapped).toEqual([]);
    expect(out.differs).toBe(false);

    expect(readReviewSnapshot(db, reviewId).rules.find((rule) => rule.code === "4")?.raw).toBe(
      gone.raw,
    );
  });

  it("refuses a version since replaced, and one not given or not a number, removing nothing", async () => {
    const before = await detail();
    const stale = await remove("5", String(before.ruleset.version - 1));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error:
        "This ruleset changed since you opened it: it is at version " +
        `${before.ruleset.version}, and this edit was made from version ${before.ruleset.version - 1}. ` +
        "Read it again before saving, so the other change is not undone.",
      code: "RulesetChangedError",
    });
    for (const version of [null, "", "two", "1.5"]) {
      const unsaid = await remove("5", version);
      expect(unsaid.status, String(version)).toBe(400);
      expect(await unsaid.json(), String(version)).toEqual({
        error: "version: the ruleset's version as a whole number, as ?version=3",
        code: "Invalid",
      });
    }
    expect(await detail()).toEqual(before);
  });

  it("answers a rule that is not there with a 404", async () => {
    const missing = await remove("99", String((await detail()).ruleset.version));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'Ruleset "Example protocol" has no rule 99.',
      code: "RuleNotFoundError",
    });
  });

  it("keeps the document's order when the rule was saved longer than it was imported", async () => {
    // Before RA-5 a save moved no later block, so the rule's stored end ran
    // past where the next block starts: moved up by the rule's own lines,
    // the blocks after it landed above the blocks before it.
    const other = await imported("Example protocol, edited", EXAMPLE);
    const before = await detail(other);
    const grown = before.rules.find((rule) => rule.code === "2a")!;
    const { PUT } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
    const longer = `${grown.raw.trimEnd()}\n\n${"A line added in the app.\n".repeat(400)}`;
    const saved = await PUT(
      new Request("http://local/x", {
        method: "PUT",
        body: JSON.stringify({ markdown: longer, version: before.ruleset.version }),
      }),
      { params: Promise.resolve({ id: other, code: "2a" }) },
    );
    expect(saved.status).toBe(200);

    const removed = await remove("2a", String(before.ruleset.version + 1), other);
    expect(removed.status).toBe(200);
    const out = await exported(other, "Example protocol, edited");
    expect(out.document).toBe(EXAMPLE.replace(`${grown.raw}\n`, ""));
    expect(out.differs).toBe(false);
  });

  it("removes the last rule too, leaving a ruleset no review can start on", async () => {
    const one = await imported(
      "One rule",
      "# One\n\n## Hygiene\n\n### 1. First\n\n**Rule:** Flag it.\n",
    );
    const removed = await remove("1", "1", one);
    expect(removed.status).toBe(200);
    expect((await detail(one)).rules).toEqual([]);
    const out = await exported(one, "One rule");
    expect(out.document).toBe("# One\n\n## Hygiene\n");
    expect(out.differs).toBe(false);

    const { runtime } = await import("@/server/runtime");
    const { loadEnabledRuleset } = await import("@/server/db/repositories/rulesets");
    expect(() => loadEnabledRuleset(runtime().db, one)).toThrow(
      'Ruleset "One rule" has no enabled rules, so a review using it would check nothing and report a clean result for the wrong reason.',
    );
  });
});
