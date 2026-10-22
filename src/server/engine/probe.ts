/**
 * Authentication status and model availability.
 *
 * Nothing here is assumed. Which models exist and which this account can use
 * are questions answered by asking, because they differ by account and change
 * over time. A probe is deliberately cheap: an explicit tiny system prompt and
 * no tools, which was measured at roughly a hundredth of the cost of a naive
 * probe that loads the default prompt and every tool definition.
 */

import { execFile } from "node:child_process";
import { z } from "zod";
import { PROBE_PROMPT, buildChildEnv, buildProbeArgs } from "@/lib/engine/command";
import type { ReviewProfile } from "@/lib/domain/enums";
import { contextWindowOf, resultEventSchema } from "@/lib/engine/events";
import {
  checkCliVersion,
  CliNotFoundError,
  CliUnusableError,
  resolveCli,
  type CliCommand,
} from "./cli";

const authStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    authMethod: z.string().optional(),
    apiProvider: z.string().optional(),
    subscriptionType: z.string().optional(),
  })
  .passthrough();

const PER_TOKEN_METHODS: ReadonlySet<string> = new Set([
  "api_key",
  "api_key_helper",
  "third_party",
]);

/**
 * Which CLI reviews run through and whether it can, each answer its own.
 * They all read "Not signed in." once, which sent a person to sign in to a
 * CLI that was not there (MVP 6.1, audit E2).
 */
export type CliStatus =
  | { state: "notFound"; message: string }
  /** No path when finding the CLI failed before naming one. */
  | { state: "cannotRun"; path?: string; version?: string; message: string }
  | { state: "signedOut"; path: string; version: string; configDirectory?: string }
  /**
   * Signed in some other way than a subscription: a warning, not a block
   * (D-92), though a review does not start until its page has shown it
   * (review of D-161).
   */
  | {
      state: "perToken";
      path: string;
      version: string;
      authMethod: string;
      configDirectory?: string;
    }
  /**
   * Signed in a way that may be a subscription or may not. No method when the
   * CLI did not say one.
   */
  | {
      state: "maybePerToken";
      path: string;
      version: string;
      authMethod?: string;
      configDirectory?: string;
    }
  | {
      state: "subscription";
      path: string;
      version: string;
      subscriptionType?: string;
      configDirectory?: string;
    };

interface CliOutcome {
  ok: boolean;
  /** Kept even on failure: the CLI reports the real reason here, not in stderr. */
  stdout: string;
  error: string;
  timedOut: boolean;
}

function runCli(
  args: readonly string[],
  timeoutMs: number,
  /**
   * The CLI as its caller already resolved and checked it, so what runs is
   * what was checked: looked for again, it could be another binary (D-181
   * item 9). A path is resolved here.
   */
  claude: CliCommand | string | undefined,
  /** Written to the child's stdin, which is where a prompt travels now. */
  stdin = "",
): Promise<CliOutcome> {
  const failed = (error: unknown): CliOutcome => ({
    ok: false,
    stdout: "",
    error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    timedOut: false,
  });
  let cli: CliCommand;
  try {
    cli = typeof claude === "object" ? claude : resolveCli(claude);
  } catch (error) {
    return Promise.resolve(failed(error));
  }
  return new Promise((resolve) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(
        cli.command,
        [...cli.prefixArgs, ...args],
        {
          timeout: timeoutMs,
          env: buildChildEnv(process.env) as NodeJS.ProcessEnv,
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        },
        (error: Error | null, stdout: string, stderr: string) => {
          const killed =
            error !== null &&
            (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
          resolve({
            ok: error === null,
            stdout,
            error: error === null ? "" : (stderr || error.message).trim().slice(0, 500),
            timedOut: killed,
          });
        },
      );
    } catch (error) {
      // A launch Windows refuses throws here rather than calling back.
      resolve(failed(error));
      return;
    }
    // The CLI reads the prompt from stdin and waits while it is open, so this
    // both delivers the prompt and ends the wait. A call with nothing to send,
    // like auth status, closes it empty for the same reason.
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdin);
  });
}

