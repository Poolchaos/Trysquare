/**
 * The review bundle: everything the pipeline needs that is not in the worktree.
 *
 * Built by app code before any model runs, so the deterministic facts of a
 * review (what changed, what the code looked like before, which hunks exist)
 * are fixed and auditable rather than being whatever a model reports having
 * seen. The bundle is also what makes deletion review possible: a deleted
 * file is not in the worktree, so its previous contents are materialised here.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoRole } from "@/lib/domain/enums";
import { parseUnifiedDiff, summariseDiff, type ParsedFile } from "@/lib/git/diff";
import { changedExportedSymbols, type ChangedSymbol } from "@/lib/git/symbols";
import { diffText, fileAtCommit } from "./repo";

export interface RepoSpec {
  role: RepoRole;
  /** Directory name under the worktree root; also the inventory path prefix. */
  slug: string;
  repoDir: string;
  mergeBaseCommit: string;
  headCommit: string;
}

export interface InventoryFile {
  repo: RepoRole;
  slug: string;
  path: string;
  oldPath?: string;
  changeType: ParsedFile["changeType"];
  isBinary: boolean;
  isModeChangeOnly: boolean;
  addedLines: number;
  removedLines: number;
  hunks: {
    hunkIndex: number;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    section: string;
  }[];
}

export interface Inventory {
  files: InventoryFile[];
  /** Only populated for a linked review; drives the S3 contract check. */
  changedExportedSymbols: (ChangedSymbol & { repo: RepoRole })[];
}

export interface BundleResult {
  inventory: Inventory;
  stats: Record<string, unknown>;
  parsedByRepo: Map<RepoRole, ParsedFile[]>;
}

function toInventoryFile(file: ParsedFile, spec: RepoSpec): InventoryFile {
  return {
    repo: spec.role,
    slug: spec.slug,
    path: file.path,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    changeType: file.changeType,
    isBinary: file.isBinary,
    isModeChangeOnly: file.isModeChangeOnly,
    addedLines: file.addedLines,
    removedLines: file.removedLines,
    hunks: file.hunks.map((h) => ({
      hunkIndex: h.hunkIndex,
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      section: h.section,
    })),
  };
}

/**
 * Writes the bundle for one or two repositories.
 *
 * `packageName` is the import specifier of the linked dependency, recorded in
 * links.json so review stages resolve an import of that package to the
 * dependency's worktree rather than to whatever is in node_modules, which may
 * be a published version rather than the branch under review.
 */
export async function buildBundle(options: {
  bundleDir: string;
  repos: readonly RepoSpec[];
  packageName?: string | null;
}): Promise<BundleResult> {
  const { bundleDir, repos } = options;
  await mkdir(bundleDir, { recursive: true });

  const inventory: Inventory = { files: [], changedExportedSymbols: [] };
  const parsedByRepo = new Map<RepoRole, ParsedFile[]>();
  const perRepoStats: Record<string, unknown> = {};

  for (const spec of repos) {
    const patch = await diffText(spec.repoDir, spec.mergeBaseCommit, spec.headCommit);
    const patchName = spec.role === "primary" ? "diff.patch" : "diff-linked.patch";
    await writeFile(join(bundleDir, patchName), patch, "utf8");

    const files = parseUnifiedDiff(patch);
    parsedByRepo.set(spec.role, files);

    for (const file of files) {
      inventory.files.push(toInventoryFile(file, spec));

      // Pre-change contents for anything that was modified, deleted, or
      // renamed. An addition has no previous version to write.
      if (file.changeType === "added" || file.isBinary) continue;
      const sourcePath = file.oldPath ?? file.path;
      const previous = await fileAtCommit(spec.repoDir, spec.mergeBaseCommit, sourcePath);
      if (previous === null) continue;

      const destination = join(bundleDir, "base", spec.slug, sourcePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, previous, "utf8");
    }

    // A contract change in the dependency is what a linked review exists for.
    if (spec.role === "linked") {
      for (const symbol of changedExportedSymbols(files)) {
        inventory.changedExportedSymbols.push({ ...symbol, repo: spec.role });
      }
    }

    perRepoStats[spec.slug] = summariseDiff(files);
  }

  if (options.packageName && repos.some((r) => r.role === "linked")) {
    const linked = repos.find((r) => r.role === "linked")!;
    await writeFile(
      join(bundleDir, "links.json"),
      JSON.stringify({ [options.packageName]: `${linked.slug}/` }, null, 2),
      "utf8",
    );
  }

  const stats = {
    perRepo: perRepoStats,
    totalFiles: inventory.files.length,
    totalHunks: inventory.files.reduce((n, f) => n + f.hunks.length, 0),
    changedExportedSymbols: inventory.changedExportedSymbols.length,
  };

  await writeFile(join(bundleDir, "inventory.json"), JSON.stringify(inventory, null, 2), "utf8");
  await writeFile(join(bundleDir, "stats.json"), JSON.stringify(stats, null, 2), "utf8");

  return { inventory, stats, parsedByRepo };
}
