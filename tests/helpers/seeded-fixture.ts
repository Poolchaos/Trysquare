/**
 * The two seeded repositories, cloned and ready to review.
 *
 * Building them takes seconds, so every suite that needs them builds once and
 * shares the result. Extracted rather than copied because two suites deriving
 * the same commits by hand is exactly how two suites start testing subtly
 * different things.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff, type ParsedFile } from "@/lib/git/diff";
import { cloneBare, diffText, mergeBase, resolveCommit } from "@/server/gitops/repo";
import { addWorktree } from "@/server/gitops/worktree";
// @ts-expect-error -- plain JavaScript so it can also be run from a shell.
import { buildSeededRepos } from "../fixtures/build-seeded-repos.mjs";
import type { SeededManifest } from "./ideal-answers";

export interface SeededFixture {
  root: string;
  appClone: string;
  coreClone: string;
  manifest: SeededManifest;
  appHead: string;
  appBase: string;
  coreHead: string;
  coreBase: string;
  appFiles: ParsedFile[];
  coreFiles: ParsedFile[];
  /**
   * A checkout of the same pinned commits.
   *
   * Verification answers quote the file they read, and the bytes at a commit
   * are the same wherever it is checked out, so this stands in for a worktree
   * the code under test has not laid out yet.
   */
  referenceRoot: string;
  cleanup: () => void;
}

export async function buildFixture(): Promise<SeededFixture> {
  const root = mkdtempSync(join(tmpdir(), "trysquare-fixture-"));
  const built = buildSeededRepos(root) as {
    appDir: string;
    coreDir: string;
    manifest: SeededManifest;
  };

  const appClone = join(root, "app.git");
  const coreClone = join(root, "core.git");
  await cloneBare(built.appDir, appClone);
  await cloneBare(built.coreDir, coreClone);

  const appBase = await mergeBase(appClone, "main", "feature/rename-prefs");
  const appHead = await resolveCommit(appClone, "feature/rename-prefs");
  const coreBase = await mergeBase(coreClone, "main", "feature/rename-prefs");
  const coreHead = await resolveCommit(coreClone, "feature/rename-prefs");

  const referenceRoot = join(root, "reference");
  await addWorktree(appClone, join(referenceRoot, "app"), appHead);
  await addWorktree(coreClone, join(referenceRoot, "shared-core"), coreHead);

  return {
    root,
    appClone,
    coreClone,
    manifest: built.manifest,
    appHead,
    appBase,
    coreHead,
    coreBase,
    appFiles: parseUnifiedDiff(await diffText(appClone, appBase, appHead)),
    coreFiles: parseUnifiedDiff(await diffText(coreClone, coreBase, coreHead)),
    referenceRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
