/**
 * Everything the browser journey needs before a browser opens.
 *
 * Builds the seeded repositories, clones one the way a person would add it,
 * and writes the answers the fake CLI hands back, so the whole journey runs
 * with no model and no money. The answers are generated from a reference
 * checkout of the same pinned commits: verification quotes the file it read,
 * and the bytes at a commit are the same wherever that commit is checked out.
 *
 * Paths are decided when this module is first loaded, not when global setup
 * runs, because the Playwright config has to name them in the server's
 * environment before setup runs and before the server starts.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_ENV = "TRYSQUARE_E2E_ROOT";
const ROOT_PREFIX = "trysquare-e2e-";

/**
 * One fresh directory per run, created when the runner first loads this file.
 *
 * Playwright starts the web server before global setup runs
 * (`createGlobalSetupTasks` in Playwright 1.62), and the server opens its
 * database the moment it boots. Clearing a fixed directory in global setup
 * therefore deleted the database out from under a running server: Linux let
 * it and the server ran on an unlinked file, Windows refused with EBUSY. A new
 * directory needs no clearing. The runner records it in the environment,
 * which the workers and the web server inherit, so every process names the
 * same one; only the first load creates it.
 *
 * That load also clears out directories earlier runs left, but only ones
 * nobody has touched for STALE_AFTER_MS. Anything that loads this config
 * without the variable set counts as a first load, a `--list` or an editor
 * discovering tests included, and sweeping every directory would delete the
 * one a run in progress is using. A run takes minutes.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function runRoot(): string {
  const existing = process.env[ROOT_ENV];
  if (existing) return existing;
  const now = Date.now();
  for (const entry of readdirSync(tmpdir())) {
    if (entry !== "trysquare-e2e" && !entry.startsWith(ROOT_PREFIX)) continue;
    const path = join(tmpdir(), entry);
    try {
      if (now - statSync(path).mtimeMs < STALE_AFTER_MS) continue;
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Gone already, or still held by something; either way not this run's.
    }
  }
  const created = mkdtempSync(join(tmpdir(), ROOT_PREFIX));
  process.env[ROOT_ENV] = created;
  return created;
}

export const E2E_ROOT = runRoot();
export const DATA_DIR = join(E2E_ROOT, "data");
export const ANSWERS_DIR = join(E2E_ROOT, "answers");
export const COUNTER_FILE = join(E2E_ROOT, "calls.txt");
export const FIXTURE_DIR = join(E2E_ROOT, "fixture");
/**
 * Arms the next CLI call to fail with a usage limit.
 *
 * A file rather than an environment variable because the browser suite boots
 * one server for the whole run: a test cannot change the server's environment,
 * but it can write a file the next spawned CLI reads.
 */
export const LIMIT_TRIGGER = join(E2E_ROOT, "arm-limit.json");
/** Arms the next CLI call to stall, so a run is still going when Cancel is pressed. */
export const STALL_TRIGGER = join(E2E_ROOT, "arm-stall.json");

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

/** The one finding the scripted verification refutes, and why. */
export const REFUTED_ISSUE = "A guard is missing before this value is used.";
export const REFUTED_NOTE = "The value is checked before it arrives here, so nothing is missing.";

export default async function globalSetup(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const { buildSeededRepos } = (await import(
    pathToFileURL(join(REPO_ROOT, "tests", "fixtures", "build-seeded-repos.mjs")).href
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

  const outputs = helpers.buildIdealStageOutputs({
    files: files.map((file) => ({ repo: "primary" as const, slug: "app", file })),
    manifest: {
      ...manifest,
      defects: manifest.defects.filter((defect) => defect.kind !== "cross-repo"),
    } as never,
    worktreeRoot: referenceRoot,
    rules: importProtocol(readFileSync(PROTOCOL_PATH, "utf8")).ruleset.rules,
  });

  // One finding verification refutes, on a hunk nothing else is about, so the
  // journey sees a refutation said out loud rather than vanishing (D-97). The
  // hunk is taken from those the ideal answers clear, and is no longer cleared.
  const [refutedHunk, ...stillCleared] = outputs.s3.clearedHunks;
  if (!refutedHunk) throw new Error("The ideal answers cleared no hunk to refute a finding on.");
  const hunk = files
    .find((file) => `app/${file.path}` === refutedHunk.path)
    ?.hunks.find((candidate) => candidate.hunkIndex === refutedHunk.hunkIndex);
  if (!hunk) throw new Error(`No hunk ${refutedHunk.hunkIndex} in ${refutedHunk.path}.`);
  outputs.s3.clearedHunks = stillCleared;
  outputs.s3.findings.push({
    path: refutedHunk.path,
    lineStart: hunk.newStart,
    lineEnd: hunk.newStart,
    severity: "WARNING",
    ruleCode: null,
    issue: REFUTED_ISSUE,
    comment: "The value is used without being checked first.",
    mechanism: "traced from the change to where the value is used",
  });
  outputs.s5ByLine.push({
    path: refutedHunk.path,
    lineStart: hunk.newStart,
    verdict: "killed",
    quotedCode: "",
    note: REFUTED_NOTE,
  });

  const sequence = helpers.answerSequence(outputs);
  // Twice over: the journey runs one review and the failure-path spec runs
  // another, and the fake hands out one sequence per directory.
  helpers.writeAnswersDir(ANSWERS_DIR, [...sequence, ...sequence]);
}
