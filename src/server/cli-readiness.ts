/**
 * Whether the CLI can run a review, asked as one is created and as one is
 * started (MVP 6.2), and the command that signs it in (MVP 6.3, D-159).
 *
 * Asked at both: a review is created once but started again on a Resume, a
 * draft's own Start and every review a restart left waiting, and asked at
 * create alone, a review that failed because its CLI signed out was resumed
 * into the same failure with nothing said first (review of the 6.2 changes).
 * The checks are free: `--version` and `auth status` run locally. A sign-in
 * that bills per token is a warning, not a block (D-92).
 */

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

/** The 409 a route answers for a CLI that cannot run a review. */
export function cliNotReady(refusal: string): Response {
  return Response.json({ error: refusal, code: "CliNotReady" }, { status: 409 });
}

function refusalOf(cli: CliStatus, signIn: SignIn): string | null {
  switch (cli.state) {
    case "notFound":
      return `No Claude Code CLI was found, so the review cannot run. ${cli.message}`;
    case "cannotRun":
      return `The Claude Code CLI cannot run the review: ${cli.message} Check the CLI on Settings.`;
    case "signedOut":
      // Said where to run it, as Settings says it, and the command set apart
      // from the sentence (review of the 6.2 and 6.3 changes).
      return (
        `The Claude Code CLI at ${cli.path} is not signed in, so the review cannot run. ` +
        `Sign it in ${signInPlaceWords(signIn.place)} with: ${signIn.command} ` +
        "Then start the review again."
      );
    case "perToken":
    case "subscription":
      return null;
  }
}
