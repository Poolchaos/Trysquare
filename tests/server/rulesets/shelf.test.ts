/**
 * The template shelf (RT-1): protocol documents shipped in the repository's
 * `templates/` folder, listed by an index beside them, each held to the bar
 * before it is offered.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readShelf } from "@/server/rulesets/shelf";

const GOOD = [
  "# Hygiene",
  "",
  "## Leftovers",
  "",
  "### 1. Debugger Left In",
  "",
  "**Rule:** Flag a `debugger` statement left in.",
  "",
  "**Violation Example:**",
  "",
  "```ts",
  "debugger;",
  "```",
  "",
  "**Correct Pattern:**",
  "",
  "```ts",
  "return total;",
  "```",
  "",
  "**Detection:** Look for the statement in added lines.",
  "",
  "**Severity:** WARNING",
  "",
  "**Why This Matters:** A breakpoint stops the program wherever a debugger is attached.",
  "Source: [CWE-489: Active Debug Code](https://cwe.mitre.org/data/definitions/489.html),",
  "read 2026-11-21.",
  "",
].join("\n");

const entry = (slug: string, more: Record<string, unknown> = {}) => ({
  slug,
  name: "Hygiene",
  purpose: "What any change is held to.",
  version: 1,
  modelRun: null,
  ...more,
});

const made: string[] = [];

/** A shelf in a folder of its own: an index, and each file as given. */
function shelf(index: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "trysquare-shelf-"));
  made.push(dir);
  if (index !== undefined) {
    writeFileSync(
      join(dir, "shelf.json"),
      typeof index === "string" ? index : JSON.stringify(index),
    );
  }
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the template shelf", () => {
  it("lists each template the index names, with the rules its document holds", () => {
    const ran = { date: "2026-11-21", evidence: "docs/evidence/hygiene" };
    const dir = shelf(
      { templates: [entry("hygiene"), entry("second", { name: "Second", modelRun: ran })] },
      {
        "hygiene.md": GOOD,
        "second.md": `${GOOD}\n${GOOD.split("\n").slice(4).join("\n").replace("### 1.", "### 2.")}`,
      },
    );
    expect(readShelf(dir)).toEqual([
      {
        slug: "hygiene",
        name: "Hygiene",
        purpose: "What any change is held to.",
        version: 1,
        modelRun: null,
        ruleCount: 1,
      },
      {
        slug: "second",
        name: "Second",
        purpose: "What any change is held to.",
        version: 1,
        modelRun: ran,
        ruleCount: 2,
      },
    ]);
  });

  it("ships with the templates named here, and no other", () => {
    // Hand-kept, so a shelf that reads as empty by mistake fails here: a
    // template is added to this list in the change that puts it on the shelf.
    expect(readShelf().map((template) => template.slug)).toEqual([
      "general",
      "typescript",
      "react",
    ]);
  });

  it("says when its index cannot be read, is not JSON, or is not in its shape", () => {
    const none = shelf(undefined);
    expect(() => readShelf(none)).toThrow(
      new Error(
        `The template shelf's index could not be read: ENOENT: no such file or directory, open '${join(none, "shelf.json")}'`,
      ),
    );

    const broken = shelf("{ templates: [");
    expect(() => readShelf(broken)).toThrow(
      new Error(`The template shelf's index, ${join(broken, "shelf.json")}, is not JSON.`),
    );

    // Left out of the JSON: an undefined value is not written.
    const unexplained = entry("hygiene", { purpose: undefined });
    const shapeless = shelf({ templates: [unexplained] }, { "hygiene.md": GOOD });
    expect(() => readShelf(shapeless)).toThrow(
      new Error(
        `The template shelf's index, ${join(shapeless, "shelf.json")}, is not in its shape: ` +
          "templates.0.purpose: Invalid input: expected string, received undefined",
      ),
    );
  });

  it("refuses an index that names a template twice, or one whose document is not there", () => {
    const twice = shelf(
      { templates: [entry("hygiene"), entry("hygiene")] },
      { "hygiene.md": GOOD },
    );
    expect(() => readShelf(twice)).toThrow(
      new Error('The template shelf\'s index lists "hygiene" twice.'),
    );

    const absent = shelf({ templates: [entry("hygiene")] });
    expect(() => readShelf(absent)).toThrow(
      new Error(
        'Template "hygiene" is in the shelf\'s index, and its document, hygiene.md, is not on the shelf.',
      ),
    );
  });

  it("refuses a document on the shelf that the index does not list", () => {
    const stray = shelf(
      { templates: [entry("hygiene")] },
      { "hygiene.md": GOOD, "draft.md": GOOD },
    );
    expect(() => readShelf(stray)).toThrow(
      new Error(
        "draft.md is on the template shelf and its index does not list it, so nobody could pick it.",
      ),
    );
  });

  it("refuses a template that does not meet the bar, naming every way it falls short", () => {
    const short = shelf(
      { templates: [entry("hygiene")] },
      {
        "hygiene.md": GOOD.replace(
          "**Detection:** Look for the statement in added lines.\n\n",
          "",
        ).replace("**Severity:** WARNING", "**Severity:** HIGH"),
      },
    );
    expect(() => readShelf(short)).toThrow(
      new Error(
        'Template "hygiene" does not meet the bar a template is held to. ' +
          'Rule 1 has no "**Detection:**" part. ' +
          'Rule 1 has no "**Severity:**" line naming CRITICAL, WARNING or NITPICK.',
      ),
    );
  });
});
