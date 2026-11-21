/**
 * The template shelf: the protocol documents this app ships for a ruleset to
 * be started from (`docs/plans/RULESET-TEMPLATES-PLAN.md`, RT-1).
 *
 * A template is `<slug>.md` in the repository's `templates/` folder, and
 * `shelf.json` beside them says what each is for. Read at run time and never
 * bundled, as the migrations are. Each document is held to the bar as it is
 * read, so one that falls short is never offered: the answer is the reason,
 * not a shorter list.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { importProtocol } from "@/lib/rulesets/import";
import type { ImportedRuleset } from "@/lib/rulesets/model";
import { templateBarFailures } from "@/lib/rulesets/template-bar";

// The server runs from the repository root (`npm run start`), as the unit
// tests do. The ignore comment keeps Turbopack's file tracer from reading
// the join as "the whole repository ships".
const SHELF_DIR = join(/* turbopackIgnore: true */ process.cwd(), "templates");
const INDEX = "shelf.json";

const indexSchema = z.strictObject({
  templates: z.array(
    z.strictObject({
      // Its document's name on the shelf, and its address once it has one.
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      name: z.string().min(1),
      purpose: z.string().min(1),
      // Moves when the document changes, so a ruleset made from it can say
      // which edition it started as.
      version: z.number().int().positive(),
      // The run that proved it on a model, against its fixture's key. None
      // until that run is made, and the template says so until then.
      modelRun: z.strictObject({ date: z.iso.date(), evidence: z.string().min(1) }).nullable(),
    }),
  ),
});

type ShelfEntry = z.infer<typeof indexSchema>["templates"][number];
type ShelfTemplate = ShelfEntry & { ruleCount: number };

/** Every template on the shelf, in the index's order. Throws on a shelf that is not whole. */
export function readShelf(dir: string = SHELF_DIR): ShelfTemplate[] {
  return shelved(dir).map(({ imported, ...template }) => ({
    ...template,
    ruleCount: imported.rules.length,
  }));
}

/** One template and its document as the importer reads it, or undefined for one not on the shelf. */
export function readTemplate(
  slug: string,
  dir: string = SHELF_DIR,
): (ShelfEntry & { imported: ImportedRuleset }) | undefined {
  return shelved(dir).find((template) => template.slug === slug);
}

function shelved(dir: string): (ShelfEntry & { imported: ImportedRuleset })[] {
  const indexPath = join(dir, INDEX);
  let text: string;
  try {
    text = readFileSync(indexPath, "utf8");
  } catch (error) {
    throw new Error(
      `The template shelf's index could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`The template shelf's index, ${indexPath}, is not JSON.`);
  }
  const index = indexSchema.safeParse(raw);
  if (!index.success) {
    const issues = index.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(
      `The template shelf's index, ${indexPath}, is not in its shape: ${issues.join("; ")}`,
    );
  }

  const listed = new Set<string>();
  for (const { slug } of index.data.templates) {
    if (listed.has(slug)) throw new Error(`The template shelf's index lists "${slug}" twice.`);
    listed.add(slug);
  }
  const documents = readdirSync(dir).filter((name) => name.endsWith(".md"));
  const stray = documents.find((name) => !listed.has(name.slice(0, -".md".length)));
  if (stray !== undefined) {
    throw new Error(
      `${stray} is on the template shelf and its index does not list it, so nobody could pick it.`,
    );
  }

  return index.data.templates.map((template) => {
    const file = `${template.slug}.md`;
    if (!documents.includes(file)) {
      throw new Error(
        `Template "${template.slug}" is in the shelf's index, and its document, ${file}, is not on the shelf.`,
      );
    }
    const markdown = readFileSync(join(dir, file), "utf8");
    const failures = templateBarFailures(markdown);
    if (failures.length > 0) {
      throw new Error(
        `Template "${template.slug}" does not meet the bar a template is held to. ${failures.join(" ")}`,
      );
    }
    return { ...template, imported: importProtocol(markdown).ruleset };
  });
}
