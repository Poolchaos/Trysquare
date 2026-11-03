/**
 * `npm run doctor` checks that this machine can run Trysquare. It runs before
 * `npm run dev` (the predev script), so a missing piece is named before the app
 * fails on it. A failed check stops the run with exit 1. A warning is something
 * the app starts without but a review cannot run without: it is printed and
 * the run goes on. It creates the data directory and changes nothing else; to
 * sign in, use `npm run claude:auth`.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import { dbPath, resolveDataDir } from "@/lib/paths";
import {
  MINIMUM_CLI_VERSION,
  checkCliVersion,
  describeAuthStatus,
  isAtLeast,
  parseCliVersion,
  readAuthStatus,
  resolveCli,
} from "@/server/engine/cli";

type Level = "ok" | "warn" | "fail";

interface Check {
  label: string;
  level: Level;
  detail: string;
}

const checks: Check[] = [];
const record = (label: string, level: Level, detail: string) =>
  checks.push({ label, level, detail });

const nodeMajor = Number(process.versions.node.split(".")[0]);
record(
  "Node 22 or newer",
  nodeMajor >= 22 ? "ok" : "fail",
  `found ${process.version}; install Node 22 or newer`,
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
try {
  const cli = resolveCli(process.env.TRYSQUARE_CLAUDE_PATH?.trim() || undefined);
  const version = await checkCliVersion(cli);
  const parsed = parseCliVersion(version);
  if (parsed === null || !isAtLeast(parsed, MINIMUM_CLI_VERSION.split(".").map(Number))) {
    record(cliLabel, "fail", `${cli.display} reports ${version}; run npm install`);
  } else {
    record(cliLabel, "ok", `${cli.display} (${version})`);
    try {
      const status = readAuthStatus(cli);
      if (status.loggedIn) {
        record("Signed in to Claude", "ok", describeAuthStatus(status));
      } else {
        record(
          "Signed in to Claude",
          "warn",
          "not signed in, so reviews cannot run; run npm run claude:auth",
        );
      }
    } catch (error) {
      record(
        "Signed in to Claude",
        "warn",
        `could not read the sign-in: ${(error as Error).message}`,
      );
    }
  }
} catch (error) {
  record(cliLabel, "fail", (error as Error).message);
}

const dataDir = resolveDataDir(process.env, homedir());
try {
  mkdirSync(dataDir, { recursive: true });
  accessSync(dataDir, constants.W_OK);
  record("Data directory writable", "ok", dataDir);
} catch (error) {
  record("Data directory writable", "fail", `${dataDir}: ${(error as Error).message}`);
}

// A review is judged against a ruleset, and the app starts with none. Read-only,
// so this never races the app for the database.
const database = dbPath(dataDir);
if (!existsSync(database)) {
  record("Rulesets", "warn", "no database yet; it is created the first time the app starts");
} else {
  const sqlite = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const { count } = sqlite.prepare("select count(*) as count from rulesets").get() as {
      count: number;
    };
    record(
      "Rulesets",
      count > 0 ? "ok" : "warn",
      count > 0
        ? `${count} stored`
        : "none yet; import your protocol on the Rulesets screen, or npm run rules:seed",
    );
  } catch {
    record(
      "Rulesets",
      "warn",
      "the database has no rulesets table yet; start the app once to set it up",
    );
  } finally {
    sqlite.close();
  }
}

for (const check of checks) {
  const tag = check.level === "ok" ? "ok  " : check.level === "warn" ? "WARN" : "FAIL";
  console.log(`${tag} ${check.label}: ${check.detail}`);
}
const failed = checks.filter((check) => check.level === "fail").length;
const warned = checks.filter((check) => check.level === "warn").length;
if (failed > 0) {
  console.error(`${failed} required check(s) failed. Fix them, then run this again.`);
  process.exit(1);
}
if (warned > 0) {
  console.log(
    `${warned} warning(s). The app will start, but a review needs the items marked WARN.`,
  );
} else {
  console.log("All checks passed.");
}
