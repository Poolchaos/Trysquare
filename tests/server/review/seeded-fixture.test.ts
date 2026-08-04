/**
 * The fixture has to be right before it can test anything else.
 *
 * A manifest that says a defect is at a line where it is not would fail the
 * quality gate for the wrong reason, and worse, a defect that is not actually
 * in the diff would make the gate pass while proving nothing. These tests
 * check the fixture against the real diff git produces.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols } from "@/lib/git/symbols";
// @ts-expect-error -- the fixture builder is plain JavaScript on purpose, so
// it can also be run directly from a shell without a TypeScript loader.
import { buildSeededRepos } from "../../fixtures/build-seeded-repos.mjs";

let root: string;
let appDir: string;
let coreDir: string;
let manifest: {
  defects: {
    id: string;
    repo: string;
    file: string;
    marker: string;
    line: number;
    ruleCode: string;
    severity: string;
    kind: "addition" | "deletion" | "cross-repo" | "deleted-file";
    removedText?: string;
    deletedFile?: string;
    dependsOnSymbol?: string;
    crossRepo?: boolean;
  }[];
  cleanFiles: string[];
  changedSymbols: string[];
};
let appFiles: ParsedFile[];
let coreFiles: ParsedFile[];

function diffOf(repo: string): ParsedFile[] {
  const patch = execFileSync("git", ["diff", "-M", "main...feature/rename-prefs"], {
    cwd: repo,
    encoding: "utf8",
  });
  return parseUnifiedDiff(patch);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "trysquare-seeded-"));
  const built = buildSeededRepos(root);
  appDir = built.appDir;
  coreDir = built.coreDir;
  manifest = built.manifest;
  appFiles = diffOf(appDir);
  coreFiles = diffOf(coreDir);
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the seeded change set", () => {
  it("changes every file the manifest talks about", () => {
    const changed = new Set(appFiles.map((file) => file.path));
    for (const defect of manifest.defects.filter((entry) => entry.repo === "app")) {
      if (defect.kind === "deleted-file") {
        // The builder is imported without types, so a mistyped field would
        // otherwise pass silently as undefined.
        expect(defect.deletedFile, `${defect.id} names its deleted file`).toBeDefined();
        // Here the diff must show the deletion and must NOT show the caller:
        // the caller being untouched is the defect's whole point.
        expect(changed.has(defect.deletedFile!), `${defect.id} deletes ${defect.deletedFile}`).toBe(
          true,
        );
        expect(changed.has(defect.file), `${defect.id} leaves ${defect.file} out of the diff`).toBe(
          false,
        );
        continue;
      }
      expect(changed.has(defect.file), `${defect.id} in ${defect.file}`).toBe(true);
    }
    for (const clean of manifest.cleanFiles) expect(changed.has(clean), clean).toBe(true);
  });

  it("really contains each defect at the line the manifest states", () => {
    // The gate compares a reviewer's citations against these lines, so a
    // manifest that has drifted would fail the gate for the wrong reason.
    for (const defect of manifest.defects) {
      const repo = defect.repo === "app" ? appDir : coreDir;
      const lines = readFileSync(join(repo, defect.file), "utf8").split("\n");
      const actual = lines[defect.line - 1] ?? "";
      expect(actual, `${defect.id} at ${defect.file}:${defect.line}`).toContain(defect.marker);
    }
  });

  it("introduces each defect in the change, rather than it being pre-existing", () => {
    // A defect that was already on main would be out of scope for the review,
    // so finding it would not be evidence of anything. Defects arrive either
    // as added code or as removed code, and the deletion stage exists for the
    // second kind, so each is checked on its own side of the diff.
    const sideOf = (marker: string) => (line: string) => line.includes(marker);

    for (const defect of manifest.defects.filter((entry) => entry.repo === "app")) {
      if (defect.kind === "deleted-file") {
        // The defect's own file is the untouched caller, so the find below
        // would fail; the change-side evidence is the deletion itself.
        const gone = appFiles.find((entry) => entry.path === defect.deletedFile);
        expect(gone, `${defect.deletedFile} appears in the diff`).toBeDefined();
        expect(gone!.changeType, defect.id).toBe("deleted");
        continue;
      }

      const file = appFiles.find((entry) => entry.path === defect.file);
      expect(file, defect.file).toBeDefined();

      const added = file!.hunks.flatMap((hunk) =>
        hunk.lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)),
      );
      const removed = file!.hunks.flatMap((hunk) =>
        hunk.lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)),
      );

      if (defect.kind === "cross-repo") {
        // The defective line is untouched; what broke it is a contract change
        // in the other repository. The file is still in the change set, so a
        // linked review has reason to look at it.
        const symbols = changedExportedSymbols(coreFiles).map((symbol) => symbol.name);
        expect(symbols, defect.id).toContain(defect.dependsOnSymbol);
        expect(added.some(sideOf(defect.marker)), defect.id).toBe(false);
        continue;
      }

      if (defect.kind === "deletion") {
        expect(
          removed.some(sideOf(defect.removedText!)),
          `${defect.id} should appear as a removed line in ${defect.file}`,
        ).toBe(true);
        continue;
      }

      expect(
        added.some(sideOf(defect.marker)),
        `${defect.id} should appear as an added line in ${defect.file}`,
      ).toBe(true);
    }
  });

  it("gives every defect a rule from the example protocol", () => {
    const protocol = readFileSync(
      new URL("../../fixtures/example-protocol.md", import.meta.url),
      "utf8",
    );
    for (const defect of manifest.defects) {
      // The rule must exist, or the reviewer has nothing to violate.
      expect(protocol, `rule ${defect.ruleCode} for ${defect.id}`).toContain(
        `### ${defect.ruleCode}. `,
      );
    }
  });

  it("keeps the clean files genuinely clean", () => {
    // These are the false-positive traps: real changes with nothing wrong.
    for (const clean of manifest.cleanFiles) {
      expect(manifest.defects.some((defect) => defect.file === clean)).toBe(false);
    }
  });

  it("deletes a whole file whose caller the change never touches", () => {
    const defect = manifest.defects.find((entry) => entry.kind === "deleted-file");
    expect(defect).toBeDefined();

    const gone = appFiles.find((entry) => entry.path === defect!.deletedFile);
    expect(gone?.changeType).toBe("deleted");
    const removed = gone!.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)),
    );
    expect(removed.some((line) => line.includes("retryOnce"))).toBe(true);

    // The caller is absent from the diff and still imports the dead module:
    // exactly the breakage a diff-only review cannot see.
    expect(appFiles.some((entry) => entry.path === defect!.file)).toBe(false);
    const caller = readFileSync(join(appDir, defect!.file), "utf8");
    expect(caller).toContain(`from "./retry"`);
    expect(caller).toContain("retryOnce(");
  });

  it("keeps the helper being duplicated in the tree and out of the change set", () => {
    // Without this, the duplicate is nominal: if merge.ts were silently
    // dropped from the fixture, apply.ts would duplicate nothing and the
    // answer key would still pass.
    const original = readFileSync(join(appDir, "src/settings/merge.ts"), "utf8");
    expect(original).toContain("export function mergePrefs");
    expect(original).toContain("!== undefined");
    expect(appFiles.some((entry) => entry.path === "src/settings/merge.ts")).toBe(false);

    // The copy differs behaviourally, not stylistically: the guard is gone,
    // so an undefined override clobbers a real default.
    const duplicate = readFileSync(join(appDir, "src/settings/apply.ts"), "utf8");
    expect(duplicate).toContain("{ ...base, ...override }");
    expect(duplicate).not.toContain("!== undefined");
  });

  it("removes the guard and the await as deletions, not merely edits", () => {
    const guard = appFiles.find((file) => file.path === "src/auth/guard.ts");
    const removed = guard?.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)),
    );
    expect(removed?.some((line) => line.includes("canRead"))).toBe(true);
    expect(removed?.some((line) => line.includes("Not permitted"))).toBe(true);
  });
});

describe("the linked dependency", () => {
  it("changes the exported contract the app consumes", () => {
    const symbols = changedExportedSymbols(coreFiles).map((symbol) => symbol.name);
    for (const expected of manifest.changedSymbols) {
      expect(symbols, expected).toContain(expected);
    }
  });

  it("leaves a consumer in the app reading the old field name", () => {
    // This is the defect a single-repo review cannot see: the package
    // compiles, and only the consumer is wrong.
    const prefs = readFileSync(join(appDir, "src/settings/prefs.ts"), "utf8");
    const types = readFileSync(join(coreDir, "types.ts"), "utf8");

    expect(prefs).toContain("prefs.reportAutoNavigate");
    expect(types).toContain("autoNavigateDestination");
    expect(types).not.toContain("reportAutoNavigate:");
  });

  it("also changes a default value, which no consumer opted into", () => {
    const types = readFileSync(join(coreDir, "types.ts"), "utf8");
    expect(types).toContain("DEFAULT_TIMEOUT_SECONDS = 5");
  });
});

describe("the fixed variant branch", () => {
  it("keeps the branch order and the HEAD the browser suites depend on", () => {
    // The into-branch fallback picks the first branch that is not the one
    // under review, ordered by recency then refname; both browser specs
    // assert that lands on main. All fixture commits share one date, so the
    // refname tiebreak is what holds this.
    const order = execFileSync(
      "git",
      ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads/"],
      { cwd: appDir, encoding: "utf8" },
    )
      .trim()
      .split("\n");
    expect(order).toEqual(["feature/rename-prefs", "main", "rename-prefs-migrated"]);

    // Playwright's hasText is a substring match on the from-branch label.
    expect("rename-prefs-migrated".includes("feature/rename-prefs")).toBe(false);

    // The bare clone inherits HEAD, and the detected default from-branch
    // comes from it: building the fixed branch must not move it.
    const head = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: appDir,
      encoding: "utf8",
    }).trim();
    expect(head).toBe("feature/rename-prefs");
  });

  it("repairs both cross-repo defects and nothing else", () => {
    execFileSync("git", ["checkout", "-q", "rename-prefs-migrated"], { cwd: appDir });
    try {
      const prefs = readFileSync(join(appDir, "src/settings/prefs.ts"), "utf8");
      expect(prefs).toContain("autoNavigateDestination === ");
      expect(prefs).not.toContain("reportAutoNavigate");
      expect(prefs).toContain("Math.max(SAVE_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS)");

      // Only the repair is new on this branch: every other seeded defect
      // carries over, which is what makes its answer key main-minus-cross-repo.
      const diff = execFileSync(
        "git",
        ["diff", "--name-only", "feature/rename-prefs...rename-prefs-migrated"],
        { cwd: appDir, encoding: "utf8" },
      )
        .trim()
        .split("\n");
      expect(diff).toEqual(["src/settings/prefs.ts"]);
    } finally {
      execFileSync("git", ["checkout", "-q", "feature/rename-prefs"], { cwd: appDir });
    }
  });
});

describe("reproducibility", () => {
  it("builds identically twice, so a review of it is comparable over time", () => {
    const second = mkdtempSync(join(tmpdir(), "trysquare-seeded-2-"));
    try {
      const built = buildSeededRepos(second);
      const firstHead = execFileSync("git", ["rev-parse", "feature/rename-prefs"], {
        cwd: appDir,
        encoding: "utf8",
      }).trim();
      const secondHead = execFileSync("git", ["rev-parse", "feature/rename-prefs"], {
        cwd: built.appDir,
        encoding: "utf8",
      }).trim();
      expect(secondHead).toBe(firstHead);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  }, 120_000);
});
