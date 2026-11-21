/**
 * What every template's fixture is built with (RT-2b, RT-3b): a repository
 * with a main branch and a feature branch, and a key derived from the files
 * as built, never counted by hand.
 *
 * A fixture names its files on main, what the feature branch writes over
 * them, one plant per rule and the look-alike beside each. The plants carry
 * no tests of their own, so a finding on unproven behaviour in a planted
 * file is that rule working; a run is scored by file and line, not by the
 * rule cited.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  // Fixed dates keep commit hashes stable, so a fixture build is reproducible.
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
}

/** A file's contents from its lines, ending in a line break. */
export const lines = (...rows) => `${rows.join("\n")}\n`;

function writeAll(root, files) {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
}

function lineOf(root, file, marker) {
  const found = readFileSync(join(root, file), "utf8")
    .split("\n")
    .flatMap((text, index) => (text.includes(marker) ? [index + 1] : []));
  if (found.length !== 1) {
    throw new Error(`${file} holds "${marker}" on ${found.length} lines, where the key needs one.`);
  }
  return found[0];
}

/**
 * Builds the repository in `root`, replacing whatever is there, and answers
 * with where it is and its key.
 *
 * `defects` is one row per rule: its code, its severity, the planted file,
 * the text that finds the plant's line there, and what the plant is.
 * `lookAlikes` names, by rule, the files that are right and must stay clear
 * of findings. `intent` is what the change says it is for, which a review is
 * told and holds the code against: it describes the change truthfully and
 * names no fault.
 */
export function buildTemplateFixture(
  root,
  { template, feature, intent, main, change, defects, lookAlikes },
) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", root], { env: { ...process.env, ...GIT_ENV } });
  git(["config", "user.email", GIT_ENV.GIT_AUTHOR_EMAIL], root);
  git(["config", "user.name", GIT_ENV.GIT_AUTHOR_NAME], root);

  writeAll(root, main);
  git(["add", "-A"], root);
  git(["commit", "-qm", "Main"], root);

  git(["checkout", "-qb", feature], root);
  writeAll(root, change);
  git(["add", "-A"], root);
  git(["commit", "-qm", "The change under review"], root);

  return {
    repoDir: root,
    manifest: {
      builtAt: GIT_ENV.GIT_AUTHOR_DATE,
      template,
      branches: { from: feature, into: "main" },
      intent,
      defects: defects.map(([ruleCode, severity, file, marker, description]) => ({
        id: `rule-${ruleCode}`,
        // One repository, named as the demo names the project it reviews.
        repo: "app",
        kind: "addition",
        ruleCode,
        severity,
        file,
        marker,
        description,
        line: lineOf(root, file, marker),
      })),
      lookAlikes,
      cleanFiles: Object.values(lookAlikes).flat(),
    },
  };
}
