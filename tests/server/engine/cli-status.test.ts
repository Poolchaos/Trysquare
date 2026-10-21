/**
 * What the CLI is and whether it is signed in, each state told apart (MVP 6.1,
 * audit E2).
 *
 * A missing CLI, one that could not run, a timeout and output that was not
 * its status all read "Not signed in.", which sent a person to sign in to a
 * CLI that was not there. Driven through the fake CLI, which answers `auth
 * status` as the real one does: its JSON on stdout, and exit 1 when signed
 * out (measured on 2.1.301).
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCliStatus } from "@/server/engine/probe";

const FAKE_CLI = fileURLToPath(new URL("../../fixtures/fake-claude.mjs", import.meta.url));

const signedIn = (fields: object) =>
  JSON.stringify({ loggedIn: true, apiProvider: "firstParty", ...fields });

afterEach(() => {
  delete process.env.FAKE_CLAUDE_AUTH_STATUS;
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_VERSION;
});

describe("the CLI's status", () => {
  it("is not found when nothing answers to the name", async () => {
    const status = await readCliStatus({ claudePath: "no-such-claude-anywhere" });
    expect(status.state).toBe("notFound");
    expect(status.state === "notFound" && status.message).toMatch(/no-such-claude-anywhere/);
  });

  it("cannot run when the path names no program, and says why", async () => {
    const missing = join(fileURLToPath(new URL(".", import.meta.url)), "no-such-claude.mjs");
    const status = await readCliStatus({ claudePath: missing });
    expect(status).toMatchObject({ state: "cannotRun", path: missing });
    expect(status.state === "cannotRun" && status.message).toMatch(/no such file/);
  });

  it("cannot run when it is older than reviews need, and names its version", async () => {
    // A fresh copy of the engine: a version found good is remembered for the
    // life of the process, and an earlier test's would answer here.
    vi.resetModules();
    const { readCliStatus: fresh } = await import("@/server/engine/probe");
    process.env.FAKE_CLAUDE_VERSION = "2.1.71";
    process.env.FAKE_CLAUDE_AUTH_STATUS = signedIn({ authMethod: "claude.ai" });
    const status = await fresh({ claudePath: FAKE_CLI });
    expect(status.state).toBe("cannotRun");
    expect(status.state === "cannotRun" && status.message).toMatch(/2\.1\.71/);
  });

  it("cannot run when finding it failed some other way, and says how", async () => {
    // Every failure but a refused file read as "not found": in this suite the
    // real-CLI guard's own refusal did, so a test of a path that should have
    // been used passed on the bundled CLI being found instead (review of the
    // 6.1 changes).
    const status = await readCliStatus();
    expect(status.state).toBe("cannotRun");
    expect(status.state === "cannotRun" && status.message).toMatch(/not a fake/);
  });

  it("cannot run when it does not say its version in time, and says so", async () => {
    vi.resetModules();
    const { readCliStatus: fresh } = await import("@/server/engine/probe");
    process.env.FAKE_CLAUDE_VERSION = "hang";
    const status = await fresh({ claudePath: FAKE_CLI, timeoutMs: 1_500 });
    expect(status).toMatchObject({ state: "cannotRun", path: FAKE_CLI });
    expect(status.state === "cannotRun" && status.message).toMatch(
      /did not answer `--version` in time/,
    );
  }, 30_000);

  it("does not say how a sign-in bills when the CLI did not say how it signed in", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({ loggedIn: true });
    expect(await readCliStatus({ claudePath: FAKE_CLI })).toEqual({
      state: "perToken",
      path: FAKE_CLI,
      version: "2.1.301 (Claude Code)",
    });
  });

  it("is signed out when the CLI says so, though it exits 1 saying it", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({ loggedIn: false, authMethod: "none" });
    expect(await readCliStatus({ claudePath: FAKE_CLI })).toEqual({
      state: "signedOut",
      path: FAKE_CLI,
      version: "2.1.301 (Claude Code)",
    });
  });

  it("bills per token when signed in another way than a subscription", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = signedIn({ authMethod: "api_key" });
    expect(await readCliStatus({ claudePath: FAKE_CLI })).toEqual({
      state: "perToken",
      path: FAKE_CLI,
      version: "2.1.301 (Claude Code)",
      authMethod: "api_key",
    });
  });

  it("draws on a subscription when signed in through claude.ai", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = signedIn({
      authMethod: "claude.ai",
      subscriptionType: "max",
    });
    expect(await readCliStatus({ claudePath: FAKE_CLI })).toEqual({
      state: "subscription",
      path: FAKE_CLI,
      version: "2.1.301 (Claude Code)",
      subscriptionType: "max",
    });
  });

  it("cannot run when what it printed is not its status, and says what came", async () => {
    // A stream of events where the status JSON belongs, as a scenario prints.
    process.env.FAKE_CLAUDE_SCENARIO = "success";
    const status = await readCliStatus({ claudePath: FAKE_CLI });
    expect(status).toMatchObject({ state: "cannotRun", path: FAKE_CLI });
    expect(status.state === "cannotRun" && status.message).toMatch(/not its sign-in status/);
  }, 30_000);

  it("cannot run when the status check does not finish, and says so", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "hang";
    const status = await readCliStatus({ claudePath: FAKE_CLI, timeoutMs: 1_500 });
    expect(status).toMatchObject({ state: "cannotRun", path: FAKE_CLI });
    expect(status.state === "cannotRun" && status.message).toMatch(/did not finish/);
  }, 30_000);
});
