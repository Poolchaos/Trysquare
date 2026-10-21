/**
 * What the real demo says of the CLI before it spends anything.
 *
 * Its probe and review are real calls, and under a sign-in billing per token
 * they cost API usage with no word (review of D-161).
 */

import { describe, expect, it } from "vitest";
import { demoRefusal, describeSignIn } from "../../scripts/lib/demo-billing";
import type { CliStatus } from "@/server/engine/probe";

const base = { path: "/opt/claude", version: "2.1.301" };

describe("the real demo's look at the CLI", () => {
  it("runs on a subscription, and says so", () => {
    const cli: CliStatus = { state: "subscription", ...base, subscriptionType: "max" };
    expect(demoRefusal(cli, false)).toBeNull();
    expect(describeSignIn(cli)).toBe("/opt/claude, 2.1.301, signed in through a subscription");
  });

  it("refuses a sign-in that bills, or may, unless told it may spend", () => {
    const key: CliStatus = { state: "perToken", ...base, authMethod: "api_key" };
    expect(demoRefusal(key, false)).toBe(
      "The CLI is signed in (api_key) some other way than a Claude subscription, so this demo would cost API usage, billed per token. Nothing was spent. Pass --per-token to run it anyway, or --fake to run it free.",
    );
    expect(demoRefusal(key, true)).toBeNull();
    const token: CliStatus = { state: "maybePerToken", ...base, authMethod: "oauth_token" };
    expect(demoRefusal(token, false)).toMatch(
      /^The CLI is signed in \(oauth_token\) in a way that may not be a Claude subscription, so this demo may cost API usage, billed per token\. Nothing was spent\./,
    );
    expect(describeSignIn(token)).toBe("/opt/claude, 2.1.301, signed in (oauth_token)");
    // A setting that a review may not read is said as may (review of the
    // D-164 fixes).
    const helper: CliStatus = { state: "perToken", ...base, authMethod: "api_key_helper" };
    expect(demoRefusal(helper, false)).toMatch(/so this demo may cost API usage, billed per token/);
  });

  it("refuses a CLI that cannot run, whatever it is told", () => {
    const states: CliStatus[] = [
      { state: "notFound", message: "Could not find claude." },
      { state: "cannotRun", path: "/opt/claude", message: "the file is not executable." },
      { state: "signedOut", ...base },
    ];
    for (const cli of states) {
      expect(demoRefusal(cli, true)).toMatch(/Nothing was spent\. Pass --fake to run it free\.$/);
    }
  });
});
