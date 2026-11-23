/**
 * `npm run claude:auth`: the sign-in check and the one sign-in it may start.
 * The fake CLI answers `auth status` from FAKE_CLAUDE_AUTH_STATUS, so a test
 * plays the sign-in changing by changing that value inside the login step.
 */

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runClaudeAuth } from "../../scripts/lib/claude-auth";
import { FAKE_CLI } from "../helpers/signed-in-fake";

const SIGNED_OUT = JSON.stringify({ loggedIn: false });
const SUBSCRIPTION = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  subscriptionType: "team",
});

let saved: string | undefined;
let out: string[];
let err: string[];

beforeEach(() => {
  saved = process.env.FAKE_CLAUDE_AUTH_STATUS;
  out = [];
  err = [];
});

afterEach(() => {
  if (saved === undefined) delete process.env.FAKE_CLAUDE_AUTH_STATUS;
  else process.env.FAKE_CLAUDE_AUTH_STATUS = saved;
});

function run(login: () => number) {
  return runClaudeAuth({
    claudePath: FAKE_CLI,
    login,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
}

describe("npm run claude:auth", () => {
  it("passes without signing in again when a subscription is already signed in", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = SUBSCRIPTION;
    const login = vi.fn(() => 0);

    expect(await run(login)).toBe(0);
    expect(login).not.toHaveBeenCalled();
    expect(out).toContain("Signed in with a subscription (team plan).");
  });

  it("starts the sign-in when signed out, and passes once the sign-in lands", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = SIGNED_OUT;
    const login = vi.fn(() => {
      // What a finished browser sign-in leaves behind for the CLI to report.
      process.env.FAKE_CLAUDE_AUTH_STATUS = SUBSCRIPTION;
      return 0;
    });

    expect(await run(login)).toBe(0);
    expect(login).toHaveBeenCalledTimes(1);
    expect(out).toContain("Signed in with a subscription (team plan).");
  });

  it("fails, and says so, when the sign-in itself fails", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = SIGNED_OUT;

    expect(await run(() => 1)).toBe(1);
    expect(err).toContain("Sign-in ended with exit 1. Run this again to retry.");
  });

  it("fails when the sign-in finishes but the CLI still reports signed out", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = SIGNED_OUT;

    expect(await run(() => 0)).toBe(1);
    expect(err).toContain("The CLI still reports no sign-in after `auth login`.");
  });

  it("passes with a warning when signed in some other way than a subscription", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({ loggedIn: true, authMethod: "api_key" });
    const login = vi.fn(() => 0);

    expect(await run(login)).toBe(0);
    expect(login).not.toHaveBeenCalled();
    expect(err).toEqual([
      "This is not a Claude subscription sign-in, so reviews may bill per token. Settings says which one a review uses.",
    ]);
  });

  it("does not call a token no subscription sign-in: one from claude setup-token is", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({
      loggedIn: true,
      authMethod: "oauth_token",
    });

    expect(await run(() => 0)).toBe(0);
    expect(out).toContain("Signed in (oauth_token).");
    expect(err).toEqual([
      "A token made by claude setup-token draws on a Claude subscription, and any other may bill per token. Settings says which sign-in a review uses.",
    ]);
  });

  it("says a sign-in the CLI names no method for may be a subscription or may not", async () => {
    process.env.FAKE_CLAUDE_AUTH_STATUS = JSON.stringify({ loggedIn: true });

    expect(await run(() => 0)).toBe(0);
    expect(out).toContain("Signed in.");
    expect(err).toEqual([
      "This may not be a Claude subscription sign-in: unless it is, reviews may bill per token. Settings says which sign-in a review uses.",
    ]);
  });

  it("fails, and names the path, when no CLI is there", async () => {
    const missing = join(FAKE_CLI, "..", "no-such-claude.mjs");
    const login = vi.fn(() => 0);

    const code = await runClaudeAuth({
      claudePath: missing,
      login,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });

    expect(code).toBe(1);
    expect(login).not.toHaveBeenCalled();
    expect(err.join("\n")).toMatch(/no-such-claude\.mjs/);
  });
});
