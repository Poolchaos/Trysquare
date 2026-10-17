import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { isLfsPointer, opaqueChanges } from "@/lib/git/opaque";

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

const SPEC = "version https://git-lfs.github.com/spec/v1";
const OID_A = "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393";
const OID_B = "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4";

const LFS_ADDED = [
  "diff --git a/assets/model.bin b/assets/model.bin",
  "new file mode 100644",
  "index 0000000..4444444",
  "--- /dev/null",
  "+++ b/assets/model.bin",
  "@@ -0,0 +1,3 @@",
  `+${SPEC}`,
  `+oid sha256:${OID_A}`,
  "+size 12345",
  "",
].join("\n");

/** Only the oid and size move, so the version line is context. */
const LFS_UPDATED = [
  "diff --git a/assets/model.bin b/assets/model.bin",
  "index 4444444..5555555 100644",
  "--- a/assets/model.bin",
  "+++ b/assets/model.bin",
  "@@ -1,3 +1,3 @@",
  ` ${SPEC}`,
  `-oid sha256:${OID_A}`,
  "-size 12345",
  `+oid sha256:${OID_B}`,
  "+size 67890",
  "",
].join("\n");

const LFS_DELETED = [
  "diff --git a/assets/model.bin b/assets/model.bin",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/assets/model.bin",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  `-${SPEC}`,
  `-oid sha256:${OID_A}`,
  "-size 12345",
  "",
].join("\n");

/** A document showing what a pointer looks like, which is not one. */
const README_QUOTING_A_POINTER = [
  "diff --git a/docs/large-files.md b/docs/large-files.md",
  "new file mode 100644",
  "index 0000000..6666666",
  "--- /dev/null",
  "+++ b/docs/large-files.md",
  "@@ -0,0 +1,7 @@",
  "+# Large files",
  "+",
  "+A pointer looks like this:",
  "+",
  `+${SPEC}`,
  `+oid sha256:${OID_A}`,
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

  it("finds a file stored as a Git LFS pointer, added, updated or deleted", () => {
    expect(opaqueChanges(parseUnifiedDiff(LFS_ADDED)).lfsPointers).toEqual(["assets/model.bin"]);
    // Missed until the D-119 review: an update leaves the version line as
    // context, and only an added one was looked for.
    expect(opaqueChanges(parseUnifiedDiff(LFS_UPDATED)).lfsPointers).toEqual(["assets/model.bin"]);
    expect(opaqueChanges(parseUnifiedDiff(LFS_DELETED)).lfsPointers).toEqual(["assets/model.bin"]);
  });

  it("does not take a document quoting a pointer for one", () => {
    // Named as an LFS file the review had not read until the D-119 review,
    // though the review read every line of it.
    expect(opaqueChanges(parseUnifiedDiff(README_QUOTING_A_POINTER)).lfsPointers).toEqual([]);
  });

  it("finds nothing in an ordinary change", () => {
    expect(opaqueChanges(parseUnifiedDiff(ORDINARY))).toEqual({
      submodules: [],
      lfsPointers: [],
    });
  });
});

describe("the Git LFS pointer format", () => {
  const pointer = `${SPEC}\noid sha256:${OID_A}\nsize 12345\n`;

  it("knows a pointer by its form", () => {
    expect(isLfsPointer(pointer)).toBe(true);
    // An extension line sits between the version and the oid.
    expect(isLfsPointer(`${SPEC}\next-0-foo sha256:${OID_B}\noid sha256:${OID_A}\nsize 1\n`)).toBe(
      true,
    );
  });

  it("wants the version first and both an oid and a size", () => {
    expect(isLfsPointer(`oid sha256:${OID_A}\n${SPEC}\nsize 12345\n`)).toBe(false);
    expect(isLfsPointer(`${SPEC}\nsize 12345\n`)).toBe(false);
    expect(isLfsPointer(`${SPEC}\noid sha256:${OID_A}\n`)).toBe(false);
    expect(isLfsPointer(`${SPEC}\nsomething else\n`)).toBe(false);
  });

  it("takes nothing else around a pointer for one", () => {
    expect(isLfsPointer(`# Large files\n\n${pointer}`)).toBe(false);
    expect(isLfsPointer(`${pointer}\nAnd then some prose.\n`)).toBe(false);
  });
});
