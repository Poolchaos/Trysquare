import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";
import {
  renderAdversarialPrompt,
  renderChangeSummary,
  renderChangedSymbols,
  renderDeletionPrompt,
  renderHunk,
  renderSweepHits,
  renderVerificationPrompt,
  type StageContentInput,
} from "@/server/review/content";

const PATCH = [
  "diff --git a/orders.ts b/orders.ts",
  "--- a/orders.ts",
  "+++ b/orders.ts",
  "@@ -10,3 +10,5 @@ export function total() {",
  " const before = 1;",
  "+const user = payload as User;",
  "-const removed = old();",
  "+const sum = items.reduce(add, 0);",
  " const after = 2;",
  "",
].join("\n");

const DELETED = [
  "diff --git a/legacy.ts b/legacy.ts",
  "deleted file mode 100644",
  "--- a/legacy.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-export const guard = true;",
  "-export const other = 1;",
  "",
].join("\n");

function inputFor(patch: string): StageContentInput {
  return {
    files: parseUnifiedDiff(patch).map((file) => ({
      repo: "primary" as const,
      slug: "app",
      file,
    })),
    sweepHits: [],
  };
}

const INPUT = inputFor(PATCH);

describe("hunk rendering", () => {
  const rendered = renderHunk(INPUT.files[0]!, INPUT.files[0]!.file.hunks[0]!);

  it("names the hunk and its file so a stage can account for it", () => {
    expect(rendered).toContain("hunk 0 of app/orders.ts");
  });

  it("carries the enclosing scope git reported", () => {
    expect(rendered).toContain("in export function total()");
  });

  it("numbers each line as it stands in the file after the change", () => {
    // A model counting lines itself is where citations drift, so the numbers
    // are given rather than derived.
    expect(rendered).toContain("    10   const before = 1;");
    expect(rendered).toContain("    11 + const user = payload as User;");
    expect(rendered).toContain("    12 + const sum = items.reduce(add, 0);");
    expect(rendered).toContain("    13   const after = 2;");
  });

  it("gives a removed line no number, because it is not in the file", () => {
    expect(rendered).toContain("       - const removed = old();");
  });
});

describe("the change summary", () => {
  it("lists every file with its change type and line counts", () => {
    const summary = renderChangeSummary(INPUT);
    expect(summary).toContain("1 file(s) and 1 hunk(s)");
    expect(summary).toContain("app/orders.ts (modified, +2/-1)");
  });

  it("names a rename's previous path", () => {
    const renamed = inputFor(
      [
        "diff --git a/new.ts b/new.ts",
        "similarity index 90%",
        "rename from old.ts",
        "rename to new.ts",
        "",
      ].join("\n"),
    );
    expect(renderChangeSummary(renamed)).toContain("was app/old.ts");
  });

  it("marks a binary file, which cannot be read as lines", () => {
    const binary = inputFor(
      [
        "diff --git a/img.png b/img.png",
        "index 1..2 100644",
        "Binary files a/img.png and b/img.png differ",
        "",
      ].join("\n"),
    );
    expect(renderChangeSummary(binary)).toContain("binary");
  });
});

