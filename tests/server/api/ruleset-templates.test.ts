/**
 * The shelf as the app lists it (RT-1), read from the repository's own
 * `templates/` folder, and a ruleset started from a template on it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/ruleset-templates/route";

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-templates-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function used(slug: string, body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/ruleset-templates/[slug]/use/route");
  return POST(new Request("http://local/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });
}

async function detail(id: string) {
  const { GET: read } = await import("@/app/api/rulesets/[id]/route");
  const answer = await read(new Request("http://local/x"), { params: Promise.resolve({ id }) });
  return answer.json() as Promise<{
    ruleset: { name: string; tier: string; version: number; sourceDoc: string | null };
    directives: unknown[];
    rules: { code: string; enabled: boolean; sweepPatterns: string[] }[];
  }>;
}

async function stored(): Promise<{ name: string }[]> {
  const { GET: list } = await import("@/app/api/rulesets/route");
  return ((await (await list()).json()) as { rulesets: { name: string }[] }).rulesets;
}

describe("GET /api/ruleset-templates", () => {
  it("lists the shelf this repository ships, each template not yet run against a model", async () => {
    const listed = await GET();
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      templates: [
        {
          slug: "general",
          name: "General",
          purpose:
            "What any change is held to, whatever it is written in: a failure hidden, input " +
            "trusted, a credential or personal data exposed, a resource left open, behaviour " +
            "changed with nothing to prove it, work left unfinished.",
          version: 1,
          modelRun: null,
          ruleCount: 12,
        },
        {
          slug: "typescript",
          name: "TypeScript",
          purpose:
            "Where a change makes the compiler prove less than the code assumes: a value " +
            "declared or asserted past the type checker, a check silenced, a promise nobody " +
            "waits for, a union or a lookup the code does not cover.",
          version: 1,
          modelRun: null,
          ruleCount: 9,
        },
        {
          slug: "react",
          name: "React",
          purpose:
            "Where a change tells React less than is true, or leaves a person unable to use " +
            "what was drawn: a hook called out of order, an effect gone stale or left running, " +
            "state that disagrees with itself, a list keyed by position, a control the keyboard " +
            "cannot reach.",
          version: 1,
          modelRun: null,
          ruleCount: 8,
        },
      ],
    });
  });
});

describe("POST /api/ruleset-templates/[slug]/use", () => {
  it("starts a ruleset the person owns from the template, under its name, saying where it came from", async () => {
    const made = await used("general", { tier: "global" });
    expect(made.status).toBe(201);
    const { rulesetId, version } = (await made.json()) as { rulesetId: string; version: number };
    expect(version).toBe(1);

    const ruleset = await detail(rulesetId);
    expect(ruleset.ruleset).toEqual(
      expect.objectContaining({
        name: "General",
        tier: "global",
        version: 1,
        sourceDoc: "the General template, version 1",
      }),
    );
    expect(ruleset.rules).toHaveLength(12);
    expect(ruleset.rules.every((rule) => rule.enabled)).toBe(true);
    expect(ruleset.rules.find((rule) => rule.code === "5")!.sweepPatterns).toHaveLength(4);
    expect(ruleset.directives).toHaveLength(11);
  });

  it("takes a name and a tier of the person's own", async () => {
    const made = await used("general", { name: "  House rules  ", tier: "project" });
    expect(made.status).toBe(201);
    const { rulesetId } = (await made.json()) as { rulesetId: string };
    expect((await detail(rulesetId)).ruleset).toEqual(
      expect.objectContaining({ name: "House rules", tier: "project" }),
    );
  });

  it("refuses a name another ruleset has, in words, and changes nothing", async () => {
    const before = await stored();
    const again = await used("general", { tier: "tech" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error:
        'A ruleset called "General" already exists. Give the new one another name, ' +
        'or open "General" and add rules there.',
      code: "RulesetNameTakenError",
    });
    expect(await stored()).toEqual(before);
  });

  it("answers a template that is not on the shelf with a 404, and a body out of shape with a 400", async () => {
    const before = await stored();
    const missing = await used("no-such-template", { tier: "global" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'No template called "no-such-template" is on the shelf.',
      code: "TemplateNotFound",
    });
    for (const body of [{}, { tier: "team" }, { tier: "global", name: "   " }]) {
      const refused = await used("general", body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(((await refused.json()) as { code: string }).code).toBe("Invalid");
    }
    expect(await stored()).toEqual(before);
  });
});
