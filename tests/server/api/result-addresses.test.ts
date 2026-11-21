/**
 * The addresses a review's result is to be emailed to, kept through the
 * settings route (EM-2a): stored, read back, and refused in words when a
 * line is not one address.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir: string;
let route: typeof import("@/app/api/settings/route");

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-result-addresses-"));
  process.env.TRYSQUARE_DATA = dataDir;
  route = await import("@/app/api/settings/route");
});

afterAll(async () => {
  (await import("@/server/runtime")).closeRuntime();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.TRYSQUARE_DATA;
});

const save = (body: object) =>
  route.PUT(
    new Request("http://local/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  );

async function kept(): Promise<string[]> {
  const read = (await (await route.GET()).json()) as { settings: { resultAddresses: string[] } };
  return read.settings.resultAddresses;
}

describe("the addresses a result goes to, through the settings route", () => {
  it("holds none until some are kept", async () => {
    expect(await kept()).toEqual([]);
  });

  it("keeps the addresses in the order given, and answers with them", async () => {
    const saved = await save({
      resultAddresses: [" lead@example.invalid", "team@example.invalid"],
    });
    expect(saved.status).toBe(200);
    expect(
      ((await saved.json()) as { settings: { resultAddresses: string[] } }).settings
        .resultAddresses,
    ).toEqual(["lead@example.invalid", "team@example.invalid"]);
    expect(await kept()).toEqual(["lead@example.invalid", "team@example.invalid"]);
  });

  it("refuses a line that is not one address, in words, and keeps what it had", async () => {
    const before = await kept();
    const named = await save({ resultAddresses: ["Lead <lead@example.invalid>"] });
    expect(named.status).toBe(400);
    expect(await named.json()).toEqual({
      error:
        'The list of addresses holds "Lead <lead@example.invalid>", which is not one email ' +
        "address: enter the address alone, as name@example.com",
      code: "Invalid",
    });
    const broken = await save({
      resultAddresses: ["lead@example.invalid\nBcc: x@example.invalid"],
    });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({
      error: "The list of addresses holds a line break or another control character",
      code: "Invalid",
    });
    expect(await kept()).toEqual(before);
  });

  it("is emptied by an empty list", async () => {
    expect((await save({ resultAddresses: [] })).status).toBe(200);
    expect(await kept()).toEqual([]);
  });
});
