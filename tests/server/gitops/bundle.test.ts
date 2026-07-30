/**
 * The bundle is what makes deletion review and cross-repo contract checking
 * possible, so it is tested against real repositories rather than fixtures.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBundle, type Inventory } from "@/server/gitops/bundle";
import { cloneBare, mergeBase, resolveCommit } from "@/server/gitops/repo";

let root: string;
let appClone: string;
let coreClone: string;
let bundleDir: string;
let inventory: Inventory;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
}

function makeRepo(dir: string, build: () => void, secondCommit: () => void) {
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  git(["config", "user.email", "test@example.invalid"], dir);
  git(["config", "user.name", "Test"], dir);
  build();
  git(["add", "-A"], dir);
  git(["commit", "-qm", "baseline"], dir);
  git(["checkout", "-qb", "feature/rename-field"], dir);
  secondCommit();
  git(["add", "-A"], dir);
  git(["commit", "-qm", "the change"], dir);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-bundle-"));
  const appOrigin = join(root, "app-origin");
  const coreOrigin = join(root, "core-origin");

  // The package: an exported interface field is renamed.
  makeRepo(
    coreOrigin,
    () => {
      writeFileSync(
        join(coreOrigin, "types.ts"),
        "export interface Prefs {\n  reportAutoNavigate: boolean;\n}\n",
      );
      writeFileSync(join(coreOrigin, "legacy.ts"), "export const removeMe = 1;\n");
    },
    () => {
      writeFileSync(
        join(coreOrigin, "types.ts"),
        "export interface Prefs {\n  autoNavigateDestination: string;\n}\n",
      );
      rmSync(join(coreOrigin, "legacy.ts"));
    },
  );

  // The app: consumes the package and was not fully migrated.
  makeRepo(
    appOrigin,
    () => {
      writeFileSync(join(appOrigin, "screen.ts"), "export const usesPrefs = 1;\n");
    },
    () => {
      writeFileSync(join(appOrigin, "screen.ts"), "export const usesPrefs = 2;\n");
    },
  );

  appClone = join(root, "app.git");
  coreClone = join(root, "core.git");
  await cloneBare(appOrigin, appClone);
  await cloneBare(coreOrigin, coreClone);

  bundleDir = join(root, "bundle");
  const result = await buildBundle({
    bundleDir,
    packageName: "@acme/shared-core",
    repos: [
      {
        role: "primary",
        slug: "app",
        repoDir: appClone,
        mergeBaseCommit: await mergeBase(appClone, "main", "feature/rename-field"),
        headCommit: await resolveCommit(appClone, "feature/rename-field"),
      },
      {
        role: "linked",
        slug: "shared-core",
        repoDir: coreClone,
        mergeBaseCommit: await mergeBase(coreClone, "main", "feature/rename-field"),
        headCommit: await resolveCommit(coreClone, "feature/rename-field"),
      },
    ],
  });
  inventory = result.inventory;
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("bundle contents", () => {
  it("writes a separate patch for each repository", () => {
    expect(existsSync(join(bundleDir, "diff.patch"))).toBe(true);
    expect(existsSync(join(bundleDir, "diff-linked.patch"))).toBe(true);
  });

  it("inventories both repositories, tagging which is which", () => {
    const primary = inventory.files.filter((f) => f.repo === "primary").map((f) => f.path);
    const linked = inventory.files
      .filter((f) => f.repo === "linked")
      .map((f) => f.path)
      .sort();

    expect(primary).toEqual(["screen.ts"]);
    expect(linked).toEqual(["legacy.ts", "types.ts"]);
  });

  it("materialises the previous contents of changed and deleted files", () => {
    // A deleted file is not in the worktree, so without this the deletion
    // stage would have nothing to read.
    const deleted = join(bundleDir, "base", "shared-core", "legacy.ts");
    expect(existsSync(deleted)).toBe(true);
    expect(readFileSync(deleted, "utf8")).toBe("export const removeMe = 1;\n");

    const modified = join(bundleDir, "base", "shared-core", "types.ts");
    expect(readFileSync(modified, "utf8")).toContain("reportAutoNavigate");
  });

  it("does not write a previous version for a file that is new", () => {
    expect(existsSync(join(bundleDir, "base", "app", "does-not-exist.ts"))).toBe(false);
  });

  it("maps the package specifier to the dependency worktree", () => {
    // Without this, a stage resolving the import would read the published
    // package in node_modules rather than the branch under review.
    const links = JSON.parse(readFileSync(join(bundleDir, "links.json"), "utf8"));
    expect(links).toEqual({ "@acme/shared-core": "shared-core/" });
  });

  it("lists the contract changes the adversarial stage must account for", () => {
    const names = inventory.changedExportedSymbols.map((s) => `${s.name}:${s.change}`).sort();
    expect(names).toContain("Prefs:modified");
    expect(names).toContain("removeMe:removed");
    // Only the dependency's contracts matter for the cross-repo check.
    expect(inventory.changedExportedSymbols.every((s) => s.repo === "linked")).toBe(true);
  });

  it("records stats the pre-flight screen shows before a review starts", () => {
    const stats = JSON.parse(readFileSync(join(bundleDir, "stats.json"), "utf8"));
    expect(stats.totalFiles).toBe(3);
    expect(stats.changedExportedSymbols).toBeGreaterThanOrEqual(2);
    expect(stats.perRepo).toHaveProperty("app");
    expect(stats.perRepo).toHaveProperty("shared-core");
  });

  it("writes an inventory that can seed the ledger directly", () => {
    const types = inventory.files.find((f) => f.path === "types.ts");
    expect(types?.changeType).toBe("modified");
    expect(types?.hunks.length).toBeGreaterThan(0);
    expect(types?.hunks[0]).toMatchObject({ hunkIndex: 0 });

    const legacy = inventory.files.find((f) => f.path === "legacy.ts");
    expect(legacy?.changeType).toBe("deleted");
  });
});
