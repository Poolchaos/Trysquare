/**
 * What `npm run claude:auth` does: confirm the CLI reviews run through is new
 * enough and signed in, and start the sign-in only when it is not. The sign-in
 * step is a parameter, so a test can take each branch without a browser.
 */

import { readCliStatus, type CliStatus } from "@/server/engine/probe";

export interface ClaudeAuthOptions {
  claudePath?: string | undefined;
  /** Starts `claude auth login` attached to the terminal, and returns its exit code. */
  login: () => number;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Resolves to the exit code: 0 when reviews can run, 1 otherwise. */
export async function runClaudeAuth(options: ClaudeAuthOptions): Promise<number> {
  const first = await readCliStatus({ claudePath: options.claudePath });
  if (first.state === "notFound" || first.state === "cannotRun") {
    options.err(first.message);
    return 1;
  }
  options.out(`CLI: ${first.path} (${first.version})`);

  let status: CliStatus = first;
  if (first.state === "signedOut") {
    options.out("Not signed in. Starting `auth login`; finish it in the browser.");
    const code = options.login();
    if (code !== 0) {
      options.err(`Sign-in ended with exit ${code}. Run this again to retry.`);
      return 1;
    }
    status = await readCliStatus({ claudePath: options.claudePath });
    if (status.state === "signedOut") {
      options.err("The CLI still reports no sign-in after `auth login`.");
      return 1;
    }
    if (status.state === "notFound" || status.state === "cannotRun") {
      options.err(status.message);
      return 1;
    }
  }

  if (status.state === "subscription") {
    const plan = status.subscriptionType ? ` (${status.subscriptionType} plan)` : "";
    options.out(`Signed in with a subscription${plan}.`);
    return 0;
  }
  if (status.state === "signedOut") return 1;
  // Signed in some other way: reviews may bill per token. Said, and the run passes.
  const method = "authMethod" in status && status.authMethod ? ` (${status.authMethod})` : "";
  options.out(`Signed in${method}.`);
  options.err(
    "This is not a Claude subscription sign-in, so reviews may bill per token. Settings says which one a review uses.",
  );
  return 0;
}
