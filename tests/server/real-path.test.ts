/**
 * A real path, with the fallback the native realpath needs on Windows RAM
 * and virtual disks (D-144). There is no such disk here, so the native call
 * is stood in for.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realPath } from "@/server/real-path";

const failing = (code: string) => async () => {
  throw Object.assign(new Error(`${code}: stood in for this test`), { code });
};

describe("a real path", () => {
  it("is the native answer when the native call gives one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trysquare-real-"));
    try {
      const file = join(dir, "file.txt");
      writeFileSync(file, "x", "utf8");
      expect(await realPath(file)).toBe(realpathSync.native(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("walks the path itself when the native call says EISDIR, as it does on a RAM disk", async () => {
    // Every file read on such a disk answered "could not be read", with a
    // Try again that could never work (D-144).
    const walked = await realPath(
      "R:/data/file.txt",
      failing("EISDIR"),
      async (path) => `${path}!`,
    );
    expect(walked).toBe("R:/data/file.txt!");
  });

  it("passes on any other failure, which is the read's to answer", async () => {
    await expect(
      realPath("R:/data/gone.txt", failing("ENOENT"), async () => "never"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
