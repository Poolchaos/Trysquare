/**
 * A ruleset started in the app with no document (RA-6): a name and a tier,
 * no rule and no directive. It has no document to export until a rule is
 * written into it, and from then on its export reads back as what is stored.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";

const FIRST = "### 1. Left-In Logging\n\n**Rule:** Flag a console call left in.\n";
const SECOND = "### 2. Unchecked Cast\n\n**Rule:** Flag a cast nothing checks.\n";

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-ruleset-new-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

const at = (id: string) => ({ params: Promise.resolve({ id }) });

async function started(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/rulesets/route");
  return POST(new Request("http://local/x", { method: "POST", body: JSON.stringify(body) }));
}

async function listed(): Promise<{ id: string; name: string; tier: string; ruleCount: number }[]> {
  const { GET } = await import("@/app/api/rulesets/route");
  return ((await (await GET()).json()) as { rulesets: never[] }).rulesets;
}

async function detail(id: string) {
  const { GET } = await import("@/app/api/rulesets/[id]/route");
  return (await GET(new Request("http://local/x"), at(id))).json() as Promise<{
    ruleset: { name: string; tier: string; version: number; sourceDoc: string | null };
    directives: unknown[];
    rules: { code: string; group: string; tags: string[]; raw: string }[];
  }>;
}

async function add(id: string, markdown: string, version: number): Promise<Response> {
  const { POST } = await import("@/app/api/rulesets/[id]/rules/route");
  return POST(
    new Request("http://local/x", { method: "POST", body: JSON.stringify({ markdown, version }) }),
    at(id),
  );
}

async function remove(id: string, code: string, version: number): Promise<Response> {
  const { DELETE } = await import("@/app/api/rulesets/[id]/rules/[code]/route");
  return DELETE(new Request(`http://local/x?version=${version}`, { method: "DELETE" }), {
    params: Promise.resolve({ id, code }),
  });
}

async function importing(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/rulesets/import/route");
  return POST(new Request("http://local/x", { method: "POST", body: JSON.stringify(body) }));
}

async function exported(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/rulesets/[id]/export/route");
  return GET(new Request("http://local/x"), at(id));
}

/** Whether importing this document under the name would change what is stored. */
async function differs(name: string, document: string): Promise<boolean> {
  const { runtime } = await import("@/server/runtime");
  const { rulesetAnImportWouldReplace } = await import("@/server/db/repositories/rulesets");
  const read = importProtocol(document);
  expect(read.coverage.unmapped.filter((entry) => entry.text.trim() !== "")).toEqual([]);
  return rulesetAnImportWouldReplace(runtime().db, name, read.ruleset) !== undefined;
}

describe("a ruleset started with no document", () => {
  it("is made from a name and a tier, at version 1, with no rule and no directive", async () => {
    const made = await started({ name: "  Written here  ", tier: "project" });
    expect(made.status).toBe(201);
    const { rulesetId, version } = (await made.json()) as { rulesetId: string; version: number };
    expect(version).toBe(1);

    expect(await detail(rulesetId)).toMatchObject({
      ruleset: { name: "Written here", tier: "project", version: 1, sourceDoc: null },
      directives: [],
      rules: [],
    });
    expect(await listed()).toEqual([
      expect.objectContaining({
        id: rulesetId,
        name: "Written here",
        tier: "project",
        ruleCount: 0,
      }),
    ]);
  });

  it("is refused under a name another ruleset has, in words, and nothing is made", async () => {
    const before = await listed();
    const again = await started({ name: "Written here", tier: "global" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error:
        'A ruleset called "Written here" already exists. Give the new one another name, ' +
        'or open "Written here" and add rules there.',
      code: "RulesetNameTakenError",
    });
    expect(await listed()).toEqual(before);
  });

  it("is refused with no name, and with a tier that is not one", async () => {
    const before = await listed();
    for (const body of [
      { name: "   ", tier: "global" },
      { tier: "global" },
      { name: "A tier unknown", tier: "team" },
      { name: "No tier" },
    ]) {
      const refused = await started(body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(((await refused.json()) as { code: string }).code).toBe("Invalid");
    }
    expect(await listed()).toEqual(before);
  });

  it("has no document to export until it has a rule, and exports what is stored from then on", async () => {
    const made = await started({ name: "From nothing", tier: "global" });
    const { rulesetId } = (await made.json()) as { rulesetId: string };
    const nothing = {
      error:
        '"From nothing" has no rules and no directives, so it has no document to export. ' +
        "Write a rule into it first.",
      code: "NothingToExport",
    };

    // An empty document would be a file of no bytes, and the importer reads
    // one as a directive, which this ruleset does not hold.
    const empty = await exported(rulesetId);
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual(nothing);

    expect((await add(rulesetId, FIRST, 1)).status).toBe(201);
    const one = await exported(rulesetId);
    expect(one.status).toBe(200);
    const first = await one.text();
    expect(first).toBe(FIRST);
    expect(await differs("From nothing", first)).toBe(false);
    // Under no section, as an import of that document has it.
    expect((await detail(rulesetId)).rules).toMatchObject([
      { code: "1", group: "", tags: ["general"], raw: FIRST },
    ]);

    expect((await add(rulesetId, SECOND, 2)).status).toBe(201);
    const both = await (await exported(rulesetId)).text();
    expect(both).toBe(`${FIRST}\n${SECOND}`);
    expect(await differs("From nothing", both)).toBe(false);

    // Emptied again by removing every rule, it is where it started.
    expect((await remove(rulesetId, "1", 3)).status).toBe(200);
    expect((await remove(rulesetId, "2", 4)).status).toBe(200);
    const emptied = await exported(rulesetId);
    expect(emptied.status).toBe(409);
    expect(await emptied.json()).toEqual(nothing);
  });

  it("takes a document imported under its name without asking, while it holds nothing to replace", async () => {
    const name = "Filled by import";
    const made = await started({ name, tier: "project" });
    const { rulesetId } = (await made.json()) as { rulesetId: string };

    // The question warns of rules replaced and of switches and severities
    // undone, and a ruleset with no rule and no directive has none of them.
    const filled = await importing({
      name,
      tier: "tech",
      markdown: `# Team rules\n\n## Hygiene\n\n${FIRST}`,
    });
    expect(filled.status).toBe(201);
    expect(await filled.json()).toMatchObject({
      rulesetId,
      version: 2,
      changed: true,
      rules: 1,
      directives: 2,
    });
    expect(await detail(rulesetId)).toMatchObject({
      ruleset: { name, tier: "tech", version: 2 },
      rules: [{ code: "1", group: "Hygiene" }],
    });

    // It holds a rule now, so another document under its name is asked about.
    const other = await importing({
      name,
      tier: "tech",
      markdown: `# Team rules\n\n## Hygiene\n\n${SECOND}`,
    });
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({
      error:
        `A ruleset called "${name}" already exists, at version 2, and this document differs ` +
        "from it. Importing replaces its rules with the document's, and undoes any rule " +
        "switched off or re-graded since.",
      code: "RulesetExists",
      rulesetId,
    });
    expect((await detail(rulesetId)).rules.map((rule) => rule.code)).toEqual(["1"]);
  });
});
