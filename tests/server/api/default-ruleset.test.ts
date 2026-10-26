/**
 * The ruleset a new review starts on (D-225): chosen on a ruleset's page,
 * kept as a setting that names a ruleset that is there or none, and read
 * as none once that ruleset is gone.
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

async function listed(): Promise<{ rulesets: { id: string }[]; defaultRulesetId: string | null }> {
  const { GET } = await import("@/app/api/rulesets/route");
  return (await GET()).json();
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
    // Deleting all data takes the rulesets and leaves the setting.
    const { runtime } = await import("@/server/runtime");
    const { writeSetting, SETTING_KEYS } = await import("@/server/db/repositories/settings");
    writeSetting(runtime().db, SETTING_KEYS.defaultRulesetId, "GONE-SINCE");
    expect((await listed()).defaultRulesetId).toBeNull();
  });
});
