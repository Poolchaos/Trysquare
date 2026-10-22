/**
 * Where the CLI reads a managed policy, which outranks every flag the app
 * passes, `--setting-sources ""` included (D-174 item 3). Read from the
 * 2.1.306 binary: a managed-settings.json, the .json files of a
 * managed-settings.d beside it, and on Windows a registry value.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findManagedPolicy } from "@/server/engine/managed-policy";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trysquare-managed-policy-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a managed policy", () => {
  it("is not found where there is none", async () => {
    expect(await findManagedPolicy({ platform: "linux", dir })).toEqual({
      found: [],
      unchecked: [],
    });
    expect(
      await findManagedPolicy({ platform: "linux", dir: join(dir, "no-such-folder") }),
    ).toEqual({ found: [], unchecked: [] });
  });

  it("is found in managed-settings.json", async () => {
    writeFileSync(join(dir, "managed-settings.json"), "{}");
    expect(await findManagedPolicy({ platform: "linux", dir })).toEqual({
      found: [join(dir, "managed-settings.json")],
      unchecked: [],
    });
  });

  it("is found in each .json file of managed-settings.d, as the CLI picks them", async () => {
    // The CLI skips a name starting with a dot and one not ending .json.
    const dropIns = join(dir, "managed-settings.d");
    mkdirSync(dropIns);
    for (const name of ["20-b.json", "10-a.json", ".hidden.json", "notes.txt"]) {
      writeFileSync(join(dropIns, name), "{}");
    }
    mkdirSync(join(dropIns, "folder.json"));
    expect(await findManagedPolicy({ platform: "linux", dir })).toEqual({
      found: [join(dropIns, "10-a.json"), join(dropIns, "20-b.json")],
      unchecked: [],
    });
  });

  it("is not a folder named as the file", async () => {
    mkdirSync(join(dir, "managed-settings.json"));
    expect(await findManagedPolicy({ platform: "linux", dir })).toEqual({
      found: [],
      unchecked: [],
    });
  });

  it("says where it could not look, rather than finding nothing there", async () => {
    // A path no file system takes stands in for one this user cannot read.
    const unreadable = `${dir}\0`;
    const { found, unchecked } = await findManagedPolicy({ platform: "linux", dir: unreadable });
    expect(found).toEqual([]);
    expect(unchecked).toHaveLength(2);
    expect(unchecked[0]).toContain("managed-settings.json");
    expect(unchecked[1]).toContain("managed-settings.d");
  });

  it.runIf(process.platform === "win32")(
    "is found in the registry on Windows, as reg.exe answers for each key",
    async () => {
      // A value every Windows has, and a key none does, read by the real reg.exe.
      const present = String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`;
      const absent = String.raw`HKLM\SOFTWARE\Policies\NoSuchVendorTrysquareTest`;
      expect(
        await findManagedPolicy({
          platform: "win32",
          dir,
          registry: { keys: [present, absent], value: "ProductName" },
        }),
      ).toEqual({ found: [String.raw`${present}\ProductName`], unchecked: [] });
    },
  );

  it("asks no registry off Windows", async () => {
    expect(
      await findManagedPolicy({
        platform: "linux",
        dir,
        registry: {
          keys: [String.raw`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`],
          value: "ProductName",
        },
      }),
    ).toEqual({ found: [], unchecked: [] });
  });
});
