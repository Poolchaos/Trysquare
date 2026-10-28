/**
 * The ruleset a new review starts on (D-225): chosen on a ruleset's page,
 * kept as a setting that names a ruleset that is there or none, stopped only
 * by the one it names, and gone with that ruleset.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EXAMPLE = readFileSync(
  fileURLToPath(new URL("../../fixtures/example-protocol.md", import.meta.url)),
  "utf8",
);

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-default-ruleset-"));
  process.env.TRYSQUARE_DATA = dataDir;
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

async function save(body: object): Promise<Response> {
  const { PUT } = await import("@/app/api/settings/route");
  return PUT(
    new Request("http://local/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  );
}

async function listed(): Promise<{
  rulesets: { id: string; name: string }[];
  defaultRulesetId: string | null;
}> {
  const { GET } = await import("@/app/api/rulesets/route");
  return (await GET()).json();
}

async function settingsRead(): Promise<{ defaultRulesetId: unknown }> {
  const { GET } = await import("@/app/api/settings/route");
  return ((await (await GET()).json()) as { settings: { defaultRulesetId: unknown } }).settings;
}

async function detail(id: string): Promise<{ ruleset: { isDefault: boolean } }> {
  const { GET } = await import("@/app/api/rulesets/[id]/route");
  return (await GET(new Request("http://local/x"), { params: Promise.resolve({ id }) })).json();
}

describe("the default ruleset", () => {
  it("is none until one is chosen, then the one chosen, then none again", async () => {
    const { POST } = await import("@/app/api/rulesets/import/route");
    const imported = await POST(
      new Request("http://local/api/rulesets/import", {
        method: "POST",
        body: JSON.stringify({ name: "Example protocol", tier: "global", markdown: EXAMPLE }),
      }),
    );
    expect(imported.status).toBe(201);
    const [only] = (await listed()).rulesets;
    expect((await listed()).defaultRulesetId).toBeNull();

    expect((await save({ defaultRulesetId: only!.id })).status).toBe(200);
    expect((await listed()).defaultRulesetId).toBe(only!.id);
    expect((await detail(only!.id)).ruleset.isDefault).toBe(true);

    expect((await save({ defaultRulesetId: null })).status).toBe(200);
    expect((await listed()).defaultRulesetId).toBeNull();
    expect((await detail(only!.id)).ruleset.isDefault).toBe(false);
  });

  it("refuses a ruleset that is not there, and keeps what was chosen", async () => {
    const [only] = (await listed()).rulesets;
    await save({ defaultRulesetId: only!.id });
    const refused = await save({ defaultRulesetId: "NO-SUCH-RULESET" });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { code: string }).code).toBe("RulesetNotFoundError");
    expect((await listed()).defaultRulesetId).toBe(only!.id);
  });

  it("reads one that has since gone as none chosen", async () => {
    // A database from before a deleted ruleset took the default with it.
    const { runtime } = await import("@/server/runtime");
    const { writeSetting, SETTING_KEYS } = await import("@/server/db/repositories/settings");
    writeSetting(runtime().db, SETTING_KEYS.defaultRulesetId, "GONE-SINCE");
    expect((await listed()).defaultRulesetId).toBeNull();
    expect((await settingsRead()).defaultRulesetId).toBeNull();
  });

  it("is stopped only by the ruleset it names", async () => {
    // Review round 15: a page read before another tab chose a different
    // default stopped with a plain clear, and cleared that one.
    const { POST } = await import("@/app/api/rulesets/import/route");
    const second = await POST(
      new Request("http://local/api/rulesets/import", {
        method: "POST",
        body: JSON.stringify({ name: "Second protocol", tier: "global", markdown: EXAMPLE }),
      }),
    );
    expect(second.status).toBe(201);
    const { rulesets } = await listed();
    const first = rulesets.find((row) => row.name === "Example protocol")!;
    const other = rulesets.find((row) => row.name === "Second protocol")!;
    const { PUT, DELETE } = await import("@/app/api/rulesets/[id]/default/route");
    const at = (id: string) => ({ params: Promise.resolve({ id }) });
    const asked = (method: string) => new Request("http://local/x", { method });

    expect((await PUT(asked("PUT"), at(other.id))).status).toBe(200);
    expect((await listed()).defaultRulesetId).toBe(other.id);
    expect((await DELETE(asked("DELETE"), at(first.id))).status).toBe(200);
    expect((await listed()).defaultRulesetId).toBe(other.id);
    expect((await DELETE(asked("DELETE"), at(other.id))).status).toBe(200);
    expect((await listed()).defaultRulesetId).toBeNull();
    expect((await PUT(asked("PUT"), at("NO-SUCH-RULESET"))).status).toBe(404);
    expect((await listed()).defaultRulesetId).toBeNull();
  });

  it("goes with its ruleset when all data is deleted", async () => {
    // Review round 15: the wipe took the rulesets and left the setting, which
    // the settings read then reported.
    const [only] = (await listed()).rulesets;
    await save({ defaultRulesetId: only!.id });
    const { DELETE } = await import("@/app/api/system/data/route");
    expect((await DELETE()).status).toBe(200);
    const { runtime } = await import("@/server/runtime");
    const { readSetting, SETTING_KEYS } = await import("@/server/db/repositories/settings");
    const { z } = await import("zod");
    expect(
      readSetting(runtime().db, SETTING_KEYS.defaultRulesetId, z.string().nullable()),
    ).toBeNull();
    expect((await settingsRead()).defaultRulesetId).toBeNull();
  });
});
