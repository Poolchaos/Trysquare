/**
 * The shelf's templates are made to be used together on one review, and the
 * rulesets of one review may not share a rule code (RS-1, D-288): each
 * template numbers its rules in a range of its own.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importProtocol } from "@/lib/rulesets/import";

const shelf = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../templates/${name}`, import.meta.url)), "utf8");

const slugs = (JSON.parse(shelf("shelf.json")) as { templates: { slug: string }[] }).templates.map(
  (template) => template.slug,
);
const codes = Object.fromEntries(
  slugs.map((slug) => [
    slug,
    importProtocol(shelf(`${slug}.md`)).ruleset.rules.map((rule) => rule.code),
  ]),
);

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, at) => String(from + at));

describe("the rule codes of the templates on the shelf", () => {
  it("are a range of its own for each template", () => {
    expect(codes).toEqual({
      general: range(1, 12),
      typescript: range(21, 29),
      react: range(31, 38),
      "http-api": range(41, 48),
    });
  });

  it("are shared by no two templates, whichever are added later", () => {
    const seen = new Map<string, string>();
    const shared: string[] = [];
    for (const slug of slugs) {
      for (const code of codes[slug]!) {
        const other = seen.get(code);
        if (other !== undefined) shared.push(`${code} in ${other} and ${slug}`);
        else seen.set(code, slug);
      }
    }
    expect(shared).toEqual([]);
  });
});
