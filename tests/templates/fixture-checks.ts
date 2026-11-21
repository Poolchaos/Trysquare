/**
 * What every template's fixture is held to before a model is ever asked
 * (RT-2b): one plant per rule where the key says it is, a look-alike beside
 * each with its test, and the template's own sweeps hitting the plants and
 * nothing else in the change.
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
  intent: string;
  defects: { ruleCode: string; severity: string; file: string; line: number; marker: string }[];
  lookAlikes: Record<string, string[]>;
  cleanFiles: string[];
}

export interface FixtureExpectation {
  /** The template's name on the shelf, and in its fixture builder's file name. */
  slug: string;
  /** The rules that have a sweep pattern: each must hit its own plant, and nothing else. */
  swept: string[];
  /**
   * A plant that is a removal, which no added line can carry: the line the
   * change takes out. Its key points at the line that stood under it.
   */
  removal?: { rule: string; line: string };
}

export function holdsTemplateFixture(expected: FixtureExpectation): void {
  const { ruleset } = importProtocol(
    readFileSync(
      fileURLToPath(new URL(`../../templates/${expected.slug}.md`, import.meta.url)),
      "utf8",
    ),
  );

  let root: string;
  let manifest: Manifest;
  /** The lines the feature branch adds, and the lines it removes, by file. */
  const added = new Map<string, { line: number; text: string }[]>();
  const removed = new Map<string, string[]>();

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), `trysquare-${expected.slug}-fixture-`));
    const builder = (await import(
      new URL(`../fixtures/build-${expected.slug}-fixture.mjs`, import.meta.url).href
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

  describe(`the ${expected.slug} template's fixture`, () => {
    it("plants one violation for every rule of the template, at the severity the rule has", () => {
      expect(manifest.template).toBe(expected.slug);
      // What a review is told the change is for: said, and naming no fault.
      expect(manifest.intent.length).toBeGreaterThan(40);
      expect(manifest.defects.map((defect) => [defect.ruleCode, defect.severity])).toEqual(
        ruleset.rules.map((rule) => [rule.code, rule.severity]),
      );
    });

    it("keys each plant to a line the change adds, or for a removal to the line under it", () => {
      for (const defect of manifest.defects) {
        if (defect.ruleCode === expected.removal?.rule) {
          expect(removed.get(defect.file), `rule ${defect.ruleCode}`).toContain(
            expected.removal.line,
          );
          continue;
        }
        const lines = added.get(defect.file) ?? [];
        expect(
          lines.find((entry) => entry.line === defect.line)?.text,
          `rule ${defect.ruleCode}`,
        ).toContain(defect.marker);
      }
    });

    it("changes nothing but the plants and the look-alike beside each, with its test", () => {
      const planted = manifest.defects.map((defect) => defect.file);
      expect(Object.keys(manifest.lookAlikes)).toEqual(ruleset.rules.map((rule) => rule.code));
      expect(manifest.cleanFiles.filter((file) => planted.includes(file))).toEqual([]);
      expect([...new Set([...added.keys(), ...removed.keys()])].sort()).toEqual(
        [...planted, ...manifest.cleanFiles].sort(),
      );
      // A look-alike that is code comes with a test in the same change: one
      // without would be a finding wherever a rule asks for proof.
      for (const [rule, files] of Object.entries(manifest.lookAlikes)) {
        expect(
          files.some((file) => file.startsWith("tests/")),
          `rule ${rule}'s look-alike`,
        ).toBe(true);
      }
    });

    it("is swept by the template's own patterns at the plants and nowhere else", () => {
      const hits = new Set<string>();
      for (const rule of ruleset.rules) {
        for (const pattern of rule.sweepPatterns) {
          const regex = new RegExp(pattern);
          for (const [file, lines] of added) {
            for (const { line, text } of lines) {
              if (regex.test(text)) hits.add(`${rule.code} ${file}:${line}`);
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
      expect([...hits].sort()).toEqual(expected.swept.map(plant).sort());
      expect(expected.swept).toEqual(
        ruleset.rules.filter((rule) => rule.sweepPatterns.length > 0).map((rule) => rule.code),
      );
    });
  });
}
