/**
 * The billing rule a page's Start meets, and the run note a start writes.
 *
 * The routes' tests drive the api_key sign-in through them; the other
 * branches, which only these words tell apart, are read here (review of the
 * D-162 fixes, which found the "may" notes untested).
 */

import { describe, expect, it } from "vitest";
import { billingNote, billingNotShown, refusalOf, type CliReadiness } from "@/server/cli-readiness";
import type { CliStatus } from "@/server/engine/probe";

const signIn = { command: "npm run claude -- auth login", place: "projectDirectory" } as const;
const base = { path: "/opt/claude", version: "2.1.301" };
const readiness = (cli: CliStatus): CliReadiness => ({ cli, signIn, refusal: null });

describe("the run note for a start that bills", () => {
  it("says a key's review costs API usage, and one in line will if the sign-in stays", () => {
    const cli: CliStatus = { state: "perToken", ...base, authMethod: "api_key" };
    expect(billingNote(cli)).toBe(
      "This review costs API usage, billed per token: the CLI is signed in (api_key) some other way than a Claude subscription.",
    );
    // The sign-in is read as the review is put in line and not again as it
    // leaves, so "will cost" rests on a sign-in that may change meanwhile.
    expect(billingNote(cli, true)).toBe(
      "This review will cost API usage once it leaves the queue, billed per token, if the CLI is still signed in as it is now (api_key), some other way than a Claude subscription. The sign-in is not checked again as it leaves the queue.",
    );
  });

  it("says a token's review may cost, in the words the notice and Settings use", () => {
    expect(billingNote({ state: "maybePerToken", ...base, authMethod: "oauth_token" })).toBe(
      "This review may cost API usage, billed per token: the CLI is signed in with a token (oauth_token). One made by claude setup-token draws on a Claude subscription, and any other may cost API usage.",
    );
  });

  it("says a method unknown, or none, may cost, and names the one it was told", () => {
    expect(billingNote({ state: "maybePerToken", ...base })).toBe(
      "This review may cost API usage, billed per token: the CLI did not say how it is signed in, and unless that is a Claude subscription, it bills per token.",
    );
    expect(billingNote({ state: "maybePerToken", ...base, authMethod: "newer" }, true)).toBe(
      "This review may cost API usage once it leaves the queue, billed per token: the CLI is signed in (newer), a way this app does not know, and unless that is a Claude subscription, it bills per token.",
    );
  });

  it("says a setting's review costs, as the check asks as a review here reads", () => {
    // Asked with a review's own setting sources, the check names a setting
    // only when that review reads it (D-169, measured 2026-10-22).
    expect(billingNote({ state: "perToken", ...base, authMethod: "api_key_helper" })).toBe(
      "This review costs API usage, billed per token: the CLI is signed in (api_key_helper) some other way than a Claude subscription.",
    );
  });

  it("says nothing of a subscription", () => {
    expect(billingNote({ state: "subscription", ...base, subscriptionType: "max" })).toBeNull();
  });
});

describe("the refusal for a CLI that is not ready, by what was asked of it", () => {
  const signedOut: CliStatus = { state: "signedOut", ...base };
  const notFound: CliStatus = { state: "notFound", message: "Nothing named claude is on PATH." };
  const cannotRun: CliStatus = { state: "cannotRun", message: "Its version is too old." };

  it("tells a review's Start to start the review again", () => {
    expect(refusalOf(signedOut, signIn)).toBe(
      "The Claude Code CLI at /opt/claude is not signed in, so the review cannot run. Sign it in from a terminal, in this project's directory with the command below, then start the review again.",
    );
    expect(refusalOf(notFound, signIn)).toBe(
      "No Claude Code CLI was found, so the review cannot run. Nothing named claude is on PATH.",
    );
    expect(refusalOf(cannotRun, signIn)).toBe(
      "The Claude Code CLI cannot run the review: Its version is too old. Check the CLI on Settings.",
    );
  });

  it("tells a verify-again what was not sent and what to press, with no review to start", () => {
    // A verify-again is pressed on a review awaiting confirmation, which has
    // no Start, and its dialog shows the refusal's words with no command
    // under them. It was told the review cannot run and to start it again.
    const again = [signedOut, notFound, cannotRun].map((cli) =>
      refusalOf(cli, signIn, "verifyAgain"),
    );
    expect(again).toEqual([
      "The Claude Code CLI at /opt/claude is not signed in, so the request was not sent. Sign it in from a terminal, in this project's directory with the command Settings shows, then press Send request again.",
      "No Claude Code CLI was found, so the request was not sent. Nothing named claude is on PATH.",
      "The request was not sent: the Claude Code CLI did not pass its check. Its version is too old. Check the CLI on Settings.",
    ]);
    for (const words of again) {
      expect(words).not.toMatch(/the review|command below/);
    }
  });

  it("refuses nothing of a CLI that is signed in, whatever was asked", () => {
    const cli: CliStatus = { state: "subscription", ...base };
    expect(refusalOf(cli, signIn)).toBeNull();
    expect(refusalOf(cli, signIn, "verifyAgain")).toBeNull();
  });
});

describe("a page's Start, by the billing it showed", () => {
  const perToken: CliStatus = { state: "perToken", ...base, authMethod: "api_key" };
  const maybe: CliStatus = { state: "maybePerToken", ...base, authMethod: "oauth_token" };

  it("needs will for a sign-in that bills, and may or will for one that may", () => {
    expect(billingNotShown(readiness(perToken), undefined)?.status).toBe(409);
    expect(billingNotShown(readiness(perToken), "maybePerToken")?.status).toBe(409);
    expect(billingNotShown(readiness(perToken), "perToken")).toBeNull();
    expect(billingNotShown(readiness(maybe), undefined)?.status).toBe(409);
    expect(billingNotShown(readiness(maybe), "maybePerToken")).toBeNull();
    expect(billingNotShown(readiness(maybe), "perToken")).toBeNull();
  });

  it("says will of a setting the check found as a review here reads", async () => {
    // As the notice beside it says (review of the D-164 fixes); refused at
    // all first, or the words were never read (review of the D-165 fixes).
    const helper: CliStatus = { state: "perToken", ...base, authMethod: "api_key_helper" };
    const refused = billingNotShown(readiness(helper), undefined);
    expect(refused).not.toBeNull();
    const body = (await refused!.json()) as { error: string };
    expect(body.error).toMatch(/^This review will cost API usage, billed per token/);
  });

  it("asks nothing of a subscription", () => {
    const cli: CliStatus = { state: "subscription", ...base };
    expect(billingNotShown(readiness(cli), undefined)).toBeNull();
  });
});
