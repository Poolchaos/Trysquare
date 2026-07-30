#!/usr/bin/env node
/**
 * Builds the seeded fixture repositories.
 *
 * Two small git repositories with a main branch and a feature branch, where
 * the feature branch introduces a known set of defects and two changes that
 * are genuinely fine. The point is to have a change set whose correct review
 * is known in advance, so "did the reviewer find the bugs" becomes a test
 * rather than an impression.
 *
 * The manifest is derived, not written by hand: after the feature branch is
 * built, each defect's line number is found by locating its marker text in the
 * file on disk. A hand-counted manifest would drift the moment a fixture file
 * changed, and a drifted manifest would fail the gate for the wrong reason.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
}

function write(root, path, contents) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function commitAll(root, message) {
  git(["add", "-A"], root);
  git(["commit", "-qm", message], root);
}

function initRepo(root) {
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", root], { env: { ...process.env, ...GIT_ENV } });
  git(["config", "user.email", GIT_ENV.GIT_AUTHOR_EMAIL], root);
  git(["config", "user.name", GIT_ENV.GIT_AUTHOR_NAME], root);
}

/* ------------------------------------------------------------------ core */

const CORE_TYPES_BEFORE = `export interface Prefs {
  /** Whether a finished report navigates automatically. */
  reportAutoNavigate: boolean;
  theme: string;
}

export const DEFAULT_TIMEOUT_SECONDS = 30;
`;

const CORE_TYPES_AFTER = `export interface Prefs {
  /** Where a finished report navigates to, or "none". */
  autoNavigateDestination: string;
  theme: string;
}

export const DEFAULT_TIMEOUT_SECONDS = 5;
`;

/* ------------------------------------------------------------------- app */

const BEFORE = {
  "src/reports/exportRows.ts": `export interface ReportRow {
  [key: string]: unknown;
  id: string;
  label: string;
}

export function nameFor(rows: Record<string, string>, row: ReportRow): string {
  return rows[row.id] ?? "unknown";
}
`,

  "src/orders/save.ts": `import { persist } from "./persist";

export async function saveOrder(order: Order): Promise<string> {
  await persist(order);
  return "saved";
}
`,

  "src/session/refresh.ts": `import { reportFailure } from "../telemetry";

export async function refreshSession(): Promise<void> {
  try {
    await renewToken();
  } catch (error) {
    reportFailure(error);
    throw error;
  }
}
`,

  "src/billing/total.ts": `export function orderTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.priceCents, 0);
}
`,

  "src/reports/period.ts": `import { zonedStartOfDay } from "../time";

export function inPeriod(records: Record[], account: Account, day: DayParts): Record[] {
  const startOfDay = zonedStartOfDay(day.year, day.month, day.date, account.timeZone);
  return records.filter((record) => record.at >= startOfDay);
}
`,

  "src/auth/guard.ts": `export function openDocument(document: Document, user: User): string {
  if (!user.canRead(document.id)) {
    throw new Error("Not permitted to read this document.");
  }
  return document.contents;
}
`,

  "src/settings/prefs.ts": `import type { Prefs } from "@acme/shared-core";

export function describePrefs(prefs: Prefs): string {
  return prefs.reportAutoNavigate ? "navigates" : "stays";
}
`,

  "src/utils/format.ts": `export function titleCase(value: string): string {
  const first = value.slice(0, 1).toUpperCase();
  const rest = value.slice(1);
  return first + rest;
}
`,

  "tests/billing.test.ts": `import { orderTotal } from "../src/billing/total";

test("sums the order", () => {
  const total = orderTotal([{ priceCents: 1000 }, { priceCents: 25 }]);
  expect(total).toBe(1025);
});
`,

  "README.md": `# Seeded App

A fixture application.
`,
};

