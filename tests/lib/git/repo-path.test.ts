import { describe, expect, it } from "vitest";
import { unsafeRepoPathReason } from "@/lib/git/repo-path";
import { insideRoot, PathEscapeError } from "@/lib/paths";

describe("which repository paths are safe to join onto a directory", () => {
  it.each(["app/src/x.ts", "café.ts", "a b/c.ts", ".github/workflows/x.yml", "...", "a..b"])(
    "accepts %j",
    (path) => {
      expect(unsafeRepoPathReason(path)).toBeNull();
    },
  );

  it.each([
    ["", "is empty"],
    ["..\\..\\escaped.txt", "backslash"],
    ["../x.txt", '".." segment'],
    ["app/../../x.txt", '".." segment'],
    ["app/./x.txt", '"." segment'],
    ["/etc/passwd", "is absolute"],
    ["C:/Windows/x", "names a drive"],
    ["app//x.ts", "empty segment"],
    ["a\0b", "NUL"],
  ])("refuses %j because it %s", (path, reason) => {
    expect(unsafeRepoPathReason(path)).toContain(reason);
  });
});

describe("joining onto a root", () => {
  it("returns a path inside the root", () => {
    expect(insideRoot("/data/run", "app/x.ts").endsWith("x.ts")).toBe(true);
  });

  it.each(["../x", "app/../../x", "/etc/passwd"])("refuses %j, which resolves outside", (path) => {
    expect(() => insideRoot("/data/run", path)).toThrow(PathEscapeError);
  });

  it("refuses a sibling that only shares the root's name as a prefix", () => {
    expect(() => insideRoot("/data/run", "../run-other/x")).toThrow(PathEscapeError);
  });
});
