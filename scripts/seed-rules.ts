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
import { resolveDataDir } from "@/lib/paths";
import { DataDirLockError } from "@/server/data-dir-lock";
import { SeedRefusedError, seedRuleset } from "./lib/seed-rules";

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

const dataDir = resolveDataDir(process.env, homedir());
try {
  const result = seedRuleset({
    dataDir,
    markdown,
    name: values.name,
    tier: tier.data,
    replace: values.replace,
    sourceDoc: basename(file),
  });
  const verb = result.changed ? "Stored" : "Unchanged";
  console.log(
    `${verb}: "${values.name}" (${result.tier}), version ${result.version}, ${result.ruleCount} rules, in ${dataDir}`,
  );
  if (result.tier !== tier.data) {
    console.log(
      `Tier ${tier.data} was not set: an unchanged document leaves the ruleset as it is.`,
    );
  }
} catch (error) {
  if (error instanceof SeedRefusedError || error instanceof DataDirLockError) {
    fail(error.message);
  }
  throw error;
}
