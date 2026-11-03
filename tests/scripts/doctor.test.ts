/**
 * `npm run doctor`, the machine check that runs before `npm run dev`. Each
 * sign-in state is driven through the fake CLI, which answers `auth status` as
 * the real one does, so a state the doctor misreads fails here.
 */

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { seedRuleset } from "../../scripts/lib/seed-rules";
import { FAKE_CLI } from "../helpers/signed-in-fake";

const EXAMPLE = join(import.meta.dirname, "..", "fixtures", "example-protocol.md");
const SUBSCRIPTION = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  subscriptionType: "team",
});

let dataDir: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "trysquare-doctor-"));
  for (const key of [
    "TRYSQUARE_DATA",
    "TRYSQUARE_CLAUDE_PATH",
    "FAKE_CLAUDE_AUTH_STATUS",
    "FAKE_CLAUDE_VERSION",
  ]) {
    saved[key] = process.env[key];
  }
  process.env.TRYSQUARE_DATA = dataDir;
  process.env.TRYSQUARE_CLAUDE_PATH = FAKE_CLI;
  process.env.FAKE_CLAUDE_AUTH_STATUS = SUBSCRIPTION;
  delete process.env.FAKE_CLAUDE_VERSION;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * A fresh copy of the doctor and the engine under it: a CLI version found good
 * is remembered for the life of the process, so a test about an old CLI must
 * not reuse one an earlier test saw (the same reason cli-status.test.ts does this).
 */
async function runFresh(nodeVersion?: string) {
  vi.resetModules();
  const { runDoctor } = await import("../../scripts/lib/doctor");
  return runDoctor(nodeVersion);
}

function row(checks: { label: string; level: string; detail: string }[], start: string) {
  const found = checks.find((check) => check.label.startsWith(start));
  if (found === undefined) throw new Error(`no check starting "${start}"`);
  return found;
}

describe("the doctor on a machine that can run Trysquare", () => {
  it("passes every check once a subscription is signed in and a ruleset is stored", async () => {
    await seedRuleset({
      dataDir,
      markdown: readFileSync(EXAMPLE, "utf8"),
      name: "Company base rules",
      tier: "global",
      replace: false,
      sourceDoc: "example-protocol.md",
    });

    const checks = await runFresh();

    expect(checks.filter((check) => check.level !== "ok")).toEqual([]);
    expect(row(checks, "Signed in to Claude")).toMatchObject({
      level: "ok",
      detail: "subscription (team plan)",
    });
    expect(row(checks, "Rulesets")).toMatchObject({ level: "ok", detail: "1 stored" });
  });
});

describe("the doctor's sign-in check", () => {
  it("warns, and names the fix, when the CLI is signed out", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({ loggedIn: false });

    const checks = await runFresh();

    expect(row(checks, "Signed in to Claude")).toMatchObject({
      level: "warn",
      detail: "not signed in, so reviews cannot run; run npm run claude:auth",
    });
    expect(checks.filter((check) => check.level === "fail")).toEqual([]);
  });

  it("warns that a per-token sign-in bills per token, not a subscription", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({ loggedIn: true, authMethod: "api_key" });

    const checks = await runFresh();

    expect(row(checks, "Signed in to Claude")).toMatchObject({
      level: "warn",
      detail: "signed in with api_key, which bills per token, not a subscription",
    });
  });

  it("warns when the CLI does not say whether the sign-in is a subscription", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({
      loggedIn: true,
      authMethod: "somethingNew",
    });

    const checks = await runFresh();

    expect(row(checks, "Signed in to Claude").level).toBe("warn");
  });
});

describe("the doctor's CLI check", () => {
  it("fails when no CLI is at the configured path", async () => {
    process.env.TRYSQUARE_CLAUDE_PATH = join(dataDir, "no-such-claude.mjs");

    const checks = await runFresh();

    expect(row(checks, "Claude Code CLI")).toMatchObject({ level: "fail" });
    expect(row(checks, "Claude Code CLI").detail).toMatch(/no such file/);
  });

  it("fails, and names the version, when the CLI is older than reviews need", async () => {
    // Its own copy of the fake: the CLI check remembers the version it read for
    // a path (checkCliVersion keys its cache by command), so a path an earlier
    // test already asked about would answer with that earlier version.
    const oldCli = join(dataDir, "old-claude.mjs");
    copyFileSync(FAKE_CLI, oldCli);
    process.env.TRYSQUARE_CLAUDE_PATH = oldCli;
    process.env.FAKE_CLAUDE_VERSION = "2.0.5";

    const checks = await runFresh();

    expect(row(checks, "Claude Code CLI")).toMatchObject({ level: "fail" });
    expect(row(checks, "Claude Code CLI").detail).toMatch(/2\.0\.5/);
  });
});

describe("the doctor's data checks", () => {
  it("fails when Node is older than 22", async () => {
    const checks = await runFresh("20.11.0");

    expect(row(checks, "Node")).toMatchObject({ level: "fail" });
    expect(row(checks, "Node").detail).toMatch(/found v20\.11\.0/);
  });

  it("warns that no database exists yet, since the app creates it on first start", async () => {
    const checks = await runFresh();

    expect(row(checks, "Rulesets")).toMatchObject({
      level: "warn",
      detail: "no database yet; it is created the first time the app starts",
    });
  });

  it("warns when the database holds no ruleset", async () => {
    const db = createDb(join(dataDir, "db.sqlite"));
    runMigrations(db);
    db.$client.close();

    const checks = await runFresh();

    expect(row(checks, "Rulesets").level).toBe("warn");
    expect(row(checks, "Rulesets").detail).toMatch(/none yet/);
  });

  it("fails when the data directory cannot be written", async () => {
    // A file where the directory should be: creating the directory beneath it fails.
    const blocker = join(dataDir, "not-a-directory");
    writeFileSync(blocker, "x");
    process.env.TRYSQUARE_DATA = join(blocker, "data");

    const checks = await runFresh();

    expect(row(checks, "Data directory writable")).toMatchObject({ level: "fail" });
  });
});