const AFTER = {
  // Defect 1: the type has "id", not "_id". The index signature makes the
  // misspelling compile, and the lookup silently yields undefined.
  "src/reports/exportRows.ts": `export interface ReportRow {
  [key: string]: unknown;
  id: string;
  label: string;
}

export function nameFor(rows: Record<string, string>, row: ReportRow): string {
  return rows[row._id] ?? "unknown";
}
`,

  // Defect 2: the await was removed, so the caller is told the write finished
  // before it has.
  "src/orders/save.ts": `import { persist } from "./persist";

export async function saveOrder(order: Order): Promise<string> {
  persist(order);
  return "saved";
}
`,

  // Defect 3: the error is now swallowed.
  "src/session/refresh.ts": `import { reportFailure } from "../telemetry";

export async function refreshSession(): Promise<void> {
  try {
    await renewToken();
  } catch {
    // ignore
  }
}
`,

  // Defect 4: money summed as floating point currency units.
  "src/billing/total.ts": `export function orderTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
`,

  // Defect 5: the day boundary is now built in the machine's local timezone.
  "src/reports/period.ts": `export function inPeriod(records: Record[], account: Account, day: DayParts): Record[] {
  const startOfDay = new Date(day.year, day.month, day.date);
  return records.filter((record) => record.at >= startOfDay);
}
`,

  // Defect 6: the permission check is gone.
  "src/auth/guard.ts": `export function openDocument(document: Document, user: User): string {
  return document.contents;
}
`,

  // Defect 7: the dependency renamed this field, and this consumer was not
  // migrated. It compiles in the package and breaks here.
  "src/settings/prefs.ts": `import type { Prefs } from "@acme/shared-core";

export function describePrefs(prefs: Prefs): string {
  return prefs.reportAutoNavigate ? "navigates" : "stays";
}

export function describeTimeout(seconds: number): string {
  return seconds + "s";
}
`,

  // Defect 8: the assertion was weakened in the same change that altered the
  // behaviour it covered.
  "tests/billing.test.ts": `import { orderTotal } from "../src/billing/total";

test("sums the order", () => {
  const total = orderTotal([{ price: 10.0 }, { price: 0.25 }]);
  expect(total).toBeDefined();
});
`,

  // Clean change 1: a genuine simplification, no behaviour change.
  "src/utils/format.ts": `export function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
`,

  // Clean change 2: documentation.
  "README.md": `# Seeded App

A fixture application used to test the reviewer.
`,
};

/**
 * Each seeded defect, with the text that identifies its line.
 *
 * A reviewer is expected to report each of these. The two clean files are
 * listed separately: reporting a finding in one of those is a false positive
 * and fails the gate just as a missed defect does.
 */
const DEFECTS = [
  {
    id: "index-signature-typo",
    repo: "app",
    file: "src/reports/exportRows.ts",
    marker: "rows[row._id]",
    ruleCode: "4",
    severity: "CRITICAL",
    description: "row._id does not exist on the type; the index signature hides the typo",
  },
  {
    id: "removed-await",
    repo: "app",
    file: "src/orders/save.ts",
    marker: "  persist(order);",
    ruleCode: "1",
    severity: "CRITICAL",
    description: "the await was removed, so the caller is told the write finished before it has",
  },
  {
    id: "swallowed-error",
    repo: "app",
    file: "src/session/refresh.ts",
    marker: "  } catch {",
    ruleCode: "2",
    severity: "WARNING",
    description: "the failure is discarded instead of reported and rethrown",
  },
  {
    id: "float-money",
    repo: "app",
    file: "src/billing/total.ts",
    marker: "sum + item.price,",
    ruleCode: "8",
    severity: "CRITICAL",
    description: "money is summed in floating point currency units rather than integer cents",
  },
  {
    id: "timezone-boundary",
    repo: "app",
    file: "src/reports/period.ts",
    marker: "new Date(day.year",
    ruleCode: "9",
    severity: "CRITICAL",
    description: "the day boundary is built in the machine's timezone, not the account's",
  },
  {
    id: "removed-guard",
    repo: "app",
    file: "src/auth/guard.ts",
    marker: "  return document.contents;",
    // Found by reading what the change removed, not what it added, which is
    // why the deletion stage exists at all.
    kind: "deletion",
    removedText: "user.canRead",
    ruleCode: "11",
    severity: "CRITICAL",
    description: "the permission check was removed, so any user can read any document",
  },
  {
    id: "unmigrated-consumer",
    repo: "app",
    file: "src/settings/prefs.ts",
    marker: "prefs.reportAutoNavigate",
    ruleCode: "4",
    severity: "CRITICAL",
    description:
      "the dependency renamed this field to autoNavigateDestination; this consumer still reads the old name",
    // Neither added nor removed here: this line did not change at all. The
    // contract underneath it did, in the other repository, which is exactly
    // why a single-repo review cannot see this defect.
    kind: "cross-repo",
    dependsOnSymbol: "Prefs",
    crossRepo: true,
  },
  {
    id: "weakened-assertion",
    repo: "app",
    file: "tests/billing.test.ts",
    marker: "toBeDefined()",
    ruleCode: "10",
    severity: "WARNING",
    description: "the exact expectation was replaced with an existence check",
  },
];

