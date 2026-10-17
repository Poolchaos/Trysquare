import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { opaqueChanges } from "@/lib/git/opaque";

const SUBMODULE_MOVED = [
  "diff --git a/vendor/lib b/vendor/lib",
  "index 1111111..2222222 160000",
  "--- a/vendor/lib",
  "+++ b/vendor/lib",
  "@@ -1 +1 @@",
  "-Subproject commit 1111111111111111111111111111111111111111",
  "+Subproject commit 2222222222222222222222222222222222222222",
  "",
].join("\n");

const SUBMODULE_ADDED = [
  "diff --git a/vendor/new b/vendor/new",
  "new file mode 160000",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/vendor/new",
  "@@ -0,0 +1 @@",
  "+Subproject commit 3333333333333333333333333333333333333333",
  "",
].join("\n");

const LFS_POINTER = [
  "diff --git a/assets/model.bin b/assets/model.bin",
  "new file mode 100644",
  "index 0000000..4444444",
  "--- /dev/null",
  "+++ b/assets/model.bin",
  "@@ -0,0 +1,3 @@",
  "+version https://git-lfs.github.com/spec/v1",
  "+oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393",
  "+size 12345",
  "",
].join("\n");

const ORDINARY = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
  "",
].join("\n");

describe("changes whose content the review cannot read (4.23)", () => {
  it("finds a submodule pointer that moved or was added", () => {
    const found = opaqueChanges(parseUnifiedDiff(SUBMODULE_MOVED + SUBMODULE_ADDED));
    expect(found.submodules).toEqual(["vendor/lib", "vendor/new"]);
    expect(found.lfsPointers).toEqual([]);
  });

  it("finds a file stored as a Git LFS pointer", () => {
    expect(opaqueChanges(parseUnifiedDiff(LFS_POINTER)).lfsPointers).toEqual(["assets/model.bin"]);
  });

  it("finds nothing in an ordinary change", () => {
    expect(opaqueChanges(parseUnifiedDiff(ORDINARY))).toEqual({ submodules: [], lfsPointers: [] });
  });
});