/**
 * Finds the CLI, asks its version and then which credentials it is using.
 *
 * The app shows this so a user knows whether a review can run at all, and
 * whether it draws on the plan they already pay for or bills per token. The
 * credentials themselves are never read, copied, or logged. Every step costs
 * nothing: `--version` and `auth status` run locally.
 *
 * Asked with no settings sources, as every review and probe the app starts
 * reads none (D-124, D-174). Asked without, it read the person's settings and
 * named an apiKeyHelper or a provider a review never reads;
 * `--setting-sources` before `auth` reaches it (D-170, measured 2026-10-22
 * with a throwaway config directory).
 */
export async function readCliStatus(
  options: { claudePath?: string; timeoutMs?: number } = {},
): Promise<CliStatus> {
  let cli: CliCommand;
  try {
    cli = resolveCli(options.claudePath);
  } catch (error) {
    if (error instanceof CliUnusableError) {
      return { state: "cannotRun", path: error.path, message: error.message };
    }
    if (error instanceof CliNotFoundError) return { state: "notFound", message: error.message };
    // Any other failure is not a CLI that was looked for and missing.
    return { state: "cannotRun", message: (error as Error).message };
  }
  const path = cli.display;
  let version: string;
  try {
    version = await checkCliVersion(cli, options.timeoutMs ?? 30_000);
  } catch (error) {
    return { state: "cannotRun", path, message: (error as Error).message };
  }

  const outcome = await runCli(
    ["--setting-sources", "", "auth", "status"],
    options.timeoutMs ?? 30_000,
    cli,
  );
  if (outcome.timedOut) {
    return {
      state: "cannotRun",
      path,
      version,
      message: "`auth status` did not finish in time, so whether it is signed in is unknown.",
    };
  }
  // Read before the exit code: signed out, the CLI exits 1 with its status
  // on stdout (measured on 2.1.301). Parsed defensively, since this reads
  // whatever binary the path names, and a status check whose whole job is to
  // answer calmly must not throw on what it was told.
  let raw: unknown;
  try {
    raw = JSON.parse(outcome.stdout.trim());
  } catch {
    raw = undefined;
  }
  const parsed = authStatusSchema.safeParse(raw);
  if (!parsed.success) {
    const said = (outcome.error || outcome.stdout).trim().slice(0, 200);
    return {
      state: "cannotRun",
      path,
      version,
      message:
        `\`auth status\` answered with something that is not its sign-in status` +
        (said === "" ? "." : `: ${said}`),
    };
  }
  const status = parsed.data;
  // Where the sign-in was read from: it lives in the config directory, not
  // the binary, so a command run in a terminal set up otherwise signs in
  // somewhere this check does not read (review of the 6.2 and 6.3 changes).
  const configDirectory =
    typeof status.configDirectory === "string" ? { configDirectory: status.configDirectory } : {};
  if (!status.loggedIn) return { state: "signedOut", path, version, ...configDirectory };
  // A subscription sign-in reports claude.ai as its method, and a key or
  // another provider one of these. 2.1.301 reports oauth_token for any other
  // token, both one `claude setup-token` made ("requires Claude
  // subscription") and a Console profile's, so that, a method unknown to
  // this list, and none at all may or may not bill per token (review of
  // D-161).
  if (status.authMethod !== "claude.ai") {
    if (status.authMethod !== undefined && PER_TOKEN_METHODS.has(status.authMethod)) {
      return {
        state: "perToken",
        path,
        version,
        authMethod: status.authMethod,
        ...configDirectory,
      };
    }
    return {
      state: "maybePerToken",
      path,
      version,
      ...(status.authMethod === undefined ? {} : { authMethod: status.authMethod }),
      ...configDirectory,
    };
  }
  return {
    state: "subscription",
    path,
    version,
    ...(status.subscriptionType === undefined ? {} : { subscriptionType: status.subscriptionType }),
    ...configDirectory,
  };
}

/**
 * The three answers a probe can give.
 *
 * "indeterminate" is not a pedantic third case: the CLI is a network client
 * and can simply be slow, and treating a timeout as "unavailable" would grey
 * a perfectly good model out of the picker until someone noticed. An
 * indeterminate result leaves the stored availability unknown instead.
 */
