#!/usr/bin/env node
/**
 * Says how full a Claude Code session's context is, against the session
 * limit in CLAUDE.md section 10, so a session hands over on a measurement
 * and never on a guess.
 *
 * The figure is the context the session's newest request was sent with: the
 * input tokens of the last assistant entry in the session's transcript,
 * those read fresh, written to the cache and read from it. A subagent's
 * entries are left out, because a subagent runs in a context of its own.
 *
 * The transcript's shape is Claude Code's own and no documented contract
 * (read 2026-11-17 from a session the Agent SDK 0.3.326 wrote). So a
 * transcript that holds no such entry is refused by name, never read as an
 * empty session.
 *
 * Usage:
 *   node scripts/session-context.mjs                      the session it runs in
 *   node scripts/session-context.mjs --transcript <file>  a transcript by path
 *
 * Exits 0 below the handover point, 1 at or past it, 2 when it could not
 * measure.
 */

import { createReadStream, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const SESSION_LIMIT = 500_000;
/** Below the limit by what the handover itself costs, so it ends inside it. */
const HANDOVER_AT = 450_000;

const USAGE =
  "Usage: node scripts/session-context.mjs [--transcript <file>]\n" +
  "Without --transcript it reads the session it runs in, named by CLAUDE_CODE_SESSION_ID.";

function fail(message) {
  console.error(`session-context: ${message}`);
  process.exit(2);
}

function transcriptFromArgs(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--transcript" && args[1]) return args[1];
  fail(`unknown arguments: ${args.join(" ")}\n${USAGE}`);
}

/**
 * Claude Code keeps a session's transcript at
 * <config>/projects/<a name made from the project's path>/<session id>.jsonl.
 * The id is looked for under every project rather than rebuilding that name,
 * whose rule is not written down anywhere this could cite.
 */
function transcriptOfThisSession() {
  const id = process.env.CLAUDE_CODE_SESSION_ID?.trim();
  if (!id) fail(`CLAUDE_CODE_SESSION_ID is not set, so there is no session to read.\n${USAGE}`);
  if (!/^[A-Za-z0-9-]+$/.test(id)) fail(`CLAUDE_CODE_SESSION_ID is not a session id: ${id}`);

  const projects = join(
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
    "projects",
  );
  if (!existsSync(projects)) fail(`no transcripts folder at ${projects}`);
  let folders;
  try {
    folders = readdirSync(projects, { withFileTypes: true });
  } catch (error) {
    fail(`could not read ${projects}: ${error.message}`);
  }
  const found = folders
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(projects, entry.name, `${id}.jsonl`))
    .filter((file) => existsSync(file));
  if (found.length === 0) fail(`no transcript for session ${id} under ${projects}`);
  if (found.length > 1) fail(`session ${id} has ${found.length} transcripts:\n${found.join("\n")}`);
  return found[0];
}

function contextTokens(entry) {
  const usage = entry?.message?.usage;
  if (entry?.type !== "assistant" || entry.isSidechain === true || !usage) return null;
  if (!Number.isFinite(usage.input_tokens)) return null;
  const cached = [usage.cache_creation_input_tokens, usage.cache_read_input_tokens];
  const tokens = cached.reduce(
    (sum, part) => sum + (Number.isFinite(part) ? part : 0),
    usage.input_tokens,
  );
  // An entry Claude Code writes itself, for a request that failed, carries a
  // usage of zeros. It is no request, so it is no reading.
  return tokens > 0 ? tokens : null;
}

/** A line at a time: a long session's transcript runs to tens of megabytes. */
async function newestReading(file) {
  let tokens = null;
  let unread = 0;
  const lines = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      unread += 1;
      continue;
    }
    tokens = contextTokens(entry) ?? tokens;
  }
  return { tokens, unread };
}

const count = (n) => n.toLocaleString("en-US");

const file = transcriptFromArgs(process.argv.slice(2)) ?? transcriptOfThisSession();
if (!existsSync(file)) fail(`no transcript at ${file}`);

const { tokens, unread } = await newestReading(file).catch((error) =>
  // Uncaught, Node exits 1, which here means the handover is due.
  fail(`could not read ${file}: ${error.message}`),
);
if (tokens === null) {
  fail(
    `${file} holds no request with its token usage` +
      (unread > 0 ? `, and ${unread} line(s) of it could not be read as JSON` : "") +
      ". Nothing was measured.",
  );
}

const share = Math.floor((tokens / SESSION_LIMIT) * 100);
console.log(
  `Session ${basename(file, ".jsonl")}: ${count(tokens)} context tokens of ` +
    `${count(SESSION_LIMIT)} (${share}%). Handover starts at ${count(HANDOVER_AT)}.`,
);
if (unread > 0) {
  // The session writes its transcript while this reads it, so a line cut
  // short is expected at the end and said wherever it is.
  console.log(
    `${unread} line(s) of the transcript could not be read as JSON, so the figure may be a request behind.`,
  );
}
if (tokens >= HANDOVER_AT) {
  console.log(
    "HANDOVER DUE: start nothing new. Write the handover (docs/SESSION-HANDOVER.md), " +
      "then tell the maintainer to run /clear and start a new session.",
  );
  process.exit(1);
}
