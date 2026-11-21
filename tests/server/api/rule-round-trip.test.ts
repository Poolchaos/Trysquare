/**
 * The round trip (RA-5): whatever is changed in the app, the document an
 * export writes reads back as exactly what is stored, line numbers and sweep
 * patterns too, so importing one's own export changes nothing.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);

const FRESH = "### 15. Fresh Rule\n\n**Rule:** Flag it.\n\n**Severity:** CRITICAL\n";

let dataDir: string;

interface Detail {
  ruleset: { version: number };
  rules: { code: string; sweepPatterns: string[]; raw: string }[];
}

async function detail(id: string): Promise<Detail> {
  const { GET } = await import("@/app/api/rulesets/[id]/route");
  return (await GET(new Request("http://local/x"), { params: Promise.resolve({ id }) })).json();
}

async function ruleOf(id: string, code: string) {
  return (await detail(id)).rules.find((rule) => rule.code === code)!;
}

async function save(id: string, code: string, markdown: string): Promise<Response> {
  const { PUT } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
  const { version } = (await detail(id)).ruleset;
  return PUT(
    new Request("http://local/x", { method: "PUT", body: JSON.stringify({ markdown, version }) }),
    { params: Promise.resolve({ id, code }) },
  );
}

async function add(id: string, markdown: string, after: string): Promise<Response> {
  const { POST } = await import("@/app/api/rulesets/[id]/rules/route");
  const { version } = (await detail(id)).ruleset;
  return POST(
    new Request("http://local/x", {
      method: "POST",
      body: JSON.stringify({ markdown, version, after }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function remove(id: string, code: string): Promise<Response> {
  const { DELETE } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
  const { version } = (await detail(id)).ruleset;
  return DELETE(new Request(`http://local/x?version=${version}`, { method: "DELETE" }), {
    params: Promise.resolve({ id, code }),
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
async function exported(id: string, name: string) {
  const { GET } = await import("@/app/api/rulesets/[id]/export/route");
  const document = await (
    await GET(new Request("http://local/x"), { params: Promise.resolve({ id }) })
  ).text();
  const { runtime } = await import("@/server/runtime");
  const { rulesetAnImportWouldReplace } = await import("@/server/db/repositories/rulesets");
  const read = importProtocol(document);
  return {
    document,
    unmapped: read.coverage.unmapped,
    differs: rulesetAnImportWouldReplace(runtime().db, name, read.ruleset) !== undefined,
  };
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-rule-round-trip-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

describe("a ruleset changed in the app", () => {
  it("exports a document that reads back as what is stored, after each change", async () => {
    const name = "Example protocol";
    const id = await imported(name, EXAMPLE);
    let expected = EXAMPLE;
    const holds = async (step: string) => {
      const out = await exported(id, name);
      expect(out.document, step).toBe(expected);
      expect(out.unmapped, step).toEqual([]);
      expect(out.differs, step).toBe(false);
    };

    // Saved three lines longer: the blocks after it are three lines further down.
    const grown = (await ruleOf(id, "2a")).raw;
    const longer = `${grown}One more line.\nAnd another.\n\n`;
    expect((await save(id, "2a", longer)).status).toBe(200);
    expected = expected.replace(grown, () => longer);
    await holds("a rule saved longer");

    // Saved shorter: they come back up.
    const cut = (await ruleOf(id, "9")).raw;
    const shorter = cut.split("\n").slice(0, 3).concat("").join("\n");
    expect(shorter.split("\n").length).toBeLessThan(cut.split("\n").length);
    expect((await save(id, "9", shorter)).status).toBe(200);
    expected = expected.replace(cut, () => shorter);
    await holds("a rule saved shorter");

    const neighbour = (await ruleOf(id, "4")).raw;
    expect((await add(id, FRESH, "4")).status).toBe(201);
    expected = expected.replace(neighbour, () => `${neighbour}\n${FRESH}`);
    await holds("a rule added");

    const gone = (await ruleOf(id, "6")).raw;
    expect((await remove(id, "6")).status).toBe(200);
    expected = expected.replace(`${gone}\n`, () => "");
    await holds("a rule removed");

    // After the removal, a save: every number above it has moved twice.
    const last = (await ruleOf(id, "14")).raw;
    expect((await save(id, "14", `${last}A closing line.\n`)).status).toBe(200);
    expected = expected.replace(last, () => `${last}A closing line.\n`);
    await holds("a rule saved after the others");
  });

  it("gives a rule the sweep pattern a row in another rule's text names it in, and takes it back with the row", async () => {
    const name = "Example protocol, rows";
    const id = await imported(name, EXAMPLE);
    expect((await ruleOf(id, "5")).sweepPatterns).toEqual(["setTimeout"]);

    // To an import a table row with a pattern in backticks is a sweep row,
    // wherever in the document it stands.
    const host = (await ruleOf(id, "4")).raw;
    const row =
      "| Sweep for | What a hit means |\n| --- | --- |\n| `setInterval` | Rule 5: missing cleanup |\n";
    const saved = await save(id, "4", `${host}\n${row}`);
    expect(saved.status).toBe(200);
    // Said in the answer, for the page to say: another rule's patterns moved.
    expect(await saved.json()).toEqual({
      version: 2,
      code: "4",
      sweeps: [{ code: "5", patterns: ["setTimeout", "setInterval"], had: 1 }],
    });
    expect((await ruleOf(id, "5")).sweepPatterns).toEqual(["setTimeout", "setInterval"]);
    expect((await exported(id, name)).differs).toBe(false);

    const removed = await remove(id, "4");
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      version: 3,
      sweeps: [{ code: "5", patterns: ["setTimeout"], had: 2 }],
    });
    expect((await ruleOf(id, "5")).sweepPatterns).toEqual(["setTimeout"]);
    expect((await exported(id, name)).differs).toBe(false);
  });

  it("holds a rule's code while a sweep row names it, and lets it change with the row", async () => {
    const name = "Own row";
    const second = [
      "### 2. Debugger Left In",
      "",
      "**Rule:** Flag it.",
      "",
      "| Sweep for | What a hit means |",
      "| --- | --- |",
      "| `debugger` | Rule 2 |",
      "",
    ].join("\n");
    const id = await imported(
      name,
      `# Own row\n\n## Hygiene\n\n### 1. First\n\n**Rule:** Flag it.\n\n${second}`,
    );
    expect((await ruleOf(id, "2")).sweepPatterns).toEqual(["debugger"]);

    const held = await save(id, "2", second.replace("### 2.", "### 2a."));
    expect(held.status).toBe(409);
    expect(await held.json()).toEqual({
      error:
        "Rule 2 was not saved as 2a: table rows list its sweep patterns under 2, and under 2a it would lose them. Rows in the rule's own text can change with its heading. For rows elsewhere, change the code in the exported document and import that.",
      code: "RuleCodeHeldError",
    });

    const moved = await save(
      id,
      "2",
      second.replace("### 2.", "### 2a.").replace("Rule 2 |", "Rule 2a |"),
    );
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({ version: 2, code: "2a", sweeps: [] });
    expect((await ruleOf(id, "2a")).sweepPatterns).toEqual(["debugger"]);
    expect((await exported(id, name)).differs).toBe(false);
  });

  it("puts right a ruleset whose line numbers an earlier save left untrue", async () => {
    const name = "Example protocol, saved before";
    const id = await imported(name, EXAMPLE);
    // As a save stored it before RA-5: the rule three lines longer, its end
    // moved, and every block after it where it was.
    const { and, eq } = await import("drizzle-orm");
    const { runtime } = await import("@/server/runtime");
    const { rules } = await import("@/server/db/schema");
    const { db } = runtime();
    const grown = db
      .select()
      .from(rules)
      .where(and(eq(rules.rulesetId, id), eq(rules.code, "2a")))
      .get()!;
    db.update(rules)
      .set({
        rawMarkdown: `${grown.rawMarkdown}One more line.\nAnd another.\n\n`,
        sourceEndLine: grown.sourceEndLine + 3,
      })
      .where(eq(rules.id, grown.id))
      .run();
    expect((await exported(id, name)).differs).toBe(true);

    const last = (await ruleOf(id, "14")).raw;
    expect((await save(id, "14", `${last}A closing line.\n`)).status).toBe(200);
    const out = await exported(id, name);
    expect(out.differs).toBe(false);
    expect(out.document).toBe(
      EXAMPLE.replace(
        grown.rawMarkdown,
        () => `${grown.rawMarkdown}One more line.\nAnd another.\n\n`,
      ).replace(last, () => `${last}A closing line.\n`),
    );
  });

  it("removes a rule that is the whole of its document", async () => {
    const id = await imported("Only", "### 1. Only\n\n**Rule:** Flag it.\n");
    expect((await remove(id, "1")).status).toBe(200);
    expect((await detail(id)).rules).toEqual([]);
    expect((await exported(id, "Only")).document).toBe("");
  });

  it("refuses a rule put after a directive that leaves a code fence open, saving nothing", async () => {
    // With the one rule removed a new rule goes to the document's end, where
    // it would be read into the fence. A directive is not edited in the app.
    const id = await imported(
      "Open end",
      "# Open end\n\n### 1. First\n\n**Rule:** Flag it.\n\n## Notes\n\n```\nnever closed\n",
    );
    expect((await remove(id, "1")).status).toBe(200);
    const before = await detail(id);

    const { POST } = await import("@/app/api/rulesets/[id]/rules/route");
    const refused = await POST(
      new Request("http://local/x", {
        method: "POST",
        body: JSON.stringify({
          markdown: "### 2. Second\n\n**Rule:** Flag it.\n",
          version: before.ruleset.version,
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error:
        "The ruleset's document ends on a code fence left open, so a rule put after it would read as code. Close the fence in the document and import it again.",
      code: "RuleFenceOpenError",
    });
    expect(await detail(id)).toEqual(before);
  });
});
