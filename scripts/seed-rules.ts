/**
 * `npm run rules:seed -- <protocol.md> --name "<name>" [--tier global|tech|project] [--replace]`
 * imports a protocol document as a ruleset, the way the Rulesets screen does.
 *
 * The document is read from the path given and never copied into the
 * repository, so a company's own rules can stay out of a public one. Stop the
 * app first: the seed takes the same data-directory lock the app holds, and
 * refuses while the app has it.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { rulesetTierSchema } from "@/lib/domain/enums";
import { dbPath, resolveDataDir } from "@/lib/paths";
import { importProtocol } from "@/lib/rulesets/import";
import { acquireDataDirLock, DataDirLockError } from "@/server/data-dir-lock";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  rulesetAnImportWouldReplace,
  saveImportedRuleset,
} from "@/server/db/repositories/rulesets";

const USAGE =
  'Usage: npm run rules:seed -- <protocol.md> --name "<name>" [--tier global|tech|project] [--replace]';

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    tier: { type: "string", default: "global" },
    replace: { type: "boolean", default: false },
  },
});

const [file] = positionals;
if (file === undefined || values.name === undefined || values.name.trim() === "") {
  fail(USAGE, 2);
}

const tier = rulesetTierSchema.safeParse(values.tier);
if (!tier.success) fail(`--tier must be one of global, tech or project, not "${values.tier}".`, 2);

let markdown: string;
try {
  markdown = readFileSync(file, "utf8");
} catch (error) {
  fail(`Could not read ${file}: ${(error as Error).message}`);
}

// The same refusals as the import route (src/app/api/rulesets/import/route.ts):
// a document that yields no rules, or whose lines would be dropped, is not stored.
const { ruleset: imported, coverage } = importProtocol(markdown);
if (imported.rules.length === 0) {
  fail(
    "That document produced no rules, so a review using it would check nothing. Check the rule headings.",
  );
}
const lost = coverage.unmapped.filter((entry) => entry.text.trim() !== "");
if (lost.length > 0) {
  fail(
    `${lost.length} line(s) of that document do not belong to any rule or directive, so importing ` +
      "it would silently drop them. First unmapped line: " +
      JSON.stringify(lost[0]?.text),
  );
}

const dataDir = resolveDataDir(process.env, homedir());
let release: () => void;
try {
  release = acquireDataDirLock(dataDir);
} catch (error) {
  if (error instanceof DataDirLockError) {
    fail(error.message);
  }
  throw error;
}

const db = createDb(dbPath(dataDir));
try {
  runMigrations(db);
  const existing = rulesetAnImportWouldReplace(db, values.name, imported);
  if (existing && !values.replace) {
    fail(
      `A ruleset called "${existing.name}" already exists at version ${existing.version}, and this ` +
        "document differs from it. Re-run with --replace to replace its rules.",
    );
  }
  const saved = saveImportedRuleset(db, {
    name: values.name,
    tier: tier.data,
    imported,
    sourceDoc: basename(file),
  });
  const verb = saved.changed ? "Stored" : "Unchanged";
  console.log(
    `${verb}: "${values.name}" (${tier.data}), version ${saved.version}, ${imported.rules.length} rules, ` +
      `in ${dataDir}`,
  );
} finally {
  db.$client.close();
  release();
}
