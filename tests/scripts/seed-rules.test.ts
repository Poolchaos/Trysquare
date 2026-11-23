/**
 * `npm run rules:seed`: a protocol document stored as a ruleset, with the
 * refusals the Rulesets import makes. The lock case uses a real second process,
 * since the lock is held per process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RulesetTier } from "@/lib/domain/enums";
import { dbPath } from "@/lib/paths";
import { importProtocol } from "@/lib/rulesets/import";
import { DataDirLockError } from "@/server/data-dir-lock";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { listRulesets } from "@/server/db/repositories/rulesets";
import { seedRuleset, SeedRefusedError } from "../../scripts/lib/seed-rules";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLE = join(REPO_ROOT, "tests", "fixtures", "example-protocol.md");
const HOLDER = join(REPO_ROOT, "tests", "fixtures", "hold-data-dir-lock.mts");
const example = readFileSync(EXAMPLE, "utf8");
const ruleCount = importProtocol(example).ruleset.rules.length;

let dataDir: string;
let others: ChildProcess[];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-seed-"));
  others = [];
});

afterEach(async () => {
  for (const other of others) {
    if (other.exitCode === null && other.signalCode === null) {
      other.kill("SIGKILL");
      await new Promise((resolve) => other.once("exit", resolve));
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** What the data directory holds, read as the app reads it. */
function storedRulesetNames(dir: string): string[] {
  const db = createDb(dbPath(dir));
  try {
    runMigrations(db);
    return listRulesets(db).map((ruleset) => ruleset.name);
  } finally {
    db.$client.close();
  }
}

function seed(
  markdown: string,
  options: { name?: string; replace?: boolean; tier?: RulesetTier } = {},
) {
  return seedRuleset({
    dataDir,
    markdown,
    name: options.name ?? "Company base rules",
    tier: options.tier ?? "global",
    replace: options.replace ?? false,
    sourceDoc: "example-protocol.md",
  });
}

describe("seeding a protocol", () => {
  it("stores the document as version 1 with every rule it holds", () => {
    expect(ruleCount).toBeGreaterThan(0);

    const result = seed(example);

    expect(result).toEqual({ changed: true, version: 1, ruleCount, tier: "global" });
    expect(storedRulesetNames(dataDir)).toEqual(["Company base rules"]);
  });

  it("changes nothing when the same document is seeded again", () => {
    seed(example);

    expect(seed(example)).toEqual({ changed: false, version: 1, ruleCount, tier: "global" });
  });

  it("reports the tier the ruleset is stored under, not the one an unchanged document asked for", () => {
    seed(example, { tier: "tech" });

    expect(seed(example, { tier: "project" })).toEqual({
      changed: false,
      version: 1,
      ruleCount,
      tier: "tech",
    });
  });

  it("refuses a different document under a name already taken, unless told to replace it", () => {
    seed(example);
    const edited = example.replace("## Purpose", "## Purpose (edited)");

    expect(() => seed(edited)).toThrow(SeedRefusedError);
    expect(() => seed(edited)).toThrow(/Re-run with --replace/);
    // Refused means refused: the stored version is still the first.
    expect(seed(example)).toEqual({ changed: false, version: 1, ruleCount, tier: "global" });
  });

  it("replaces the rules of a taken name when told to, and bumps the version", () => {
    seed(example);
    const edited = example.replace("## Purpose", "## Purpose (edited)");

    expect(seed(edited, { replace: true })).toMatchObject({ changed: true, version: 2 });
  });

  it("stores nothing from a document with no rules", () => {
    expect(() => seed("# Just a title\n\nNo rules here.\n")).toThrow(SeedRefusedError);
    expect(storedRulesetNames(dataDir)).toEqual([]);
  });

  it("refuses to run while another process holds the data directory", async () => {
    const other = spawn(process.execPath, ["--import", "tsx", HOLDER, dataDir, "hold"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    });
    others.push(other);
    const line = await new Promise<string>((resolve) =>
      other.stdout!.once("data", (chunk) => resolve(String(chunk).trim())),
    );
    expect(line).toMatch(/^held \d+$/);

    expect(() => seed(example)).toThrow(DataDirLockError);
    expect(storedRulesetNames(dataDir)).toEqual([]);
  });

  it("refuses a file that is not a protocol before it touches the database", () => {
    const junk = join(dataDir, "junk.md");
    writeFileSync(junk, "\n\n");

    expect(() => seed(readFileSync(junk, "utf8"))).toThrow(SeedRefusedError);
    expect(storedRulesetNames(dataDir)).toEqual([]);
  });
});
