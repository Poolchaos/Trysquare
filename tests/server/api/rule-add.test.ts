/**
 * Adding a rule in the app (RA-3): the block goes into the ruleset's
 * document after the rule named and is read there as an import reads it, so
 * its section, tags and sweep patterns are the document's, and the document
 * an export writes reads back as exactly what is stored.
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

const FRESH = "### 15. Fresh Rule\n\n**Rule:** Flag it.\n\n**Severity:** CRITICAL\n";

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
    group: string;
    raw: string;
  }[];
}

async function detail(rulesetId = id): Promise<Detail> {
  const { GET } = await import("@/app/api/rulesets/[id]/route");
  return (
    await GET(new Request("http://local/x"), { params: Promise.resolve({ id: rulesetId }) })
  ).json();
}

async function add(
  body: { markdown: string; version: number; after?: string },
  rulesetId = id,
): Promise<Response> {
  const { POST } = await import("@/app/api/rulesets/[id]/rules/route");
  return POST(new Request("http://local/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: rulesetId }),
  });
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
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-rule-add-"));
  process.env.TRYSQUARE_DATA = dataDir;
  id = await imported("Example protocol", EXAMPLE);
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("adding a rule", () => {
  it("puts it after the rule named, in that rule's section, a past review keeping its own", async () => {
    const { runtime } = await import("@/server/runtime");
    const { readReviewSnapshot, writeReviewSnapshot } =
      await import("@/server/db/repositories/rulesets");
    const { db } = runtime();
    const reviewId = seedReview(db, seedProject(db).id).id;
    writeReviewSnapshot(db, reviewId, id);

    const before = await detail();
    const made = await add({ markdown: FRESH, version: before.ruleset.version, after: "4" });
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({
      version: before.ruleset.version + 1,
      code: "15",
      sweeps: [],
    });

    const after = await detail();
    expect(after.ruleset.version).toBe(before.ruleset.version + 1);
    const codes = before.rules.map((rule) => rule.code);
    codes.splice(codes.indexOf("4") + 1, 0, "15");
    expect(after.rules.map((rule) => rule.code)).toEqual(codes);
    const neighbour = after.rules.find((rule) => rule.code === "4")!;
    expect(after.rules.find((rule) => rule.code === "15")).toEqual({
      code: "15",
      title: "Fresh Rule",
      severity: "CRITICAL",
      // The section's, as an import reads them: "Typing Anti-Patterns".
      tags: neighbour.tags,
      group: neighbour.group,
      sweepPatterns: [],
      enabled: true,
      text: "**Rule:** Flag it.\n\n**Severity:** CRITICAL",
      raw: FRESH,
    });
    expect(neighbour.group).toBe("Typing Anti-Patterns");
    // Every other rule as it was.
    expect(after.rules.filter((rule) => rule.code !== "15")).toEqual(before.rules);

    // The document an export writes holds the rule where it was put, loses
    // no line, and is what is stored: importing it would change nothing.
    const out = await exported(id, "Example protocol");
    expect(out.read.ruleset.rules.map((rule) => rule.code)).toEqual(codes);
    expect(out.read.coverage.unmapped).toEqual([]);
    expect(out.differs).toBe(false);
    expect(out.document).toContain(`${neighbour.raw}\n${FRESH}\n## Lifecycle Anti-Patterns`);

    expect(readReviewSnapshot(db, reviewId).rules.map((rule) => rule.code)).toEqual(
      before.rules.map((rule) => rule.code),
    );
  });

  it("puts it after the last rule when none is named, before what the document ends on", async () => {
    const before = await detail();
    const last = before.rules.at(-1)!;
    const made = await add({
      markdown: "### 16. Last Rule\n\n**Rule:** Flag it too.\n",
      version: before.ruleset.version,
    });
    expect(made.status).toBe(201);
    const after = await detail();
    expect(after.rules.at(-1)).toMatchObject({ code: "16", group: last.group, tags: last.tags });
    const out = await exported(id, "Example protocol");
    expect(out.differs).toBe(false);
    expect(out.document).toContain(
      "### 16. Last Rule\n\n**Rule:** Flag it too.\n\n## Review Output",
    );
  });

  it("takes the sweep patterns the document's table lists under its code", async () => {
    const swept = await imported(
      "Swept",
      [
        "# Swept",
        "",
        "## Mandatory Mechanical Sweeps",
        "",
        "| Sweep for | What a hit means |",
        "| --- | --- |",
        "| `debugger` | Rule 2: left in |",
        "",
        "## Hygiene",
        "",
        "### 1. First",
        "",
        "**Rule:** Flag it.",
        "",
      ].join("\n"),
    );
    const made = await add(
      { markdown: "### 2. Debugger Left In\n\n**Rule:** Flag it.\n", version: 1 },
      swept,
    );
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({
      version: 2,
      code: "2",
      sweeps: [{ code: "2", patterns: ["debugger"], had: 0 }],
    });
    expect((await detail(swept)).rules.at(-1)).toMatchObject({
      code: "2",
      sweepPatterns: ["debugger"],
      group: "Hygiene",
    });
    expect((await exported(swept, "Swept")).differs).toBe(false);
  });

  it("starts a ruleset that has no rule yet, under the section its document ends on", async () => {
    const { runtime } = await import("@/server/runtime");
    const { saveImportedRuleset } = await import("@/server/db/repositories/rulesets");
    const empty = saveImportedRuleset(runtime().db, {
      name: "Empty",
      tier: "project",
      imported: importProtocol("# Empty\n\n## Typing\n\nNothing yet.\n").ruleset,
    }).rulesetId;
    const made = await add({ markdown: "### 1. First\n\n**Rule:** Flag it.\n", version: 1 }, empty);
    expect(made.status).toBe(201);
    expect((await detail(empty)).rules).toMatchObject([
      { code: "1", group: "Typing", tags: ["typescript"] },
    ]);
    const out = await exported(empty, "Empty");
    expect(out.differs).toBe(false);
    expect(out.document).toBe(
      "# Empty\n\n## Typing\n\nNothing yet.\n\n### 1. First\n\n**Rule:** Flag it.\n",
    );
  });

  it("refuses a code another rule has, and a version since replaced, saving nothing", async () => {
    const before = await detail();
    const taken = await add({
      markdown: FRESH.replace("### 15.", "### 9."),
      version: before.ruleset.version,
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({
      error:
        'Ruleset "Example protocol" already has a rule 9. Give this one a code no other rule has.',
      code: "RuleCodeTakenError",
    });

    const stale = await add({
      markdown: FRESH.replace("### 15.", "### 17."),
      version: before.ruleset.version - 1,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("RulesetChangedError");
    expect(await detail()).toEqual(before);
  });

  it("refuses a block that is not one rule, and one still holding the starting text", async () => {
    const { startingRuleBlock } = await import("@/lib/rulesets/rule-edit");
    const before = await detail();
    const none = await add({ markdown: "Flag it.", version: before.ruleset.version });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { code: string }).code).toBe("RuleTextRefused");

    const starting = startingRuleBlock(before.rules.map((rule) => rule.code));
    expect(starting.startsWith("### 17. ")).toBe(true);
    const untouched = await add({ markdown: starting, version: before.ruleset.version });
    expect(untouched.status).toBe(400);
    expect(await untouched.json()).toEqual({
      error:
        "Line 1 still holds the starting text. Write the rule's own there, or take that part out.",
      code: "RuleTextRefused",
    });
    expect(await detail()).toEqual(before);
  });

  it("answers a rule to go after that is not there with a 404", async () => {
    const before = await detail();
    const missing = await add({
      markdown: FRESH.replace("### 15.", "### 17."),
      version: before.ruleset.version,
      after: "99",
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'Ruleset "Example protocol" has no rule 99.',
      code: "RuleNotFoundError",
    });
  });

  it("refuses to follow a rule that leaves a code fence open, where it would read as code", async () => {
    // An import takes an open fence in a document's last block: nothing
    // follows it there to be read into it.
    const open = await imported(
      "Open fence",
      "# Open\n\n## Hygiene\n\n### 1. First\n\n**Rule:** Flag it.\n\n```ts\nconst open = 1;\n",
    );
    const refused = await add(
      { markdown: "### 2. Second\n\n**Rule:** Flag it.\n", version: 1 },
      open,
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error:
        "Rule 1 leaves a code fence open, so a rule put after it would read as code in the ruleset's document. Close the fence in rule 1's text first.",
      code: "RuleFenceOpenError",
    });
    expect((await detail(open)).rules.map((rule) => rule.code)).toEqual(["1"]);
  });
});