describe("the adversarial prompt", () => {
  it("states that an unmentioned hunk fails the run", () => {
    expect(renderAdversarialPrompt(INPUT)).toContain("treated as unreviewed and fails the run");
  });

  it("tells the stage which line numbers to cite", () => {
    expect(renderAdversarialPrompt(INPUT)).toContain("after the change");
  });

  it("includes the sweep hits it must disposition", () => {
    const withHits = {
      ...INPUT,
      sweepHits: [
        {
          path: "app/orders.ts",
          line: 11,
          ruleCode: "3",
          pattern: "\\bas\\b",
          excerpt: "const user = payload as User;",
        },
      ],
    };
    const prompt = renderAdversarialPrompt(withHits);
    expect(prompt).toContain("found 1 hit(s)");
    expect(prompt).toContain("app/orders.ts:11 rule 3");
  });

  it("says so plainly when the sweep found nothing", () => {
    // Silence would be ambiguous between no hits and no sweep.
    expect(renderAdversarialPrompt(INPUT)).toContain("found no hits");
  });

  it("restricts a batch to its own files and hits", () => {
    const twoFiles: StageContentInput = {
      files: [
        ...INPUT.files,
        ...inputFor(DELETED).files.map((entry) => ({ ...entry, slug: "app" })),
      ],
      sweepHits: [
        { path: "app/orders.ts", line: 11, ruleCode: "3", pattern: "x", excerpt: "a" },
        { path: "app/legacy.ts", line: 1, ruleCode: "6", pattern: "y", excerpt: "b" },
      ],
    };

    const prompt = renderAdversarialPrompt(twoFiles, {
      files: ["app/orders.ts"],
      theme: "typescript",
      batchNumber: 2,
      batchCount: 5,
    });

    expect(prompt).toContain("request 2 of 5");
    expect(prompt).toContain("typescript rules");
    expect(prompt).toContain("hunk 0 of app/orders.ts");
    // The other file's hunks and hits belong to a different request.
    expect(prompt).not.toContain("app/legacy.ts:1 rule 6");
  });
});

describe("the deletion prompt", () => {
  it("supplies the previous contents of a deleted file", () => {
    // A deleted file is not in the worktree, so without this the stage has
    // nothing to review.
    const input: StageContentInput = {
      ...inputFor(DELETED),
      baseContents: new Map([["app/legacy.ts", "export const guard = true;\n"]]),
    };
    const prompt = renderDeletionPrompt(input);
    expect(prompt).toContain("app/legacy.ts (deleted)");
    expect(prompt).toContain("Contents before deletion");
    expect(prompt).toContain("export const guard = true;");
  });

  it("shows removed lines in context for a file that still exists", () => {
    const prompt = renderDeletionPrompt(INPUT);
    expect(prompt).toContain("app/orders.ts (modified)");
    expect(prompt).toContain("- const removed = old();");
  });

  it("says plainly when nothing was removed", () => {
    const additionOnly = inputFor(
      [
        "diff --git a/new.ts b/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.ts",
        "@@ -0,0 +1,1 @@",
        "+export const fresh = 1;",
        "",
      ].join("\n"),
    );
    expect(renderDeletionPrompt(additionOnly)).toContain("removes nothing");
  });
});

describe("cross-repo contract changes", () => {
  it("lists each changed symbol and what must be done with it", () => {
    const rendered = renderChangedSymbols([
      { name: "Prefs", path: "types.ts", kind: "interface", change: "modified" },
    ]);
    expect(rendered).toContain("Prefs (interface, modified) in types.ts");
    expect(rendered).toContain("only break at the consumer");
  });

  it("renders nothing when there is no linked repository", () => {
    expect(renderChangedSymbols([])).toBe("");
  });
});

describe("the verification prompt", () => {
  const candidates = [
    {
      findingId: "f1",
      path: "app/orders.ts",
      lineStart: 11,
      lineEnd: 11,
      severity: "CRITICAL",
      issue: "Unchecked cast",
      mechanism: "payload is asserted rather than parsed",
    },
  ];

  it("asks the stage to refute rather than to agree", () => {
    expect(renderVerificationPrompt(candidates)).toContain("try to refute");
  });

  it("warns that the quotation is compared against the file", () => {
    expect(renderVerificationPrompt(candidates)).toContain("compared");
    expect(renderVerificationPrompt(candidates)).toContain("discarded");
  });

  it("asks for the line numbers actually found, not the ones supplied", () => {
    expect(renderVerificationPrompt(candidates)).toContain("not the ones given below");
  });

  it("handles having nothing to verify", () => {
    expect(renderVerificationPrompt([])).toContain("no candidate findings");
  });
});

describe("sweep hit rendering", () => {
  it("names the rule, the pattern, and the line for each hit", () => {
    const rendered = renderSweepHits([
      { path: "a.ts", line: 3, ruleCode: "6", pattern: "console\\.", excerpt: "console.log(1)" },
    ]);
    expect(rendered).toContain("a.ts:3 rule 6 matched /console\\./: console.log(1)");
  });
});
