import {
  CliNotFoundError,
  CliUnusableError,
  realCliEnvironment,
  resolveCli,
} from "@/server/engine/cli";

/**
 * Whether a real Claude Code CLI is there for the suite's guard to refuse:
 * the one npm install put in node_modules, or else `claude` on PATH, as a
 * review would find it. Resolution only, which starts nothing; handing in
 * the real environment passes the guard, which is what lets this ask.
 *
 * The guard's refusals need one, or finding it fails first, as not found,
 * and those tests would fail for a reason that is not theirs. Checking the
 * node_modules copy alone skipped them where `claude` on PATH would have
 * served (review of the D-154 fixes).
 *
 * Only a CLI not there, or not runnable, answers no. Anything else is thrown,
 * and so is no CLI on CI, which always has the one npm ci installs: a skip
 * there would let a broken guard pass with all five of its refusals unrun
 * (review of the D-155 fixes).
 */
export function realCliPresent(): boolean {
  try {
    resolveCli(undefined, realCliEnvironment());
    return true;
  } catch (error) {
    if (!(error instanceof CliNotFoundError || error instanceof CliUnusableError)) throw error;
    if (process.env.CI) {
      throw new Error(
        `No real CLI resolved on CI, where npm ci installs one, so the guard's refusals ` +
          `would all be skipped: ${(error as Error).message}`,
      );
    }
    return false;
  }
}
