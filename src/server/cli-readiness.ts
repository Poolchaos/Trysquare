/**
 * Whether the CLI can run a review, asked as one is created and as one is
 * started (MVP 6.2), and the command that signs it in (MVP 6.3, D-159).
 *
 * Asked at both: a review is created once but started again on a Resume, a
 * draft's own Start and every review a restart left waiting, and asked at
 * create alone, a review that failed because its CLI signed out was resumed
 * into the same failure with nothing said first (review of the 6.2 changes).
 * The checks are free: `--version` and `auth status` run locally. A sign-in
 * that bills per token is a warning, not a block (D-92), though one the page
 * has not shown is refused until it has (review of D-161).
 */

import { z } from "zod";
import type { Db } from "./db/client";
import { configuredClaudePath } from "./cli-path";
import { readCliStatus, type CliStatus } from "./engine/probe";
import { signInCommand, signInPlaceWords, type SignIn } from "@/lib/engine/sign-in-command";

export interface CliReadiness {
  cli: CliStatus;
  signIn: SignIn;
  /** Why it cannot run a review, in words a person can act on, or null when it can. */
  refusal: string | null;
}

export async function cliReadiness(db: Db): Promise<CliReadiness> {
  const claudePath = configuredClaudePath(db);
  const cli = await readCliStatus(claudePath === undefined ? {} : { claudePath });
  // A configured CLI is signed in by the path it resolved to, which the
  // person's terminal finds whatever its own directory and PATH.
  const resolved = cli.state === "notFound" ? undefined : cli.path;
  const signIn = signInCommand(
    claudePath === undefined ? undefined : (resolved ?? claudePath),
    process.platform,
  );
  return { cli, signIn, refusal: refusalOf(cli, signIn) };
}

/**
 * The 409 a route answers for a CLI that cannot run a review, with the
 * command that signs it in apart from the words, for a page to set on a line
 * of its own (review of D-161).
 */
export function cliNotReady({ cli, signIn, refusal }: CliReadiness): Response {
  return Response.json(
    { error: refusal, code: "CliNotReady", ...(cli.state === "signedOut" ? { signIn } : {}) },
    { status: 409 },
  );
}

/** How a page said a review bills, sent with its Create and Start. */
export const billingShownSchema = z.enum(["perToken", "maybePerToken"]).optional();

/**
 * The 409 for a sign-in that bills per token, or may, which the page did not
 * say: Start pressed before its check answered, a check that failed, a page
 * with no notice of its own, such as a Resume, or a sign-in changed since the
 * page opened (review of D-161). Its body carries what the page needs to say
 * it. A page that said "may" has not said "will". Null when it said as much.
 */
export function billingNotShown(
  { cli, signIn }: CliReadiness,
  shown: z.infer<typeof billingShownSchema>,
): Response | null {
  if (cli.state !== "perToken" && cli.state !== "maybePerToken") return null;
  if (shown === "perToken" || shown === cli.state) return null;
  return Response.json(
    {
      error:
        // No cause is guessed: a Resume asks nothing before it is pressed, so
        // there nothing changed and no check failed (review of the D-162 fixes).
        `This review ${cli.state === "perToken" ? "will" : "may"} cost API usage, billed per ` +
        "token, which this page had not said yet. Read the notice, then press again.",
      code: "BillingNotShown",
      cli,
      signIn,
    },
    { status: 409 },
  );
}

/** The run note for a review that started on a sign-in billing per token, or that may. */
export function billingNote(cli: CliStatus): string | null {
  if (cli.state === "perToken") {
    // As strict as the notice beside Start (D-161).
    return (
      `This review costs API usage, billed per token: the CLI is signed in ` +
      `(${cli.authMethod}) some other way than a Claude subscription.`
    );
  }
  if (cli.state !== "maybePerToken") return null;
  if (cli.authMethod === "oauth_token") {
    return (
      "This review may cost API usage, billed per token: the CLI is signed in with a " +
      "token (oauth_token). One made by claude setup-token draws on a Claude " +
      "subscription, and any other may not."
    );
  }
  return (
    "This review may cost API usage, billed per token: " +
    (cli.authMethod === undefined
      ? "the CLI did not say how it is signed in"
      : `the CLI is signed in (${cli.authMethod}), a way this app does not know`) +
    ", and unless that is a Claude subscription, it bills per token."
  );
}

function refusalOf(cli: CliStatus, signIn: SignIn): string | null {
  switch (cli.state) {
    case "notFound":
      return `No Claude Code CLI was found, so the review cannot run. ${cli.message}`;
    case "cannotRun":
      return `The Claude Code CLI cannot run the review: ${cli.message} Check the CLI on Settings.`;
    case "signedOut":
      // Said where to run it, as Settings says it. The command itself is in
      // the refusal's body, not run into these words (review of D-161).
      return (
        `The Claude Code CLI at ${cli.path} is not signed in, so the review cannot run. ` +
        `Sign it in ${signInPlaceWords(signIn.place)} with the command below, then start ` +
        "the review again."
      );
    case "perToken":
    case "maybePerToken":
    case "subscription":
      return null;
  }
}
