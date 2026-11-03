/**
 * `npm run claude:auth` checks that the Claude Code CLI reviews run through is
 * new enough and signed in, and starts the sign-in only when it is not. It
 * uses the same CLI resolution as the app (`resolveCli`), so the sign-in is
 * the one a review uses. Exits 0 when the CLI is ready, 1 otherwise.
 */

import { spawnSync } from "node:child_process";
import {
  CliNotFoundError,
  MINIMUM_CLI_VERSION,
  checkCliVersion,
  isAtLeast,
  parseCliVersion,
  resolveCli,
  runCliAttached,
  type CliCommand,
} from "@/server/engine/cli";
import { buildChildEnv } from "@/lib/engine/command";

interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  email?: string;
  subscriptionType?: string;
}

const configured = process.env.TRYSQUARE_CLAUDE_PATH?.trim() || undefined;

function readStatus(cli: CliCommand): AuthStatus {
  const result = spawnSync(cli.command, [...cli.prefixArgs, "auth", "status"], {
    encoding: "utf8",
    env: buildChildEnv(process.env) as NodeJS.ProcessEnv,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout) as AuthStatus;
  } catch {
    throw new Error(
      `"auth status" did not print JSON (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

function describe(status: AuthStatus): string {
  const who = status.email ?? "unknown account";
  const plan = status.subscriptionType ? `, ${status.subscriptionType} plan` : "";
  return `${who} (${status.authMethod ?? "unknown method"}${plan})`;
}

async function main(): Promise<number> {
  const cli = resolveCli(configured);
  const version = await checkCliVersion(cli);
  const parsed = parseCliVersion(version);
  if (parsed === null || !isAtLeast(parsed, MINIMUM_CLI_VERSION.split(".").map(Number))) {
    console.error(
      `The Claude Code CLI at ${cli.display} reports ${version}; reviews need ${MINIMUM_CLI_VERSION} or newer. ` +
        "Update it with `claude update`, then run this again.",
    );
    return 1;
  }
  console.log(`CLI: ${cli.display} (${version})`);

  let status = readStatus(cli);
  if (!status.loggedIn) {
    console.log("Not signed in. Starting `auth login`; finish it in the browser.");
    const code = runCliAttached(["auth", "login"], configured);
    if (code !== 0) {
      console.error(`Sign-in ended with exit ${code}. Run this again to retry.`);
      return 1;
    }
    status = readStatus(cli);
    if (!status.loggedIn) {
      console.error("The CLI still reports no sign-in after `auth login`.");
      return 1;
    }
  }

  console.log(`Signed in as ${describe(status)}.`);
  if (status.authMethod !== "claude.ai") {
    console.warn(
      "This is not a Claude subscription sign-in, so reviews may bill per token. Settings says which one a review uses.",
    );
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof CliNotFoundError) {
      console.error(error.message);
    } else {
      console.error((error as Error).message);
    }
    process.exit(1);
  },
);
