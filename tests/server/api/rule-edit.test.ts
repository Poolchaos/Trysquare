/**
 * Saving a rule's text (RA-2): the block is read as an import reads it, the
 * rule keeps its place, what the document around it gave it, and a severity
 * changed in the app, and a review already run keeps the rule it ran with.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedProject, seedReview } from "../db/helpers";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);

let dataDir: string;
let id: string;

interface Detail {
  ruleset: { version: number };
  rules: {
    code: string;
    title: string;
    severity: string;
    tags: string[];
    sweepPatterns: string[];
    enabled: boolean;
    raw: string;
  }[];
}

async function detail(): Promise<Detail> {
  const { GET } = await import("@/app/api/rulesets/[id]/route");
  return (await GET(new Request("http://local/x"), { params: Promise.resolve({ id }) })).json();
}

async function ruleOf(code: string) {
  return (await detail()).rules.find((rule) => rule.code === code)!;
}

async function save(code: string, markdown: string, version: number): Promise<Response> {
  const { PUT } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
  return PUT(
    new Request("http://local/x", { method: "PUT", body: JSON.stringify({ markdown, version }) }),
    { params: Promise.resolve({ id, code }) },
  );
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-rule-edit-"));
  process.env.TRYSQUARE_DATA = dataDir;
  const { POST } = await import("@/app/api/rulesets/import/route");
  const made = await POST(
    new Request("http://local/api/rulesets/import", {
      method: "POST",
      body: JSON.stringify({ name: "Example protocol", tier: "global", markdown: EXAMPLE }),
    }),
  );
  expect(made.status).toBe(201);
  const { GET } = await import("@/app/api/rulesets/route");
  id = ((await (await GET()).json()) as { rulesets: { id: string }[] }).rulesets[0]!.id;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("saving a rule's text", () => {
  it("changes the rule where it stands and moves the version, a past review keeping its own", async () => {
    const { runtime } = await import("@/server/runtime");
    const { readReviewSnapshot, writeReviewSnapshot } =
      await import("@/server/db/repositories/rulesets");
    const { db } = runtime();
    const reviewId = seedReview(db, seedProject(db).id).id;
    writeReviewSnapshot(db, reviewId, id);

    const before = await detail();
    const rule = before.rules.find((entry) => entry.code === "2a")!;
    const edited = rule.raw.replace("### 2a. Silent Fallback", "### 2a. Silent Fallback Value");
    expect(edited).not.toBe(rule.raw);

    const saved = await save("2a", `${edited}\nA line added in the app.\n`, before.ruleset.version);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ version: before.ruleset.version + 1, code: "2a" });

    const after = await detail();
    expect(after.ruleset.version).toBe(before.ruleset.version + 1);
    expect(after.rules.map((entry) => entry.code)).toEqual(before.rules.map((entry) => entry.code));
    const now = after.rules.find((entry) => entry.code === "2a")!;
    expect(now.title).toBe("Silent Fallback Value");
    expect(now.raw).toBe(`${edited}\nA line added in the app.\n`);
    // Its group's tags, which a block read alone would lose.
    expect(now.tags).toEqual(rule.tags);
    expect(now.enabled).toBe(true);

    const frozen = readReviewSnapshot(db, reviewId).rules.find((entry) => entry.code === "2a")!;
    expect(frozen.raw).toBe(rule.raw);
  });

  it("saves nothing, and moves no version, when the text is as it was", async () => {
    const before = await detail();
    const rule = before.rules.find((entry) => entry.code === "4")!;
    const saved = await save("4", rule.raw, before.ruleset.version);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ version: before.ruleset.version, code: "4" });
  });

  it("keeps the sweep patterns the document's table gave the rule", async () => {
    const before = await detail();
    const rule = before.rules.find((entry) => entry.code === "3")!;
    expect(rule.sweepPatterns.length).toBeGreaterThan(0);
    const saved = await save(
      "3",
      `${rule.raw}\nCasts in tests count too.\n`,
      before.ruleset.version,
    );
    expect(saved.status).toBe(200);
    expect((await ruleOf("3")).sweepPatterns).toEqual(rule.sweepPatterns);
  });

  it("keeps a severity changed in the app unless the text's own severity line changed", async () => {
    // Rule 5's text says WARNING. Promoted with the picker, the text still
    // says WARNING: an edit elsewhere in it must not demote the rule.
    const { PATCH } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
    const promoted = await PATCH(
      new Request("http://local/x", {
        method: "PATCH",
        body: JSON.stringify({ severity: "CRITICAL" }),
      }),
      { params: Promise.resolve({ id, code: "5" }) },
    );
    expect(promoted.status).toBe(200);
    const rule = await ruleOf("5");
    expect(rule.raw).toContain("**Severity:** WARNING");

    let version = (await detail()).ruleset.version;
    const elsewhere = `${rule.raw}\nIntervals too.\n`;
    expect((await save("5", elsewhere, version)).status).toBe(200);
    expect((await ruleOf("5")).severity).toBe("CRITICAL");

    version = (await detail()).ruleset.version;
    const demoted = elsewhere.replace("**Severity:** WARNING", "**Severity:** NITPICK");
    expect((await save("5", demoted, version)).status).toBe(200);
    expect((await ruleOf("5")).severity).toBe("NITPICK");
  });

  it("refuses a block that is not exactly one rule, in the parser's words, saving nothing", async () => {
    const before = await detail();
    const rule = before.rules.find((entry) => entry.code === "4")!;
    const refused = await save("4", `A note to self.\n${rule.raw}`, before.ruleset.version);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error:
        "Line 1 comes before the rule's heading, so it would belong to no rule. Start with the heading.",
      code: "RuleTextRefused",
    });
    expect(await detail()).toEqual(before);
  });

  it("refuses a code fence left open, which the rules after it would be read into", async () => {
    const before = await detail();
    const rule = before.rules.find((entry) => entry.code === "4")!;
    const refused = await save(
      "4",
      `${rule.raw}\n\`\`\`ts\nconst open = 1;\n`,
      before.ruleset.version,
    );
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toMatch(
      /^Line \d+ opens a code fence that is never closed/,
    );
    expect(await detail()).toEqual(before);
  });

  it("refuses a save made from a version since replaced", async () => {
    const before = await detail();
    const rule = before.rules.find((entry) => entry.code === "4")!;
    const stale = await save("4", `${rule.raw}\nLate.\n`, before.ruleset.version - 1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error:
        "This ruleset changed since you opened it: it is at version " +
        `${before.ruleset.version}, and this edit was made from version ${before.ruleset.version - 1}. ` +
        "Read it again before saving, so the other change is not undone.",
      code: "RulesetChangedError",
    });
    expect(await detail()).toEqual(before);
  });

  it("takes a new code that is free, and refuses one another rule has", async () => {
    let before = await detail();
    const rule = before.rules.find((entry) => entry.code === "4")!;
    const taken = await save("4", rule.raw.replace("### 4.", "### 9."), before.ruleset.version);
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe(
      'Ruleset "Example protocol" already has a rule 9. Give this one a code no other rule has.',
    );

    const moved = await save("4", rule.raw.replace("### 4.", "### 4b."), before.ruleset.version);
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({ version: before.ruleset.version + 1, code: "4b" });
    const after = await detail();
    // Renamed where it stood.
    expect(after.rules.map((entry) => entry.code)).toEqual(
      before.rules.map((entry) => (entry.code === "4" ? "4b" : entry.code)),
    );

    // A rule the sweep table names keeps its code: the table says "Rule 6",
    // and under another code an export would hand its patterns to no rule.
    before = after;
    const swept = before.rules.find((entry) => entry.code === "6")!;
    expect(swept.sweepPatterns.length).toBeGreaterThan(0);
    const held = await save("6", swept.raw.replace("### 6.", "### 6a."), before.ruleset.version);
    expect(held.status).toBe(409);
    expect(((await held.json()) as { error: string }).error).toBe(
      "Rule 6 has sweep patterns, which the document's sweep table lists under its code. Its text can change here; its code cannot yet.",
    );
    expect(await detail()).toEqual(before);
  });

  it("answers a rule that is not there with a 404", async () => {
    const version = (await detail()).ruleset.version;
    const missing = await save("99", "### 99. Nothing\n\n**Rule:** None.\n", version);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("RuleNotFoundError");
  });
});
