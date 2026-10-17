import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { readSetting, writeSettings } from "@/server/db/repositories/settings";
import { makeTestDb, type TestDb } from "./helpers";

let ctx: TestDb;
let db: Db;

beforeEach(() => {
  ctx = makeTestDb();
  db = ctx.db;
});

afterEach(() => ctx.cleanup());

describe("writing several settings", () => {
  it("writes none of them when one cannot be written (D-119 review)", () => {
    // A BigInt is refused by JSON.stringify, after the first key is written.
    expect(() =>
      writeSettings(db, [
        ["first", 1],
        ["second", 1n],
      ]),
    ).toThrow(TypeError);
    expect(readSetting(db, "first", z.number())).toBeUndefined();
  });

  it("writes them all otherwise", () => {
    writeSettings(db, [
      ["first", 1],
      ["second", 2],
    ]);
    expect(readSetting(db, "first", z.number())).toBe(1);
    expect(readSetting(db, "second", z.number())).toBe(2);
  });
});
