/**
 * Everything the browser journey needs before a browser opens.
 *
 * Builds the seeded repositories, clones one the way a person would add it,
 * and writes the answers the fake CLI hands back, so the whole journey runs
 * with no model and no money. The answers are generated from a reference
 * checkout of the same pinned commits: verification quotes the file it read,
 * and the bytes at a commit are the same wherever that commit is checked out.
 *
 * Paths are fixed rather than random because the Playwright config has to name
 * them in the server's environment before this file runs.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_ROOT = join(tmpdir(), "trysquare-e2e");
export const DATA_DIR = join(E2E_ROOT, "data");
export const ANSWERS_DIR = join(E2E_ROOT, "answers");
export const COUNTER_FILE = join(E2E_ROOT, "calls.txt");
export const FIXTURE_DIR = join(E2E_ROOT, "fixture");

/**
 * The address the journey pastes in.
 *
 * A bare clone named app.git, because the app takes a project's name from the
 * address and its worktree directory from that name. The answers below are
 * written for a project called "app", so the remote is named to match rather
 * than the answers being bent to fit a fixture directory name.
 */
export const APP_REPO = join(E2E_ROOT, "app.git");

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FAKE_CLI = join(REPO_ROOT, "tests", "fixtures", "fake-claude.mjs");
export const PROTOCOL_PATH = join(REPO_ROOT, "tests", "fixtures", "example-protocol.md");

export default async function globalSetup(): Promise<void> {
  rmSync(E2E_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const { buildSeededRepos } = (await import(
    join(REPO_ROOT, "tests", "fixtures", "build-seeded-repos.mjs")
  )) as { buildSeededRepos: (root: string) => { manifest: { defects: { kind: string }[] } } };
  const manifest = buildSeededRepos(FIXTURE_DIR).manifest;
  execFileSync("git", ["clone", "--bare", "--quiet", join(FIXTURE_DIR, "seeded-repo"), APP_REPO]);

  // A reference clone and checkout, only so the answers can quote real lines.
  const referenceClone = join(E2E_ROOT, "reference.git");
  const referenceRoot = join(E2E_ROOT, "reference");
  execFileSync("git", ["clone", "--bare", "--quiet", APP_REPO, referenceClone]);
  execFileSync("git", [
    "-C",
    referenceClone,
    "worktree",
    "add",
    "--detach",
    "--quiet",
    join(referenceRoot, "app"),
    "feature/rename-prefs",
  ]);

  const { parseUnifiedDiff } = await import("@/lib/git/diff");
  const { importProtocol } = await import("@/lib/rulesets/import");
  const { diffText, mergeBase, resolveCommit } = await import("@/server/gitops/repo");
  const helpers = await import("../tests/helpers/ideal-answers");

  const base = await mergeBase(referenceClone, "main", "feature/rename-prefs");
  const head = await resolveCommit(referenceClone, "feature/rename-prefs");
  const files = parseUnifiedDiff(await diffText(referenceClone, base, head));

  helpers.writeAnswersDir(
    ANSWERS_DIR,
    helpers.answerSequence(
      helpers.buildIdealStageOutputs({
        files: files.map((file) => ({ repo: "primary" as const, slug: "app", file })),
        manifest: {
          ...manifest,
          defects: manifest.defects.filter((defect) => defect.kind !== "cross-repo"),
        } as never,
        worktreeRoot: referenceRoot,
        rules: importProtocol(readFileSync(PROTOCOL_PATH, "utf8")).ruleset.rules,
      }),
    ),
  );
}