/** Files whose changes are correct. A finding in one of these is a false positive. */
const CLEAN_FILES = ["src/utils/format.ts", "README.md"];

function lineOf(root, file, marker) {
  const lines = readFileSync(join(root, file), "utf8").split("\n");
  const index = lines.findIndex((line) => line.includes(marker));
  if (index === -1) {
    throw new Error(`Marker ${JSON.stringify(marker)} not found in ${file}. The fixture is wrong.`);
  }
  return index + 1;
}

/**
 * Builds both repositories under `root` and returns their paths and the
 * manifest. Existing directories are not cleaned: callers pass a fresh
 * temporary directory.
 */
export function buildSeededRepos(root) {
  const appDir = join(root, "seeded-repo");
  const coreDir = join(root, "seeded-core");

  initRepo(coreDir);
  write(coreDir, "types.ts", CORE_TYPES_BEFORE);
  write(coreDir, "package.json", '{\n  "name": "@acme/shared-core"\n}\n');
  commitAll(coreDir, "baseline");
  git(["checkout", "-qb", "feature/rename-prefs"], coreDir);
  write(coreDir, "types.ts", CORE_TYPES_AFTER);
  commitAll(coreDir, "rename the prefs field and shorten the default timeout");

  initRepo(appDir);
  for (const [path, contents] of Object.entries(BEFORE)) write(appDir, path, contents);
  commitAll(appDir, "baseline");
  git(["checkout", "-qb", "feature/rename-prefs"], appDir);
  for (const [path, contents] of Object.entries(AFTER)) write(appDir, path, contents);
  commitAll(appDir, "assorted changes");

  const manifest = {
    builtAt: GIT_ENV.GIT_AUTHOR_DATE,
    branches: { from: "feature/rename-prefs", into: "main" },
    defects: DEFECTS.map((defect) => ({
      kind: "addition",
      ...defect,
      line: lineOf(defect.repo === "app" ? appDir : coreDir, defect.file, defect.marker),
    })),
    cleanFiles: CLEAN_FILES,
    changedSymbols: ["Prefs", "DEFAULT_TIMEOUT_SECONDS"],
  };

  return { appDir, coreDir, manifest };
}

/** Written next to the repositories so a manual run leaves the record behind. */
export function writeManifest(root, manifest) {
  const path = join(root, "seed-manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

if (process.argv[1] && process.argv[1].endsWith("build-seeded-repos.mjs")) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write("usage: build-seeded-repos.mjs <directory>\n");
    process.exit(2);
  }
  const { appDir, coreDir, manifest } = buildSeededRepos(target);
  const manifestPath = writeManifest(target, manifest);
  process.stdout.write(
    `app:      ${appDir}\ncore:     ${coreDir}\nmanifest: ${manifestPath}\n` +
      `defects:  ${manifest.defects.length}, clean files: ${manifest.cleanFiles.length}\n`,
  );
}
