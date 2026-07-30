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
import { buildChildEnv, buildProbeArgs } from "@/lib/engine/command";
import type { ReviewProfile } from "@/lib/domain/enums";
import { contextWindowOf, resultEventSchema } from "@/lib/engine/events";

const authStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    authMethod: z.string().optional(),
    apiProvider: z.string().optional(),
    subscriptionType: z.string().optional(),
  })
  .passthrough();

export type AuthStatus = z.infer<typeof authStatusSchema>;

export interface AuthSummary {
  loggedIn: boolean;
  /** True when runs draw on a subscription rather than per-token billing. */
  usesSubscription: boolean;
  authMethod?: string;
  subscriptionType?: string;
}

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
  claudePath: string,
): Promise<CliOutcome> {
  return new Promise((resolve) => {
    const child = execFile(
      claudePath,
      [...args],
      {
        timeout: timeoutMs,
        env: buildChildEnv(process.env) as NodeJS.ProcessEnv,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error: Error | null, stdout: string, stderr: string) => {
        const killed =
          error !== null && (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        resolve({
          ok: error === null,
          stdout,
          error: error === null ? "" : (stderr || error.message).trim().slice(0, 500),
          timedOut: killed,
        });
      },
    );
    // The CLI waits on stdin when it is left open, so a probe that never
    // closes it hangs until the timeout instead of answering in a second.
    child.stdin?.end();
  });
}

/**
 * Reads which credentials the CLI is using.
 *
 * The app shows this so a user knows whether a review draws on the plan they
 * already pay for or bills per token. The credentials themselves are never
 * read, copied, or logged.
 */
export async function readAuthStatus(
  options: { claudePath?: string; timeoutMs?: number } = {},
): Promise<AuthSummary> {
  const outcome = await runCli(
    ["auth", "status"],
    options.timeoutMs ?? 30_000,
    options.claudePath ?? "claude",
  );
  if (!outcome.ok) return { loggedIn: false, usesSubscription: false };

  const parsed = authStatusSchema.safeParse(JSON.parse(outcome.stdout.trim() || "{}"));
  if (!parsed.success) return { loggedIn: false, usesSubscription: false };

  const status = parsed.data;
  return {
    loggedIn: status.loggedIn,
    // A subscription login reports claude.ai as the auth method; an API key
    // reports something else, and that changes how the user is billed.
    usesSubscription: status.loggedIn && status.authMethod === "claude.ai",
    ...(status.authMethod === undefined ? {} : { authMethod: status.authMethod }),
    ...(status.subscriptionType === undefined ? {} : { subscriptionType: status.subscriptionType }),
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
    options.claudePath ?? "claude",
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
