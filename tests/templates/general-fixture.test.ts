/**
 * The General template's fixture (RT-2b), held to what a program can check
 * before a model is ever asked: one plant per rule where the key says it is,
 * a look-alike beside each, and the template's own sweeps hitting the plants
 * and nothing else in the change.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";

interface Manifest {
  template: string;
  branches: { from: string; into: string };
  defects: { ruleCode: string; severity: string; file: string; line: number; marker: string }[];
  lookAlikes: Record<string, string[]>;
  cleanFiles: string[];
}

const { ruleset } = importProtocol(
  readFileSync(fileURLToPath(new URL("../../templates/general.md", import.meta.url)), "utf8"),
);

let root: string;
let manifest: Manifest;
/** The lines the feature branch adds, and the lines it removes, by file. */
const added = new Map<string, { line: number; text: string }[]>();
const removed = new Map<string, string[]>();

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "trysquare-general-fixture-"));
  const builder = (await import(
    new URL("../fixtures/build-general-fixture.mjs", import.meta.url).href
  )) as { buildFixture: (root: string) => { repoDir: string; manifest: Manifest } };
  manifest = builder.buildFixture(join(root, "repo")).manifest;

  const diff = execFileSync(
    "git",
    ["diff", "-U0", "--no-color", manifest.branches.into, manifest.branches.from],
    { cwd: join(root, "repo"), encoding: "utf8" },
  );
  let file = "";
  let line = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) file = row.slice("+++ b/".length);
    else if (row.startsWith("--- ")) continue;
    else if (row.startsWith("@@")) line = Number(/\+(\d+)/.exec(row)![1]);
    else if (row.startsWith("+")) {
      added.set(file, [...(added.get(file) ?? []), { line, text: row.slice(1) }]);
      line += 1;
    } else if (row.startsWith("-")) {
      removed.set(file, [...(removed.get(file) ?? []), row.slice(1)]);
    }
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the General template's fixture", () => {
  it("plants one violation for every rule of the template, at the severity the rule has", () => {
    expect(manifest.template).toBe("general");
    expect(manifest.defects.map((defect) => [defect.ruleCode, defect.severity])).toEqual(
      ruleset.rules.map((rule) => [rule.code, rule.severity]),
    );
  });

  it("keys each plant to a line the change adds, or for the removed guard to where it stood", () => {
    for (const defect of manifest.defects.filter((entry) => entry.ruleCode !== "12")) {
      const lines = added.get(defect.file) ?? [];
      expect(
        lines.find((entry) => entry.line === defect.line)?.text,
        `rule ${defect.ruleCode}`,
      ).toContain(defect.marker);
    }
    // A removal has no added line: the key points at the call the check
    // guarded, one line below where it was.
    const guard = manifest.defects.find((defect) => defect.ruleCode === "12")!;
    expect(removed.get(guard.file)).toContain(
      '  if (!user.roles.includes("admin")) throw new Forbidden();',
    );
    expect(guard.line).toBe(5);
  });

  it("changes nothing but the plants and the look-alike beside each, with its test", () => {
    const planted = manifest.defects.map((defect) => defect.file);
    expect(Object.keys(manifest.lookAlikes)).toEqual(ruleset.rules.map((rule) => rule.code));
    expect(manifest.cleanFiles.filter((file) => planted.includes(file))).toEqual([]);
    expect([...new Set([...added.keys(), ...removed.keys()])].sort()).toEqual(
      [...planted, ...manifest.cleanFiles].sort(),
    );
    // A look-alike that is code comes with a test in the same change: one
    // without would be a finding under the rule on unproven behaviour.
    for (const [rule, files] of Object.entries(manifest.lookAlikes)) {
      expect(
        files.some((file) => file.startsWith("tests/")),
        `rule ${rule}'s look-alike`,
      ).toBe(true);
    }
  });

  it("is swept by the template's own patterns at the plants and nowhere else", () => {
    const hits: string[] = [];
    for (const rule of ruleset.rules) {
      for (const pattern of rule.sweepPatterns) {
        const regex = new RegExp(pattern);
        for (const [file, lines] of added) {
          for (const { line, text } of lines) {
            if (regex.test(text)) hits.push(`${rule.code} ${file}:${line}`);
          }
        }
      }
    }
    const plant = (code: string) => {
      const defect = manifest.defects.find((entry) => entry.ruleCode === code)!;
      return `${code} ${defect.file}:${defect.line}`;
    };
    // Every rule that has a sweep finds its own plant, and no pattern
    // touches a look-alike or another rule's plant.
    expect(hits.sort()).toEqual(["1", "5", "6", "9", "10", "11"].map(plant).sort());
  });
});