export type ProbeOutcome =
  | { status: "available"; resolvedId: string; contextWindow: number }
  | { status: "unavailable"; error: string }
  | { status: "indeterminate"; error: string };

/** Messages that mean the model itself was rejected, not that the call failed. */
const MODEL_REJECTED = [/invalid model/i, /unknown model/i, /model not found/i, /not available/i];

export async function probeModel(
  modelId: string,
  options: { claudePath?: string; timeoutMs?: number } = {},
): Promise<ProbeOutcome> {
  const outcome = await runCli(
    buildProbeArgs(modelId),
    options.timeoutMs ?? 180_000,
    options.claudePath,
    PROBE_PROMPT,
  );

  if (outcome.timedOut) {
    return {
      status: "indeterminate",
      error: `The probe did not finish in time, so availability is unknown: ${outcome.error}`,
    };
  }

  // The CLI reports a rejected model as a result event on stdout while still
  // exiting non-zero, so stdout is read first: its structured answer is more
  // informative than the exit code, and stderr is often empty.
  const parsed = parseResult(outcome.stdout);
  if (parsed) {
    if (parsed.is_error) {
      return { status: "unavailable", error: parsed.result ?? parsed.subtype };
    }
    const contextWindow = contextWindowOf(parsed);
    if (contextWindow === undefined) {
      return { status: "indeterminate", error: "The probe did not report a context window." };
    }
    const resolvedId = Object.keys(parsed.modelUsage ?? {})[0] ?? modelId;
    return { status: "available", resolvedId, contextWindow };
  }

  if (!outcome.ok) {
    const rejected = MODEL_REJECTED.some((pattern) => pattern.test(outcome.error));
    return rejected
      ? { status: "unavailable", error: outcome.error }
      : { status: "indeterminate", error: outcome.error };
  }
  return { status: "indeterminate", error: "The probe did not return a usable result." };
}

/** Parses a result event from stdout, or null if there is not one. */
function parseResult(stdout: string) {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  try {
    const parsed = resultEventSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ModelCandidate {
  id: string;
  family: string;
  displayName: string;
  profileId: ReviewProfile;
  recommended: boolean;
  sortOrder: number;
}

/**
 * The registry the app probes on first run.
 *
 * These are candidates, not a promise: each is probed and shown only if the
 * account can actually use it. Full ids only, because a short alias resolves
 * to whatever the CLI considers current for that family, which has already
 * been observed to be a previous generation.
 */
export const DEFAULT_MODEL_CANDIDATES: readonly ModelCandidate[] = [
  {
    id: "claude-fable-5[1m]",
    family: "fable",
    displayName: "Fable 5 (1M context)",
    profileId: "full-context",
    recommended: true,
    sortOrder: 10,
  },
  {
    id: "claude-opus-5[1m]",
    family: "opus",
    displayName: "Opus 5 (1M context)",
    profileId: "full-context",
    recommended: true,
    sortOrder: 20,
  },
  {
    id: "claude-fable-5",
    family: "fable",
    displayName: "Fable 5",
    profileId: "chunked",
    recommended: false,
    sortOrder: 30,
  },
  {
    id: "claude-opus-5",
    family: "opus",
    displayName: "Opus 5",
    profileId: "chunked",
    recommended: false,
    sortOrder: 40,
  },
  {
    id: "claude-sonnet-5[1m]",
    family: "sonnet",
    displayName: "Sonnet 5 (1M context)",
    profileId: "chunked",
    recommended: false,
    sortOrder: 50,
  },
  {
    id: "claude-sonnet-5",
    family: "sonnet",
    displayName: "Sonnet 5",
    profileId: "decomposed",
    recommended: false,
    sortOrder: 60,
  },
  {
    id: "claude-haiku-4-5-20251001",
    family: "haiku",
    displayName: "Haiku 4.5",
    // Not offered for judgment: a review it produced could not be trusted to
    // have applied the protocol, and the whole point is that it did.
    profileId: "mechanical-only",
    recommended: false,
    sortOrder: 70,
  },
];
