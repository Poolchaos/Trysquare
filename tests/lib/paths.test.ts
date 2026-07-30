import { describe, expect, it } from "vitest";
import {
  DATA_DIR_ENV_VAR,
  bundleDir,
  dbPath,
  exportsDir,
  logsDir,
  projectRepoDir,
  resolveDataDir,
  runDir,
  worktreeRepoDir,
  worktreeRootDir,
} from "@/lib/paths";

const HOME = "/home/someone";

describe("resolveDataDir", () => {
  it("defaults under the home directory when the override is unset", () => {
    expect(resolveDataDir({}, HOME)).toBe("/home/someone/.local/share/trysquare");
  });

  it("honours the override env var", () => {
    expect(resolveDataDir({ [DATA_DIR_ENV_VAR]: "/mnt/data/prr" }, HOME)).toBe("/mnt/data/prr");
  });

  it("ignores an override that is blank or whitespace", () => {
    expect(resolveDataDir({ [DATA_DIR_ENV_VAR]: "   " }, HOME)).toBe(
      "/home/someone/.local/share/trysquare",
    );
    expect(resolveDataDir({ [DATA_DIR_ENV_VAR]: "" }, HOME)).toBe(
      "/home/someone/.local/share/trysquare",
    );
  });

  it("trims a padded override rather than creating a directory with spaces", () => {
    expect(resolveDataDir({ [DATA_DIR_ENV_VAR]: "  /mnt/data/prr  " }, HOME)).toBe("/mnt/data/prr");
  });
});

describe("layout", () => {
  const dataDir = "/data";

  it("places the database at the data directory root", () => {
    expect(dbPath(dataDir)).toBe("/data/db.sqlite");
  });

  it("clones projects bare so there is no working tree to modify", () => {
    expect(projectRepoDir(dataDir, "p1")).toBe("/data/projects/p1/repo.git");
  });

  it("keeps every run artifact under one directory so deletion is a single sweep", () => {
    const run = runDir(dataDir, "r1");
    for (const child of [
      worktreeRootDir(dataDir, "r1"),
      bundleDir(dataDir, "r1"),
      logsDir(dataDir, "r1"),
    ]) {
      expect(child.startsWith(`${run}/`)).toBe(true);
    }
  });

  it("gives each repo of a linked review its own worktree subdirectory", () => {
    expect(worktreeRepoDir(dataDir, "r1", "pos")).toBe("/data/runs/r1/worktree/pos");
    expect(worktreeRepoDir(dataDir, "r1", "shared-core")).toBe(
      "/data/runs/r1/worktree/shared-core",
    );
  });

  it("keeps exports outside run directories so they survive review deletion", () => {
    expect(exportsDir(dataDir).startsWith(runDir(dataDir, "r1"))).toBe(false);
    expect(exportsDir(dataDir)).toBe("/data/exports");
  });
});
