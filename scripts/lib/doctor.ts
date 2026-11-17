/**
 * The checks `npm run doctor` runs, as data: each one names what it found and
 * whether the app can start (fail stops it) or a review would be blocked by it
 * (warn). The script prints them; the tests read them.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import { dbPath, resolveDataDir } from "@/lib/paths";
import { MINIMUM_CLI_VERSION } from "@/server/engine/cli";
import { readCliStatus, type CliStatus } from "@/server/engine/probe";

export type Level = "ok" | "warn" | "fail";

export interface DoctorCheck {
  label: string;
  level: Level;
  detail: string;
}

/** Reads TRYSQUARE_CLAUDE_PATH and TRYSQUARE_DATA from process.env. */
export async function runDoctor(nodeVersion = process.versions.node): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const record = (label: string, level: Level, detail: string) =>
    checks.push({ label, level, detail });

  const nodeOk = Number(nodeVersion.split(".")[0]) >= 22;
  record(
    "Node 22 or newer",
    nodeOk ? "ok" : "fail",
    nodeOk ? `found v${nodeVersion}` : `found v${nodeVersion}; install Node 22 or newer`,
  );

  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  record(
    "git on PATH",
    git.status === 0 ? "ok" : "fail",
    git.status === 0 ? git.stdout.trim() : "not found; install git",
  );

  // better-sqlite3 ships a compiled binary for each Node and platform. Where
  // none is downloadable, npm builds it, which needs Python, make and a C++
  // compiler. Opening a memory database is what proves the binary loads.
  try {
    const sqlite = new Database(":memory:");
    const { version } = sqlite.prepare("select sqlite_version() as version").get() as {
      version: string;
    };
    sqlite.close();
    record("SQLite (better-sqlite3) loads", "ok", `SQLite ${version}`);
  } catch (error) {
    record(
      "SQLite (better-sqlite3) loads",
      "fail",
      `${(error as Error).message}. Re-run npm install; if it still fails, install build tools ` +
        "(Python 3, make, a C++ compiler) and run it again.",
    );
  }

  const cliLabel = `Claude Code CLI ${MINIMUM_CLI_VERSION} or newer`;
  const cli = await readCliStatus({ claudePath: process.env.TRYSQUARE_CLAUDE_PATH?.trim() });
  for (const row of signInRows(cli, cliLabel)) record(row.label, row.level, row.detail);

  const dataDir = resolveDataDir(process.env, homedir());
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    record("Data directory writable", "ok", dataDir);
  } catch (error) {
    record("Data directory writable", "fail", `${dataDir}: ${(error as Error).message}`);
  }

  const [rulesetLevel, rulesetDetail] = rulesetRow(dataDir);
  record("Rulesets", rulesetLevel, rulesetDetail);
  return checks;
}

/**
 * The CLI row, then the sign-in row when the CLI can answer. A CLI that cannot
 * run blocks reviews, so it fails; a sign-in that is missing or per token only
 * warns, since the app still starts and says so on Settings.
 */
export function signInRows(
  cli: CliStatus,
  cliLabel: string,
): { label: string; level: Level; detail: string }[] {
  switch (cli.state) {
    case "notFound":
      return [{ label: cliLabel, level: "fail", detail: cli.message }];
    case "cannotRun":
      if (cli.version === undefined)
        return [{ label: cliLabel, level: "fail", detail: cli.message }];
      return [
        { label: cliLabel, level: "ok", detail: `${cli.path} (${cli.version})` },
        { label: "Signed in to Claude", level: "warn", detail: `unknown: ${cli.message}` },
      ];
    case "signedOut":
      return [
        { label: cliLabel, level: "ok", detail: `${cli.path} (${cli.version})` },
        {
          label: "Signed in to Claude",
          level: "warn",
          detail: "not signed in, so reviews cannot run; run npm run claude:auth",
        },
      ];
    case "perToken":
      return [
        { label: cliLabel, level: "ok", detail: `${cli.path} (${cli.version})` },
        {
          label: "Signed in to Claude",
          level: "warn",
          detail: `signed in with ${cli.authMethod}, which bills per token, not a subscription`,
        },
      ];
    case "maybePerToken":
      return [
        { label: cliLabel, level: "ok", detail: `${cli.path} (${cli.version})` },
        {
          label: "Signed in to Claude",
          level: "warn",
          detail: "signed in, but not as a subscription the CLI names; reviews may bill per token",
        },
      ];
    case "subscription":
      return [
        { label: cliLabel, level: "ok", detail: `${cli.path} (${cli.version})` },
        {
          label: "Signed in to Claude",
          level: "ok",
          detail: `subscription${cli.subscriptionType ? ` (${cli.subscriptionType} plan)` : ""}`,
        },
      ];
  }
}

/** A review is judged against a ruleset, and the app starts with none. Read-only. */
export function rulesetRow(dataDir: string): [Level, string] {
  const database = dbPath(dataDir);
  if (!existsSync(database)) {
    return ["warn", "no database yet; it is created the first time the app starts"];
  }
  const sqlite = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const { count } = sqlite.prepare("select count(*) as count from rulesets").get() as {
      count: number;
    };
    return count > 0
      ? ["ok", `${count} stored`]
      : ["warn", "none yet; import your protocol on the Rulesets screen, or npm run rules:seed"];
  } catch (error) {
    const message = (error as Error).message;
    // Only a database the app has not set up yet is a warning. Any other
    // error is the file's own trouble, and the app would meet it too.
    if (message === "no such table: rulesets") {
      return ["warn", "the database has no rulesets table yet; start the app once to set it up"];
    }
    return ["fail", `${database} could not be read: ${message}`];
  } finally {
    sqlite.close();
  }
}
